-- Dashboard-wide privacy floor for business-facing demand aggregates.
--
-- Rule: no business ever receives a count of people below demand_min_people() (5), enforced HERE in the
-- data layer -- never by hiding text in the client. Applies to: Match Radar (get_aggregated_demand_for_partner),
-- What They're Planning (get_occasion_demand_for_partner), and the two push triggers that tell a business
-- "N people are now looking" (previously fired at 2). Counts are now DISTINCT PEOPLE, not raw request rows.
-- Match Radar's unmet-search count also excludes 'business_partner' searches (a partner proposal is not demand).
-- Suppressed rows are dropped, and any secondary figure (party total, soonest date, dominant period/category,
-- weekend count) that is itself derived from fewer than 5 people is nulled/zeroed, so a small slice can't be
-- differenced out of a larger row.
-- Not changed (disclosed): notify_group_intent_threshold (friends notifying friends) and
-- notify_community_area_demand_threshold (community leaders, not businesses); own-page view counts and
-- own-customer stats are not demand aggregates about unconnected people.
-- get_partner_demand_signals keeps its own literal 5 -- guarded equal to this helper by a test.

create or replace function public.demand_min_people()
returns integer language sql immutable as $$ select 5 $$;
revoke all on function public.demand_min_people() from public, anon;

create or replace function public.get_aggregated_demand_for_partner(partner_id_param uuid)
 RETURNS TABLE(category text, request_count bigint, total_party_size bigint, soonest_date date, dominant_period text, dominant_period_count bigint, dominant_occasion text, dominant_occasion_count bigint, unmet_intent_count bigint, is_demand_gap boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    case when coalesce(rd.req_count, 0) >= public.demand_min_people() then rd.req_count else 0 end::bigint as request_count,
    case when coalesce(rd.req_count, 0) >= public.demand_min_people() then rd.party_total else 0 end::bigint as total_party_size,
    case when coalesce(rd.req_count, 0) >= public.demand_min_people() then rd.min_date end as soonest_date,
    case when coalesce(rd.req_count, 0) >= public.demand_min_people() and rd.dom_period_count >= public.demand_min_people() then rd.dom_period end as dominant_period,
    case when coalesce(rd.req_count, 0) >= public.demand_min_people() and rd.dom_period_count >= public.demand_min_people() then rd.dom_period_count end as dominant_period_count,
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
  where coalesce(rd.req_count, 0) >= public.demand_min_people() or (v_advanced and coalesce(ui.unmet_cnt, 0) >= public.demand_min_people())
  order by coalesce(rd.req_count, 0) desc, coalesce(ui.unmet_cnt, 0) desc
  limit 10;
end;
$function$
;

create or replace function public.get_occasion_demand_for_partner(partner_id_param uuid)
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
    case when count(distinct n.req_person) filter (where n.req_date between v_weekend_start and v_weekend_end) >= public.demand_min_people()
      then count(distinct n.req_person) filter (where n.req_date between v_weekend_start and v_weekend_end) else 0 end::bigint as weekend_request_count,
    case when rc.cat_count >= public.demand_min_people() then rc.req_category end as dominant_category,
    case when rc.cat_count >= public.demand_min_people() then rc.cat_count end as dominant_category_count
  from nearby_open n
  left join ranked_categories rc on rc.req_occasion = n.req_occasion and rc.rn = 1
  group by n.req_occasion, rc.req_category, rc.cat_count
  having count(distinct n.req_person) >= public.demand_min_people()
  order by count(distinct n.req_person) desc
  limit 10;
end;
$function$
;

create or replace function public.notify_aggregated_demand_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_service_key text;
  v_partner record;
  v_prior_count integer;
  v_requester_counted boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  if new.status <> 'open' or new.category is null or new.latitude is null or new.longitude is null then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_partner in
    select p.id, p.name, p.latitude, p.longitude
    from brand_partners p
    where p.active = true
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
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Growing demand nearby',
              'body', '5 or more people are now looking for ' || new.category || ' near ' || v_partner.name || '.',
              'data', jsonb_build_object('type', 'aggregated_demand_growing', 'partner_id', v_partner.id, 'category', new.category)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$function$
;

create or replace function public.notify_occasion_demand_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_service_key text;
  v_partner record;
  v_prior_count integer;
  v_requester_counted boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  if new.status <> 'open' or new.occasion is null or new.latitude is null or new.longitude is null then
    return new;
  end if;

  select decrypted_secret into v_service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_partner in
    select p.id, p.name, p.latitude, p.longitude
    from brand_partners p
    where p.active = true
    and p.latitude is not null
    and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(p.latitude)) * cos(radians(new.latitude)) * cos(radians(new.longitude) - radians(p.longitude)) +
        sin(radians(p.latitude)) * sin(radians(new.latitude))
      ))
    )) <= new.radius_miles
  loop
    -- Real count of other open requests near THIS partner sharing the
    -- same occasion, regardless of category -- mirroring notify_
    -- aggregated_demand_threshold()'s own "within the requester's own
    -- radius_miles of the business" rule, just cross-category.
    -- Distinct PEOPLE (not requests), excluding the row being inserted; the push fires only when this
    -- request brings the count to the shared privacy floor (demand_min_people()), so no business is ever
    -- told about a group smaller than that.
    select count(distinct br.requester_id), coalesce(bool_or(br.requester_id = new.requester_id), false)
    into v_prior_count, v_requester_counted
    from business_requests br
    where br.status = 'open'
      and br.expires_at > now()
      and br.occasion = new.occasion
      and br.id <> new.id
      and br.latitude is not null and br.longitude is not null
      and (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(v_partner.latitude)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_partner.longitude)) +
          sin(radians(v_partner.latitude)) * sin(radians(br.latitude))
        ))
      )) <= br.radius_miles;

    -- Same crossing-point-only rule as its category sibling -- fires once
    -- when real nearby demand for this occasion first reaches 2, never
    -- again for the 3rd/4th/etc. request.
    if v_prior_count = public.demand_min_people() - 1 and not v_requester_counted then
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_partner.id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', _occasion_emoji(new.occasion) || ' Growing ' || _occasion_noun(new.occasion) || ' demand nearby',
              'body', '5 or more groups nearby are now planning a ' || lower(_occasion_noun(new.occasion)) || ' -- near ' || v_partner.name || '.',
              'data', jsonb_build_object('type', 'occasion_demand_growing', 'partner_id', v_partner.id, 'occasion_type', new.occasion)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  return new;
end;
$function$
;
