-- Item 128 (owner, 2026-10-16): business Home's "N people are looking for something nearby that you offer" must be true.
--
-- Found in the live get_aggregated_demand_for_partner: (1) the client summed request_count over EVERY nearby category, not
-- only what the business offers; (2) summing per-category distinct-people counts counted a person who asked in two
-- categories twice; (3) dominant_occasion_count was a request count with no floor ("mostly birthday (2 of 6)").
--
-- Fix (same function, no parallel demand read):
--   * offered_people: DISTINCT people with an open, unexpired nearby request (same "within the requester's own radius" rule
--     as the category rows) whose category is the business's OWN primary (brand_partners.subcategory) or one of its
--     secondary categories (brand_partners.categories). Returned only at >= demand_min_people(), on ONE summary row whose
--     category is NULL (so it shows even when no single category reaches the floor). No declared category = no summary row:
--     never a fallback to the whole group or to all nearby demand (owner). Deliberately NOT business_served_tags(), which
--     falls back to the major group and adds availability categories.
--   * is_offered on each category row: that category is the business's primary or a secondary (Home's "Your best
--     opportunity" reads only these).
--   * dominant_occasion / dominant_occasion_count: counted as distinct people and shown only when that count itself is
--     >= demand_min_people().
-- Category rows (Match Radar, incl. demand gaps outside what the business offers) are otherwise unchanged.
-- The return type changes, so the function is dropped and re-created (single overload, same argument list, same grants).

drop function if exists public.get_aggregated_demand_for_partner(uuid);

create function public.get_aggregated_demand_for_partner(partner_id_param uuid)
returns table(category text, request_count bigint, total_party_size bigint, soonest_date date, dominant_period text,
  dominant_period_count bigint, dominant_occasion text, dominant_occasion_count bigint, unmet_intent_count bigint,
  is_demand_gap boolean, is_offered boolean, offered_people bigint)
language plpgsql stable security definer set search_path = public as $function$
declare
  v_lat double precision;
  v_lng double precision;
  v_bucket_lat double precision;
  v_bucket_lng double precision;
  v_neighbor_buckets text[] := array[]::text[];
  v_dlat double precision;
  v_dlng double precision;
  v_advanced boolean;
  v_offered text[];
  v_offered_people bigint;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    return;
  end if;

  select coalesce((public.check_business_entitlement(partner_id_param, 'advanced_match_radar') ->> 'enabled')::boolean, false)
  into v_advanced;

  select bp.latitude, bp.longitude,
         array(select distinct t from unnest(array[bp.subcategory] || coalesce(bp.categories, array[]::text[])) t where t is not null)
    into v_lat, v_lng, v_offered
  from brand_partners bp where bp.id = partner_id_param;
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

  -- Distinct people across the business's own categories (one person once, however many categories they asked in).
  select count(distinct br.requester_id)::bigint into v_offered_people
  from business_requests br
  where cardinality(v_offered) > 0
    and br.status = 'open'
    and br.expires_at > now()
    and br.category = any(v_offered)
    and br.latitude is not null and br.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(v_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_lng)) +
        sin(radians(v_lat)) * sin(radians(br.latitude))
      ))
    )) <= br.radius_miles;

  return query
  with nearby_open as (
    select br.requester_id as req_person, br.category as req_category, br.party_size, br.date as req_date, br.time_window_start, br.occasion as req_occasion
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
      count(distinct req_person) as period_count
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
    select req_category, req_occasion, count(distinct req_person) as occasion_count
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
      count(distinct n.req_person)::bigint as req_count,
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
      count(distinct i.user_id)::bigint as unmet_cnt
    from intent_submissions i
    where i.category is not null
      and i.had_any_result = false
      and i.wide_area = any(v_neighbor_buckets)
      and i.created_at > now() - interval '14 days'
      and i.intent_kind is distinct from 'business_partner'
    group by i.category
    having count(distinct i.user_id) >= public.demand_min_people()
  ),
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
  ),
  category_rows as (
    select
      coalesce(rd.cat, ui.cat) as category,
      case when coalesce(rd.req_count, 0) >= public.demand_min_people() then rd.req_count else 0 end::bigint as request_count,
      case when coalesce(rd.req_count, 0) >= public.demand_min_people() then rd.party_total else 0 end::bigint as total_party_size,
      case when coalesce(rd.req_count, 0) >= public.demand_min_people() then rd.min_date end as soonest_date,
      case when coalesce(rd.req_count, 0) >= public.demand_min_people() and rd.dom_period_count >= public.demand_min_people() then rd.dom_period end as dominant_period,
      case when coalesce(rd.req_count, 0) >= public.demand_min_people() and rd.dom_period_count >= public.demand_min_people() then rd.dom_period_count end as dominant_period_count,
      case when coalesce(rd.req_count, 0) >= public.demand_min_people() and rd.dom_occasion_count >= public.demand_min_people() then rd.dom_occasion end as dominant_occasion,
      case when coalesce(rd.req_count, 0) >= public.demand_min_people() and rd.dom_occasion_count >= public.demand_min_people() then rd.dom_occasion_count end::bigint as dominant_occasion_count,
      case when v_advanced then coalesce(ui.unmet_cnt, 0)::bigint else 0::bigint end as unmet_intent_count,
      case when v_advanced then not exists (
        select 1 from served_categories sc where sc.cat = coalesce(rd.cat, ui.cat)
      ) else false end as is_demand_gap,
      (coalesce(rd.cat, ui.cat) = any(v_offered)) as is_offered,
      null::bigint as offered_people
    from real_demand rd
    full outer join unmet_intent ui on ui.cat = rd.cat
    -- a category that exists only through unmet intent is itself part of the gated signal (non-advanced callers never see it)
    where coalesce(rd.req_count, 0) >= public.demand_min_people() or (v_advanced and coalesce(ui.unmet_cnt, 0) >= public.demand_min_people())
    order by coalesce(rd.req_count, 0) desc, coalesce(ui.unmet_cnt, 0) desc
    limit 10
  )
  select * from category_rows
  union all
  -- the summary row (category NULL): Home's "N people are looking for something nearby that you offer", floored
  select null::text, null::bigint, null::bigint, null::date, null::text, null::bigint, null::text, null::bigint, null::bigint,
         null::boolean, null::boolean, v_offered_people
  where v_offered_people >= public.demand_min_people();
end;
$function$;

revoke all on function public.get_aggregated_demand_for_partner(uuid) from public, anon;
grant execute on function public.get_aggregated_demand_for_partner(uuid) to authenticated, service_role;
