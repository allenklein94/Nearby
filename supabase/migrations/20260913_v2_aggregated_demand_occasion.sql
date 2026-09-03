-- "Intelligent demand inbox" plan (CLAUDE.md, Sep 3 2026), Phase 4(d):
-- get_aggregated_demand_for_partner() extended to also roll up by the
-- real business_requests.occasion column (Phase 1), the same way it
-- already rolls up by time-of-day window (dominant_period/
-- dominant_period_count) -- giving "Demand Near You" a genuine
-- occasion-based signal ("mostly birthday, 3 of 5") instead of only
-- category/party-size/time-window. No new signal invented -- occasion
-- was already a real, collected column before this migration, just
-- never surfaced in this rollup.
--
-- Pulled the live body fresh via the Management API before editing
-- (confirmed byte-identical to the last committed migration,
-- 20260826_v4_business_entitlements.sql, no drift to reconcile). Every
-- line below is unchanged from that live body EXCEPT: nearby_open now
-- also selects br.occasion; a new occasions/ranked_occasions CTE pair,
-- mirroring periods/ranked_periods exactly (same "dominant bucket by
-- count" shape, same tie-break via row_number()); real_demand's final
-- select/group-by gains the new dominant occasion columns; and the
-- returned columns/output list gain dominant_occasion/
-- dominant_occasion_count. The entitlement gate, the geo-bucketing, the
-- unmet-intent CTE, the served_categories CTE, and the final where/
-- order-by/limit are all untouched.
--
-- A category with zero real open requests naming an occasion correctly
-- gets null/null here, same "no invented default" convention
-- dominant_period already established -- a request with no occasion set
-- (create-assistant's own extraction is best-effort, per Phase 1) simply
-- doesn't count toward any occasion bucket, it still counts toward the
-- plain request_count total.
drop function if exists get_aggregated_demand_for_partner(uuid);

create function get_aggregated_demand_for_partner(partner_id_param uuid)
returns table(category text, request_count bigint, total_party_size bigint, soonest_date date, dominant_period text, dominant_period_count bigint, dominant_occasion text, dominant_occasion_count bigint, unmet_intent_count bigint, is_demand_gap boolean)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_lat double precision;
  v_lng double precision;
  v_bucket_lat double precision;
  v_bucket_lng double precision;
  v_neighbor_buckets text[] := array[]::text[];
  v_dlat double precision;
  v_dlng double precision;
  v_advanced boolean;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    return;
  end if;

  select coalesce((public.check_business_entitlement(partner_id_param, 'advanced_match_radar') ->> 'enabled')::boolean, false)
  into v_advanced;

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
    select br.category as req_category, br.party_size, br.date as req_date, br.time_window_start, br.occasion as req_occasion
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
  occasions as (
    select req_category, req_occasion, count(*) as occasion_count
    from nearby_open
    where req_occasion is not null
    group by 1, 2
  ),
  ranked_occasions as (
    select req_category, req_occasion, occasion_count,
      row_number() over (partition by req_category order by occasion_count desc) as rn
    from occasions
  ),
  real_demand as (
    select
      n.req_category as cat,
      count(*)::bigint as req_count,
      coalesce(sum(coalesce(n.party_size, 1)), 0)::bigint as party_total,
      min(n.req_date) as min_date,
      rp.period_bucket as dom_period,
      rp.period_count as dom_period_count,
      ro.req_occasion as dom_occasion,
      ro.occasion_count as dom_occasion_count
    from nearby_open n
    left join ranked_periods rp on rp.req_category = n.req_category and rp.rn = 1
    left join ranked_occasions ro on ro.req_category = n.req_category and ro.rn = 1
    group by n.req_category, rp.period_bucket, rp.period_count, ro.req_occasion, ro.occasion_count
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
    rd.dom_occasion as dominant_occasion,
    rd.dom_occasion_count as dominant_occasion_count,
    case when v_advanced then coalesce(ui.unmet_cnt, 0)::bigint else 0::bigint end as unmet_intent_count,
    case when v_advanced then not exists (
      select 1 from served_categories sc where sc.cat = coalesce(rd.cat, ui.cat)
    ) else false end as is_demand_gap
  from real_demand rd
  full outer join unmet_intent ui on ui.cat = rd.cat
  -- Real fix, found while wiring the dashboard's locked-preview UI, not
  -- caught by the original live-verify pass: without this filter, a
  -- category that ONLY exists via unmet_intent (real_demand has no row
  -- for it, so request_count is genuinely 0) still survives this full
  -- outer join for a non-advanced caller -- surfacing a confusing
  -- "0 recent searches" row that leaks the mere existence of hidden
  -- signal even though its real value is correctly redacted to 0. A
  -- non-advanced caller now simply never sees that category at all,
  -- matching the entitlement's real intent: any row whose only reason to
  -- exist is unmet-intent data is itself part of the gated signal.
  where v_advanced or coalesce(rd.req_count, 0) > 0
  order by coalesce(rd.req_count, 0) desc, coalesce(ui.unmet_cnt, 0) desc
  limit 10;
end;
$function$;

revoke all on function get_aggregated_demand_for_partner(uuid) from public, anon;
grant execute on function get_aggregated_demand_for_partner(uuid) to authenticated;
