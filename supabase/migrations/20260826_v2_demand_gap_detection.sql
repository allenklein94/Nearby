-- Business Intelligence & Opportunity Engine, Phase 5 (Intelligence):
-- demand-gap detection -- a real "you have demand for something you don't
-- offer" recommendation, extending get_aggregated_demand_for_partner()
-- rather than building a second RPC.
--
-- Real finding this closes: _business_request_fanout() (Aug 15 2026, "the
-- V3/V4 vision") notifies every eligible active partner within radius,
-- with zero category filter at all -- confirmed by reading its live SQL
-- directly before designing this, not assumed. That means
-- get_aggregated_demand_for_partner()'s own per-category rollup can
-- genuinely include a category this partner has never actually served --
-- e.g. a coffee shop can see real "Wine" demand nearby purely because
-- fan-out reached them on distance/reputation alone, never on category
-- fit. Today the dashboard shows that row exactly like every other
-- category, with no signal telling the owner "this one's outside what you
-- currently offer." This migration adds that signal, honestly, from real
-- data only -- never a guessed or inferred capability.
--
-- "Served" is defined narrowly and only from real, owner-declared or
-- owner-fulfilled signal, matching this schema's own "never fabricate a
-- capability" rule used throughout the Business Intelligence phases:
--   (a) the partner has ever posted a real business_availability row in
--       that exact category (any status -- even an expired posting is
--       real evidence they once offered it), OR
--   (b) the partner has ever had a real business_request_offers row in
--       that category reach accepted/completed (a genuine successful
--       fulfillment, not just an auto-generated fan-out `pending` row --
--       fan-out creates a pending offer for nearly every eligible
--       partner regardless of category match, so "has an offer row" on
--       its own would be a false positive for "serves this category").
-- A category with zero of either is a real, honest gap: real nearby
-- demand exists, and this partner has never engaged it.
--
-- drop-then-create because the return TABLE shape is changing (one new
-- output column), matching this same function's own established
-- discipline every prior revision of it already used.
drop function if exists get_aggregated_demand_for_partner(uuid);

create function get_aggregated_demand_for_partner(partner_id_param uuid)
returns table(
  category text,
  request_count bigint,
  total_party_size bigint,
  soonest_date date,
  dominant_period text,
  dominant_period_count bigint,
  unmet_intent_count bigint,
  is_demand_gap boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_bucket_lat double precision;
  v_bucket_lng double precision;
  v_neighbor_buckets text[] := array[]::text[];
  v_dlat double precision;
  v_dlng double precision;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    return;
  end if;

  select latitude, longitude into v_lat, v_lng from brand_partners where id = partner_id_param;
  if v_lat is null or v_lng is null then
    return;
  end if;

  v_bucket_lat := round(v_lat::numeric, 1)::double precision;
  v_bucket_lng := round(v_lng::numeric, 1)::double precision;
  foreach v_dlat in array array[-0.1::double precision, 0::double precision, 0.1::double precision] loop
    foreach v_dlng in array array[-0.1::double precision, 0::double precision, 0.1::double precision] loop
      v_neighbor_buckets := array_append(
        v_neighbor_buckets,
        (round((v_bucket_lat + v_dlat)::numeric, 1)::double precision)::text || ',' || (round((v_bucket_lng + v_dlng)::numeric, 1)::double precision)::text
      );
    end loop;
  end loop;

  return query
  with nearby_open as (
    select br.category as req_category, br.party_size, br.date as req_date, br.time_window_start
    from business_requests br
    where br.status = 'open'
    and br.expires_at > now()
    and br.category is not null
    and br.latitude is not null and br.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(v_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_lng)) +
        sin(radians(v_lat)) * sin(radians(br.latitude))
      ))
    )) <= br.radius_miles
  ),
  periods as (
    select
      req_category,
      case
        when extract(hour from time_window_start) < 12 then 'morning'
        when extract(hour from time_window_start) < 18 then 'afternoon'
        else 'evening'
      end as period_bucket,
      count(*) as period_count
    from nearby_open
    where time_window_start is not null
    group by 1, 2
  ),
  ranked_periods as (
    select req_category, period_bucket, period_count,
      row_number() over (partition by req_category order by period_count desc) as rn
    from periods
  ),
  real_demand as (
    select
      n.req_category as cat,
      count(*)::bigint as req_count,
      coalesce(sum(coalesce(n.party_size, 1)), 0)::bigint as party_total,
      min(n.req_date) as min_date,
      rp.period_bucket as dom_period,
      rp.period_count as dom_period_count
    from nearby_open n
    left join ranked_periods rp on rp.req_category = n.req_category and rp.rn = 1
    group by n.req_category, rp.period_bucket, rp.period_count
  ),
  unmet_intent as (
    select
      i.category as cat,
      count(*)::bigint as unmet_cnt
    from intent_submissions i
    where i.category is not null
      and i.had_any_result = false
      and i.wide_area = any(v_neighbor_buckets)
      and i.created_at > now() - interval '14 days'
    group by i.category
  ),
  -- Real, narrowly-defined "this partner genuinely serves this category"
  -- set -- see the migration's own header comment for why each half is
  -- required rather than any offer row at all.
  served_categories as (
    select ba.category as cat
    from business_availability ba
    where ba.partner_id = partner_id_param and ba.category is not null
    union
    select br.category as cat
    from business_request_offers bro
    join business_requests br on br.id = bro.request_id
    where bro.partner_id = partner_id_param
      and bro.status in ('accepted', 'completed')
      and br.category is not null
  )
  select
    coalesce(rd.cat, ui.cat) as category,
    coalesce(rd.req_count, 0)::bigint as request_count,
    coalesce(rd.party_total, 0)::bigint as total_party_size,
    rd.min_date as soonest_date,
    rd.dom_period as dominant_period,
    rd.dom_period_count as dominant_period_count,
    coalesce(ui.unmet_cnt, 0)::bigint as unmet_intent_count,
    not exists (
      select 1 from served_categories sc where sc.cat = coalesce(rd.cat, ui.cat)
    ) as is_demand_gap
  from real_demand rd
  full outer join unmet_intent ui on ui.cat = rd.cat
  order by coalesce(rd.req_count, 0) desc, coalesce(ui.unmet_cnt, 0) desc
  limit 10;
end;
$$;

revoke all on function get_aggregated_demand_for_partner(uuid) from public, anon;
grant execute on function get_aggregated_demand_for_partner(uuid) to authenticated;
