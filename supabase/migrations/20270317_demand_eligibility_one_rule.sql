-- Item 128 follow-up (owner, 2026-10-16): one shared definition of business category eligibility + the floor of 5 on every
-- breakdown's leftover count.
--
-- 1. business_offered_tags(partner): the categories a business OFFERS = its own primary (brand_partners.subcategory) and
--    secondary categories (brand_partners.categories), nothing else: no fallback to its whole group, no availability
--    categories. It now governs "N people are looking for what you offer" (get_aggregated_demand_for_partner), the
--    "Demand near you" card (get_partner_demand_signals, was business_served_tags() with the group fallback) and the
--    "Growing demand nearby" push (notify_aggregated_demand_threshold, was every nearby business). business_served_tags()
--    is unchanged for routing (_business_request_fanout, business_in_category_group).
-- 2. demand_breakdown_visible(n, total): a breakdown "n of total" (mostly evening / mostly birthday / mostly looking for X /
--    N of them this weekend) is shown only when n >= demand_min_people() AND the leftover (total - n) is 0 or >=
--    demand_min_people(); a total under the floor never shows a breakdown. Overall counts are untouched (a hidden breakdown
--    never hides or changes them). get_partner_demand_signals already complement-checks its facts and is unchanged there.
--    The card's "N businesses offer this nearby" (supply) counts other businesses by the same rule.
-- Same signatures and return types (create or replace, one overload each); grants unchanged.

create or replace function public.business_offered_tags(partner_id_param uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array(
    select distinct t from brand_partners bp, unnest(array[bp.subcategory] || coalesce(bp.categories, array[]::text[])) t
    where bp.id = partner_id_param and t is not null
  ), array[]::text[]);
$$;
revoke all on function public.business_offered_tags(uuid) from public, anon, authenticated;
grant execute on function public.business_offered_tags(uuid) to service_role;

create or replace function public.demand_breakdown_visible(n bigint, total bigint)
returns boolean language sql stable set search_path = public as $$
  select coalesce(total >= public.demand_min_people() and n >= public.demand_min_people()
         and (total - n = 0 or total - n >= public.demand_min_people()), false);
$$;
revoke all on function public.demand_breakdown_visible(bigint, bigint) from public, anon, authenticated;
grant execute on function public.demand_breakdown_visible(bigint, bigint) to service_role;

create or replace function public.get_aggregated_demand_for_partner(partner_id_param uuid)
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

  select bp.latitude, bp.longitude, public.business_offered_tags(bp.id)
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
      case when public.demand_breakdown_visible(rd.dom_period_count, rd.req_count) then rd.dom_period end as dominant_period,
      case when public.demand_breakdown_visible(rd.dom_period_count, rd.req_count) then rd.dom_period_count end as dominant_period_count,
      case when public.demand_breakdown_visible(rd.dom_occasion_count, rd.req_count) then rd.dom_occasion end as dominant_occasion,
      case when public.demand_breakdown_visible(rd.dom_occasion_count, rd.req_count) then rd.dom_occasion_count end::bigint as dominant_occasion_count,
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

CREATE OR REPLACE FUNCTION public.get_partner_demand_signals(partner_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  k integer := public.demand_min_people();  -- minimum distinct people behind any returned signal (single source)
  window_days constant integer := 14;
  v_lat double precision;
  v_lng double precision;
  v_neighbor_buckets text[] := array[]::text[];
  v_dlat double precision;
  v_dlng double precision;
  v_cats text[];
  v_signals jsonb;
  v_ws date;
  v_we date;
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'Not authorized for this business';
  end if;

  -- Same definition of "the weekend" as get_occasion_demand_for_partner: the coming Friday through Sunday.
  v_ws := current_date + (((5 - extract(dow from current_date)::int) + 7) % 7);
  v_we := v_ws + 2;

  select latitude, longitude into v_lat, v_lng from public.brand_partners where id = partner_id_param;
  if v_lat is null or v_lng is null then
    return jsonb_build_object('min_people', k, 'window_days', window_days, 'signals', '[]'::jsonb);
  end if;

  foreach v_dlat in array array[-0.1::double precision, 0::double precision, 0.1::double precision] loop
    foreach v_dlng in array array[-0.1::double precision, 0::double precision, 0.1::double precision] loop
      v_neighbor_buckets := array_append(
        v_neighbor_buckets,
        (round((round(v_lat::numeric, 1)::double precision + v_dlat)::numeric, 1)::double precision)::text || ',' ||
        (round((round(v_lng::numeric, 1)::double precision + v_dlng)::numeric, 1)::double precision)::text
      );
    end loop;
  end loop;

  -- Item 128 follow-up (20270317): the categories this business OFFERS = business_offered_tags() (its own primary +
  -- secondary only), the same rule as get_aggregated_demand_for_partner and the "Growing demand nearby" push. No declared
  -- category = an empty set = no signals (never its whole group, never availability categories). Requests, searches and
  -- Interested gatherings all resolve against this one set.
  v_cats := public.business_offered_tags(partner_id_param);

  with events as (
    select br.requester_id as person, br.category, br.occasion, br.party_size,
           br.budget_min, br.budget_max, 'request'::text as source, br.id as req_id,
           br.date as req_date, br.time_window_start as req_time, br.attributes as req_attrs
    from public.business_requests br
    where br.parent_request_id is null
      and br.created_at > now() - make_interval(days => window_days)
      and br.category = any(v_cats)
      and br.requester_id <> auth.uid()
      and br.latitude is not null and br.longitude is not null
      and (3958.8 * acos(least(1.0, greatest(-1.0,
            cos(radians(v_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_lng)) +
            sin(radians(v_lat)) * sin(radians(br.latitude)))))) <= br.radius_miles
    union all
    select i.user_id, i.category, null, i.party_size, null, null, 'search', null::uuid,
           null::date, null::time, null::text[]
    from public.intent_submissions i
    where i.created_at > now() - make_interval(days => window_days)
      and i.category = any(v_cats)
      and i.intent_kind is distinct from 'business_partner'
      and i.user_id <> auth.uid()
      and i.wide_area = any(v_neighbor_buckets)
  ),
  cat as (
    select category, count(distinct person) as people from events group by category
    having count(distinct person) >= k
  ),
  bucketed as (
    select category, count(distinct person) as people,
      case when party_size <= 2 then '1-2' when party_size <= 4 then '3-4'
           when party_size <= 6 then '5-6' else '7+' end as bucket
    from events where party_size is not null
    group by 1, 3
    having count(distinct person) >= k
  ),
  top_bucket as (
    select distinct on (category) category, bucket, people from bucketed order by category, people desc
  ),
  budget as (
    select category,
      round((percentile_cont(0.25) within group (order by coalesce(budget_min, budget_max))) / 5) * 5 as low,
      round((percentile_cont(0.75) within group (order by coalesce(budget_max, budget_min))) / 5) * 5 as high
    from events
    where source = 'request' and (budget_min is not null or budget_max is not null)
    group by category
    having count(distinct person) >= k
  ),
  -- Unfulfilled: distinct people whose still-open request has no offer yet. Floored on its own (>= k) so a small
  -- unmet slice of a big category is never exposed.
  unfulfilled as (
    select e.category, count(distinct e.person) as people
    from events e
    where e.source = 'request'
      and exists (select 1 from public.business_requests r where r.id = e.req_id and r.status = 'open')
      and not exists (
        select 1 from public.business_request_offers o
        where o.request_id = e.req_id and o.status in ('offered', 'accepted', 'completed')
      )
    group by e.category
    having count(distinct e.person) >= k
  ),
  -- Supply: active businesses within 15 miles of this one that offer the category (business_offered_tags, the same rule;
  -- was bp.category, a group key that never equals a tag, so a business whose PRIMARY was the tag went uncounted).
  -- A count of businesses, no people.
  supply as (
    select u.category, count(*) as businesses
    from unfulfilled u
    join public.brand_partners bp
      on bp.active = true and bp.latitude is not null and bp.longitude is not null
     and u.category = any(public.business_offered_tags(bp.id))
     and (3958.8 * acos(least(1.0, greatest(-1.0,
            cos(radians(v_lat)) * cos(radians(bp.latitude)) * cos(radians(bp.longitude) - radians(v_lng)) +
            sin(radians(v_lat)) * sin(radians(bp.latitude)))))) <= 15
    group by u.category
  ),
  -- Most-requested (weekday, period) cell per category; requests with both a date and a time window only.
  when_cells as (
    select e.category,
      (array['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[extract(dow from e.req_date)::int + 1] as day_name,
      case when e.req_time < time '12:00' then 'morning' when e.req_time < time '17:00' then 'afternoon' else 'evening' end as period,
      count(distinct e.person) as people
    from events e
    where e.source = 'request' and e.req_date is not null and e.req_time is not null
    group by 1, 2, 3
    having count(distinct e.person) >= k
  ),
  top_when as (
    select distinct on (w.category) w.category, w.day_name, w.period, w.people
    from when_cells w
    join cat c on c.category = w.category
    where c.people - w.people = 0 or c.people - w.people >= k
    order by w.category, w.people desc, w.day_name, w.period
  ),
  outdoor as (
    select e.category, count(distinct e.person) as people
    from events e
    where e.source = 'request' and 'outdoor_seating' = any(coalesce(e.req_attrs, array[]::text[]))
    group by e.category
    having count(distinct e.person) >= k
  ),
  outdoor_ok as (
    select o.category from outdoor o join cat c on c.category = o.category
    where c.people - o.people = 0 or c.people - o.people >= k
  ),
  -- "This weekend": distinct people whose REQUEST is dated in the coming Fri-Sun (searches carry no date). Floored on its
  -- own (>= k) and complement-checked against the row's visible people count, like the day/time and outdoor facts.
  cat_weekend as (
    select e.category, count(distinct e.person) as people
    from events e
    where e.source = 'request' and e.req_date between v_ws and v_we
    group by e.category
    having count(distinct e.person) >= k
  ),
  cat_weekend_ok as (
    select w.category, w.people from cat_weekend w join cat c on c.category = w.category
    where c.people - w.people = 0 or c.people - w.people >= k
  ),
  cat_signals as (
    select c.people, jsonb_build_object(
      'kind', 'category', 'category', c.category, 'people_count', c.people,
      'party_bucket', tb.bucket, 'budget_low', b.low, 'budget_high', b.high,
      'unfulfilled_count', uf.people, 'supply_count', sp.businesses,
      'when_day', tw.day_name, 'when_period', tw.period,
      'outdoor', case when oo.category is not null then true end,
      'weekend_count', wk.people
    ) as j
    from cat c
    left join top_bucket tb on tb.category = c.category
    left join budget b on b.category = c.category
    left join unfulfilled uf on uf.category = c.category
    left join supply sp on sp.category = c.category
    left join top_when tw on tw.category = c.category
    left join outdoor_ok oo on oo.category = c.category
    left join cat_weekend_ok wk on wk.category = c.category
    order by c.people desc, c.category limit 3
  ),
  group_signals as (
    select count(distinct person) as people, jsonb_build_object(
      'kind', 'group', 'min_party', 6, 'people_count', count(distinct person),
      'weekend_count', case
        when count(distinct person) filter (where source = 'request' and req_date between v_ws and v_we) >= k
         and (count(distinct person) - count(distinct person) filter (where source = 'request' and req_date between v_ws and v_we) = 0
              or count(distinct person) - count(distinct person) filter (where source = 'request' and req_date between v_ws and v_we) >= k)
        then count(distinct person) filter (where source = 'request' and req_date between v_ws and v_we) end
    ) as j
    from events where party_size >= 6
    having count(distinct person) >= k
  ),
  occ_signals as (
    select count(distinct person) as people, jsonb_build_object(
      'kind', 'occasion', 'occasion', occasion, 'people_count', count(distinct person),
      'weekend_count', case
        when count(distinct person) filter (where req_date between v_ws and v_we) >= k
         and (count(distinct person) - count(distinct person) filter (where req_date between v_ws and v_we) = 0
              or count(distinct person) - count(distinct person) filter (where req_date between v_ws and v_we) >= k)
        then count(distinct person) filter (where req_date between v_ws and v_we) end
    ) as j
    from events where source = 'request' and occasion is not null
    group by occasion having count(distinct person) >= k
    order by 1 desc, occasion limit 2
  ),
  -- Interested in gatherings (20270117): a SEPARATE row kind with its own floor. Never merged into `events`/request
  -- counts, so no subtraction between rows can reconstruct a group under k. Distinct people (not marks), upcoming
  -- public "everyone" gatherings only, categories this business offers, this business's 3x3 area buckets, 14 days.
  -- Excludes women-only/community gatherings, the business's own hosted gatherings (first-party, not "local demand"),
  -- and anyone who opted out (profiles.share_interest_in_demand = false). Returns only category + count.
  interest_signals as (
    select count(distinct gd.user_id) as people, jsonb_build_object(
      'kind', 'gathering_interest', 'category', g.interest_tag, 'people_count', count(distinct gd.user_id)
    ) as j
    from public.gathering_interested gd
    join public.gatherings g on g.id = gd.gathering_id
    join public.profiles p on p.id = gd.user_id
    where gd.created_at > now() - make_interval(days => window_days)
      and g.scheduled_at > now()
      and g.is_public = true and g.visibility = 'everyone' and g.discoverable = true
      and coalesce(g.women_only, false) = false and g.community_id is null
      and g.interest_tag = any(v_cats)
      and g.wide_area = any(v_neighbor_buckets)
      and g.hosting_partner_id is distinct from partner_id_param
      and g.host_id <> auth.uid() and gd.user_id <> auth.uid()
      and coalesce(p.share_interest_in_demand, true)
    group by g.interest_tag
    having count(distinct gd.user_id) >= k
    order by 1 desc, g.interest_tag limit 2
  )
  select coalesce(jsonb_agg(j order by people desc), '[]'::jsonb) into v_signals
  from (select people, j from cat_signals union all select people, j from occ_signals union all select people, j from group_signals union all select people, j from interest_signals) u;

  return jsonb_build_object('min_people', k, 'window_days', window_days, 'signals', v_signals);
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_occasion_demand_for_partner(partner_id_param uuid)
 RETURNS TABLE(occasion_type text, request_count bigint, total_party_size bigint, soonest_date date, weekend_request_count bigint, dominant_category text, dominant_category_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lat double precision;
  v_lng double precision;
  v_weekend_start date;
  v_weekend_end date;
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

  -- The upcoming Friday-through-Sunday window (today counts if today
  -- already falls in it) -- a real, disclosed judgment call for what
  -- "this weekend" means, not a measured fact.
  v_weekend_start := current_date + (((5 - extract(dow from current_date)::int) + 7) % 7);
  v_weekend_end := v_weekend_start + 2;

  return query
  with nearby_open as (
    select br.requester_id as req_person, br.occasion as req_occasion, br.category as req_category, br.party_size, br.date as req_date
    from business_requests br
    where br.status = 'open'
    and br.expires_at > now()
    and br.occasion is not null
    and br.latitude is not null and br.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(v_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_lng)) +
        sin(radians(v_lat)) * sin(radians(br.latitude))
      ))
    )) <= br.radius_miles
  ),
  categories as (
    select req_occasion, req_category, count(distinct req_person) as cat_count
    from nearby_open
    where req_category is not null
    group by 1, 2
  ),
  ranked_categories as (
    select req_occasion, req_category, cat_count,
      row_number() over (partition by req_occasion order by cat_count desc) as rn
    from categories
  )
  select
    n.req_occasion as occasion_type,
    count(distinct n.req_person)::bigint as request_count,
    coalesce(sum(coalesce(n.party_size, 1)), 0)::bigint as total_party_size,
    min(n.req_date) as soonest_date,
    case when public.demand_breakdown_visible(count(distinct n.req_person) filter (where n.req_date between v_weekend_start and v_weekend_end), count(distinct n.req_person))
      then count(distinct n.req_person) filter (where n.req_date between v_weekend_start and v_weekend_end) else 0 end::bigint as weekend_request_count,
    case when public.demand_breakdown_visible(rc.cat_count, count(distinct n.req_person)) then rc.req_category end as dominant_category,
    case when public.demand_breakdown_visible(rc.cat_count, count(distinct n.req_person)) then rc.cat_count end as dominant_category_count
  from nearby_open n
  left join ranked_categories rc on rc.req_occasion = n.req_occasion and rc.rn = 1
  group by n.req_occasion, rc.req_category, rc.cat_count
  having count(distinct n.req_person) >= public.demand_min_people()
  order by count(distinct n.req_person) desc
  limit 10;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_aggregated_demand_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner record;
  v_prior_count integer;
  v_requester_counted boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  if new.status <> 'open' or new.category is null or new.latitude is null or new.longitude is null then
    return new;
  end if;


  for v_partner in
    select p.id, p.name, p.latitude, p.longitude
    from brand_partners p
    where p.active = true
    -- Item 128 follow-up (20270317): only a business that OFFERS this category (business_offered_tags: its own primary or
    -- a secondary; no group fallback) is told about demand for it.
    and new.category = any(public.business_offered_tags(p.id))
    and p.latitude is not null
    and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(p.latitude)) * cos(radians(new.latitude)) * cos(radians(new.longitude) - radians(p.longitude)) +
        sin(radians(p.latitude)) * sin(radians(new.latitude))
      ))
    )) <= new.radius_miles
  loop
    -- Real count of other open requests near THIS partner in the same
    -- category, mirroring get_aggregated_demand_for_partner()'s own
    -- "within the requester's own radius_miles of the business" rule.
    -- Distinct PEOPLE (not requests), excluding the row being inserted; the push fires only when this
    -- request brings the count to the shared privacy floor (demand_min_people()), so no business is ever
    -- told about a group smaller than that.
    select count(distinct br.requester_id), coalesce(bool_or(br.requester_id = new.requester_id), false)
    into v_prior_count, v_requester_counted
    from business_requests br
    where br.status = 'open'
      and br.expires_at > now()
      and br.category = new.category
      and br.id <> new.id
      and br.latitude is not null and br.longitude is not null
      and (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(v_partner.latitude)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_partner.longitude)) +
          sin(radians(v_partner.latitude)) * sin(radians(br.latitude))
        ))
      )) <= br.radius_miles;

    -- Same crossing-point-only rule as the group-intent trigger above --
    -- fires once when real nearby demand for this category first reaches
    -- 2, never again for the 3rd/4th/etc. request.
    if v_prior_count = public.demand_min_people() - 1 and not v_requester_counted then
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_partner.id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform public._send_push(v_managing_profiles[i], 'Growing demand nearby', '5 or more people are now looking for ' || new.category || ' near ' || v_partner.name || '.', jsonb_build_object('type', 'aggregated_demand_growing', 'partner_id', v_partner.id, 'category', new.category));
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$function$;
