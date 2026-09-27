-- Item 116, checks 6 and 7 (owner, 2026-09-27, LOCKED). Business routing stays filter-then-order, separate from consumer ranking.
--
-- Check 7, economics (a hard eligibility filter for AUTOMATIC routing only): a business whose ACTIVE fulfillment policy declares
-- a minimum spend per person is not routed a request whose per-person budget (business_requests.budget_max, whole dollars per
-- person) is BELOW it. Equal or above = eligible. No budget, no active policy, or no minimum = unknown = eligible, with no
-- economic boost or penalty. Applied in the fan-out (audit reason 'below_minimum_spend') and the three auto-offer matchers
-- (availability, package, policy), exactly where _business_declines_request already applies. A request the customer addressed
-- to ONE business (_route_request_to_partner) is unchanged.
--
-- Check 6, want more (rank only): a business whose "What do you want more of?" preferences the request clearly matches
-- (a wanted occasion or attribute; its time buckets, exact time window, weekday, last-minute or large-group choice) moves up
-- among ELIGIBLE businesses: one boolean key in the existing lexicographic order, after every capacity/occasion/tag/dietary/
-- attribute key and before track record and distance. It never excludes, never makes an ineligible business eligible, and
-- never beats a stronger key. Same match rules as the dashboard's scoreBusinessOpportunity (services/businessOpportunityScoring.js).
-- No "don't send me X" exclusion exists. Nothing new is shown to any business.

create or replace function public._business_below_min_spend(partner_id_param uuid, request_id_param uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from business_requests r
    join business_fulfillment_policies f on f.partner_id = partner_id_param and f.active = true
    where r.id = request_id_param
      and r.budget_max is not null
      and f.min_spend_per_person is not null
      and r.budget_max < f.min_spend_per_person
  );
$$;
revoke all on function public._business_below_min_spend(uuid, uuid) from public, anon, authenticated;

create or replace function public._business_wants_request(partner_id_param uuid, request_id_param uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce((
    select
      (r.occasion is not null and r.occasion = any(coalesce(p.priority_occasions, '{}')))
      or (coalesce(r.attributes, '{}') && coalesce(p.priority_attributes, '{}'))
      -- morning / afternoon / evening / weekend, only when the request has both a date and a time (getTimePeriod)
      or (r.date is not null and r.time_window_start is not null and (
            case when extract(dow from r.date) in (0, 6) then 'weekend'
                 when r.time_window_start < time '12:00' then 'morning'
                 when r.time_window_start < time '18:00' then 'afternoon'
                 else 'evening' end) = any(coalesce(p.priority_time_windows, '{}')))
      or (r.time_window_start is not null and p.priority_time_start is not null and p.priority_time_end is not null
          and r.time_window_start between p.priority_time_start and p.priority_time_end)
      or (r.date is not null and 'weekday' = any(coalesce(p.priority_time_windows, '{}')) and extract(dow from r.date) between 1 and 5)
      or (r.date is not null and 'last_minute' = any(coalesce(p.priority_time_windows, '{}')) and r.date between current_date and current_date + 1)
      or (r.party_size is not null and r.party_size >= 7 and 'large_group' = any(coalesce(p.priority_time_windows, '{}')))
    from business_requests r, brand_partners p
    where r.id = request_id_param and p.id = partner_id_param
  ), false);
$$;
revoke all on function public._business_wants_request(uuid, uuid) from public, anon, authenticated;

-- the audit's vocabularies gain the new reason and signal
alter table public.routing_candidates drop constraint if exists routing_candidates_reason_vocab;
alter table public.routing_candidates add constraint routing_candidates_reason_vocab check (reason_codes <@ array[
  'outside_geo_range', 'wrong_category', 'wrong_cuisine', 'restriction_conflict', 'capacity_too_small', 'unavailable',
  'below_minimum_spend', 'below_routing_cutoff']::text[]);
alter table public.routing_candidates drop constraint if exists routing_candidates_signal_vocab;
alter table public.routing_candidates add constraint routing_candidates_signal_vocab check (signals <@ array[
  'occasion_offered', 'exact_tag', 'group_size_fits', 'deprioritized_size', 'dietary_all_declared', 'attribute_match', 'wants_more',
  'established_record', 'directed_by_customer', 'availability_posting', 'occasion_package', 'standing_policy',
  'upgraded_routed_opportunity']::text[]);

CREATE OR REPLACE FUNCTION public._business_request_fanout(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_filter_param text[] DEFAULT NULL::text[], business_major_filter_param text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_notified_count integer := 0;
  v_req_attributes text[];
  v_req_dietary text[];
  v_req_cuisine text;
  v_req_occasion text;
  v_req_category text;
  v_req_group text;
  v_req_party integer;
  v_children boolean;
  v_pets boolean;
  v_outdoor boolean;
  v_consider double precision;
  v_cands jsonb;
  v_decision bigint;
  service_key text;
  v_row record;
  v_managing_profiles uuid[];
  i integer;
begin
  select attributes, cuisine, occasion, category, party_size, dietary
    into v_req_attributes, v_req_cuisine, v_req_occasion, v_req_category, v_req_party, v_req_dietary
  from business_requests where id = request_id_param;
  -- Category-aware routing (20270130): a request whose category maps to a group only reaches businesses in that
  -- group (declared tags or major). No category / unmapped category = unfiltered, as before. Deterministic, no AI.
  v_req_group := public.request_category_group(v_req_category);
  -- the same request facts _business_declines_request derives (used only to name the reason, never to decide)
  v_children := coalesce(v_req_attributes, '{}') && array['kid_friendly', 'kid_menu', 'family_seating', 'stroller_friendly'];
  v_pets := coalesce(v_req_attributes, '{}') && array['dog_friendly', 'pet_friendly'];
  v_outdoor := 'outdoor_seating' = any(coalesce(v_req_attributes, '{}'));
  v_consider := least(greatest(radius_miles_param * 2, radius_miles_param + 10), 100);
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  with considered as (
    select p.id, p.attributes, p.dietary_options, p.cuisine, p.offered_occasions, p.max_group_size,
           p.private_room_capacity, p.outdoor_capacity,
           (3958.8 * acos(least(1.0, greatest(-1.0,
              cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
              sin(radians(latitude_param)) * sin(radians(p.latitude)))))) as distance_miles,
           ((category_filter_param is null or p.subcategory = any(category_filter_param) or p.categories && category_filter_param)
             and (business_major_filter_param is null or p.category = business_major_filter_param)
             and (v_req_group is null or public.business_in_category_group(p.id, v_req_group))) as cat_ok,
           -- item 86: a business that declared something this request conflicts with is never routed it
           public._business_declines_request(p.id, request_id_param) as declines,
           (v_req_party is not null and p.max_group_size is not null and p.max_group_size < v_req_party) as cap_small,
           (public._business_declines(p.id, null, v_children, v_pets, v_outdoor, false, false) is not null) as other_conflict,
           -- item 116 step 2: known closed at the requested time (declared hours / temporary closure), with no live posting covering it
           public._business_closed_for_request(p.id, request_id_param) as closed_then,
           -- item 116 check 7: the request's per-person budget is below the business's declared minimum spend (both known)
           public._business_below_min_spend(p.id, request_id_param) as below_min
    from brand_partners p
    where p.active = true and p.latitude is not null and p.longitude is not null
  ),
  near as (select * from considered where distance_miles <= v_consider),
  reputation as (
    select partner_id, count(*) as total_opportunities,
           round(100.0 * count(*) filter (where status = 'completed')
                 / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
    from business_request_offers group by partner_id
  ),
  scored as (
    select e.*, r.total_opportunities, r.completion_rate,
      -- item 80: a business whose DECLARED largest group is below the party size goes last (strongly de-prioritized, not removed)
      -- item 81: or the space the request asks for (private room / outdoor area, only while that capability is declared) is too small
      (v_req_party is not null and (
        (e.max_group_size is not null and e.max_group_size < v_req_party)
        or ('private_dining' = any(coalesce(v_req_attributes, '{}')) and 'private_dining' = any(coalesce(e.attributes, '{}'))
            and e.private_room_capacity is not null and e.private_room_capacity < v_req_party)
        or ('outdoor_seating' = any(coalesce(v_req_attributes, '{}')) and 'outdoor_seating' = any(coalesce(e.attributes, '{}'))
            and e.outdoor_capacity is not null and e.outdoor_capacity < v_req_party))) as k_deprio,
      -- a business that explicitly says it offers this occasion is routed the request first
      (v_req_occasion is not null and v_req_occasion = any(e.offered_occasions)) as k_occ,
      -- a business that serves the exact requested tag (a coffee shop for a coffee request) goes ahead of group-only matches
      (v_req_category is not null and v_req_category = any(public.business_served_tags(e.id))) as k_exact,
      -- item 80: a declared largest group that covers the party goes ahead of an unknown one
      (v_req_party is not null and (
        (e.max_group_size is not null and e.max_group_size >= v_req_party)
        or ('private_dining' = any(coalesce(v_req_attributes, '{}')) and 'private_dining' = any(coalesce(e.attributes, '{}'))
            and e.private_room_capacity is not null and e.private_room_capacity >= v_req_party)
        or ('outdoor_seating' = any(coalesce(v_req_attributes, '{}')) and 'outdoor_seating' = any(coalesce(e.attributes, '{}'))
            and e.outdoor_capacity is not null and e.outdoor_capacity >= v_req_party))) as k_fits,
      -- item 88: a business that declared every dietary need of the request goes ahead of one that did not say
      (cardinality(coalesce(v_req_dietary, '{}')) > 0 and coalesce(e.dietary_options, '{}') @> v_req_dietary) as k_diet,
      (cardinality(array(select unnest(coalesce(e.attributes, '{}')) intersect select unnest(coalesce(v_req_attributes, '{}'))))
        + (case when v_req_cuisine is not null and e.cuisine = v_req_cuisine then 1 else 0 end)) as k_overlap,
      -- item 116 check 6: the request clearly matches something the business said it wants more of (rank only, never eligibility)
      public._business_wants_request(e.id, request_id_param) as k_want,
      (r.total_opportunities is not null and r.total_opportunities >= 5) as k_established
    from near e
    left join reputation r on r.partner_id = e.id
    where e.cat_ok and not e.declines and not e.closed_then and not e.below_min and e.distance_miles <= radius_miles_param
  ),
  ranked as (
    select s.*, row_number() over (order by
      s.k_deprio asc, s.k_occ desc, s.k_exact desc, s.k_fits desc, s.k_diet desc, s.k_overlap desc, s.k_want desc, s.k_established desc,
      s.completion_rate desc nulls last, s.distance_miles asc, s.id asc) as rn
    from scored s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', n.id, 'distance', round(n.distance_miles::numeric, 2), 'rn', k.rn,
      'reasons', array(select x from unnest(array[
          case when n.distance_miles > radius_miles_param then 'outside_geo_range' end,
          case when not n.cat_ok then 'wrong_category' end,
          case when n.declines and (n.other_conflict or not n.cap_small) then 'restriction_conflict' end,
          case when n.declines and n.cap_small then 'capacity_too_small' end,
          case when n.closed_then then 'unavailable' end,  -- the audit's existing code for this
          case when n.below_min then 'below_minimum_spend' end,
          case when k.rn > 10 then 'below_routing_cutoff' end]) x where x is not null),
      'signals', array(select x from unnest(array[
          case when k.k_occ then 'occasion_offered' end,
          case when k.k_exact then 'exact_tag' end,
          case when k.k_fits then 'group_size_fits' end,
          case when k.k_deprio then 'deprioritized_size' end,
          case when k.k_diet then 'dietary_all_declared' end,
          case when k.k_overlap > 0 then 'attribute_match' end,
          case when k.k_want then 'wants_more' end,
          case when k.k_established then 'established_record' end]) x where x is not null),
      'sort_key', case when k.id is not null then jsonb_build_object(
          'deprioritized_size', k.k_deprio, 'occasion_offered', k.k_occ, 'exact_tag', k.k_exact, 'group_size_fits', k.k_fits,
          'dietary_all_declared', k.k_diet, 'attribute_overlap', k.k_overlap, 'wants_more', k.k_want, 'established_record', k.k_established,
          'completion_rate', k.completion_rate, 'distance_miles', round(k.distance_miles::numeric, 2)) end,
      'in_range', n.distance_miles <= radius_miles_param) order by k.rn nulls last, n.distance_miles), '[]'::jsonb)
  into v_cands
  from near n left join ranked k on k.id = n.id;

  perform set_config('app.routing_path', 'fanout', true);
  for v_row in
    insert into business_request_offers (request_id, partner_id)
    select request_id_param, (c->>'id')::uuid
    from jsonb_array_elements(v_cands) c
    where (c->>'rn')::int <= 10
    order by (c->>'rn')::int
    returning partner_id
  loop
    v_notified_count := v_notified_count + 1;

    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_row.partner_id;
    if v_managing_profiles is not null then
      for i in 1 .. array_length(v_managing_profiles, 1) loop
        continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
        -- Only urgent requests ping immediately; the rest are gathered into the hourly digest (send_business_opportunity_digests).
        continue when not public._opportunity_is_urgent(request_id_param);
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_managing_profiles[i],
            'title', 'New opportunity nearby!',
            'body', 'New request: ' || public.business_safe_request_summary(request_id_param),
            'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
          )
        );
      end loop;
    end if;
  end loop;
  perform set_config('app.routing_path', '', true);

  -- The audit: never blocks routing. A failure is recorded and routing continues unchanged.
  begin
    insert into routing_decisions (request_id, path, rules_version, request_radius_miles, consideration_radius_miles,
                                   request_snapshot, considered_count, in_range_count, eligible_count, chosen_count)
    values (request_id_param, 'fanout', _routing_rules_version('fanout'), radius_miles_param, v_consider,
            _routing_request_snapshot(request_id_param) || jsonb_build_object(
              'category_filter', category_filter_param, 'major_filter', business_major_filter_param),
            jsonb_array_length(v_cands),
            (select count(*) from jsonb_array_elements(v_cands) c where (c->>'in_range')::boolean),
            (select count(*) from jsonb_array_elements(v_cands) c where c->>'rn' is not null),
            v_notified_count)
    returning id into v_decision;
    insert into routing_candidates (decision_id, partner_id, outcome, rank, primary_reason, reason_codes, signals, sort_key, distance_miles)
    select v_decision, (c->>'id')::uuid,
           case when (c->>'rn')::int <= 10 then 'chosen' else 'excluded' end,
           (c->>'rn')::int,
           case when (c->>'rn')::int <= 10 then null else c->'reasons'->>0 end,
           case when (c->>'rn')::int <= 10 then '{}'::text[] else array(select jsonb_array_elements_text(c->'reasons')) end,
           array(select jsonb_array_elements_text(c->'signals')),
           c->'sort_key', (c->>'distance')::numeric
    from jsonb_array_elements(v_cands) c;
  exception when others then
    perform _routing_record_failure(request_id_param, 'fanout', sqlerrm);
  end;

  return v_notified_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public._match_request_to_availability_core(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_param text, date_param date, time_window_start_param time without time zone, time_window_end_param time without time zone, preferred_availability_id_param uuid DEFAULT NULL::uuid, party_size_param integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  service_key text;
  v_avail record;
  v_preferred record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  if preferred_availability_id_param is not null then
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    into v_preferred
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
    where ba.id = preferred_availability_id_param
    and ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or party_size_param is null or ba.remaining_capacity >= party_size_param)
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param;

    if found then
      select exists(
        select 1 from business_request_offers
        where request_id = request_id_param and partner_id = v_preferred.partner_id
      ) into v_already_offered;

      insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
      values (request_id_param, v_preferred.partner_id, v_preferred.offer_type, coalesce(v_preferred.description, v_preferred.title), v_preferred.price, v_preferred.id, 'offered', now())
      on conflict (request_id, partner_id) do update
        set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
            offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
        where business_request_offers.status = 'pending';

      if found then
        if not v_already_offered then
          v_new_count := v_new_count + 1;
        end if;

        if service_key is null then
          select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
        end if;
        select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_preferred.partner_id;
        if v_managing_profiles is not null then
          for i in 1 .. array_length(v_managing_profiles, 1) loop
            continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
            perform net.http_post(
              url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
              headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
              body := jsonb_build_object(
                'recipient_id', v_managing_profiles[i],
                'title', 'Your availability was just matched!',
                'body', '"' || v_preferred.title || '" matches a new request: ' || coalesce(public.business_safe_request_summary(request_id_param), 'a new request'),
                'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
              )
            );
          end loop;
        end if;
      end if;
    end if;
  end if;

  for v_avail in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
    left join reputation r on r.partner_id = ba.partner_id
    where ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or party_size_param is null or ba.remaining_capacity >= party_size_param)
    and (preferred_availability_id_param is null or ba.id != preferred_availability_id_param)
    and (category_param is null or ba.category is null or ba.category = category_param)
    and p.latitude is not null and p.longitude is not null
    and (
      date_param is null
      or date_param between ba.starts_at::date and ba.ends_at::date
    )
    and (
      date_param is null or time_window_start_param is null or time_window_end_param is null
      or (date_param + time_window_start_param, date_param + time_window_end_param)
         overlaps (ba.starts_at, ba.ends_at)
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= least(radius_miles_param, ba.radius_miles)
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      ba.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_avail.partner_id
    ) into v_already_offered;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (request_id_param, v_avail.partner_id, v_avail.offer_type, coalesce(v_avail.description, v_avail.title), v_avail.price, v_avail.id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      if service_key is null then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      end if;
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_avail.partner_id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Your availability was just matched!',
              'body', '"' || v_avail.title || '" matches a new request: ' || coalesce(public.business_safe_request_summary(request_id_param), 'a new request'),
              'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  -- Missed-match instrumentation (Phase 4). Priority order, now with the
  -- real party-size feasibility case inserted between the two existing
  -- capacity-adjacent reasons: an explicit category mismatch is still the
  -- most legible reason; then zero remaining capacity; then a real but
  -- insufficient remaining capacity for the requester's own party size;
  -- then, by elimination, a date/time overlap failure.
  insert into business_match_exclusions (request_id, partner_id, source, reason, availability_id)
  select
    request_id_param,
    ba.partner_id,
    'availability',
    case
      when category_param is not null and ba.category is not null and ba.category <> category_param then 'category_mismatch'
      when not (ba.remaining_capacity is null or ba.remaining_capacity > 0) then 'zero_capacity'
      when party_size_param is not null and ba.remaining_capacity is not null and ba.remaining_capacity < party_size_param then 'insufficient_capacity'
      else 'date_or_time_mismatch'
    end,
    ba.id
  from business_availability ba
  join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
  where ba.status = 'active'
  and ba.ends_at > now()
  and (preferred_availability_id_param is null or ba.id != preferred_availability_id_param)
  and p.latitude is not null and p.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
      sin(radians(latitude_param)) * sin(radians(p.latitude))
    ))
  )) <= least(radius_miles_param, ba.radius_miles)
  and not (
    (ba.remaining_capacity is null or ba.remaining_capacity > 0)
    and (party_size_param is null or ba.remaining_capacity is null or ba.remaining_capacity >= party_size_param)
    and (category_param is null or ba.category is null or ba.category = category_param)
    and (date_param is null or date_param between ba.starts_at::date and ba.ends_at::date)
    and (
      date_param is null or time_window_start_param is null or time_window_end_param is null
      or (date_param + time_window_start_param, date_param + time_window_end_param)
         overlaps (ba.starts_at, ba.ends_at)
    )
  )
  on conflict (request_id, partner_id, availability_id) where source = 'availability' do nothing;

  return v_new_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public._match_request_to_package_core(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, occasion_param text, party_size_param integer, date_param date, preferred_package_id_param uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  service_key text;
  v_pkg record;
  v_preferred record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  v_offer_price numeric;
  v_price_is_per_person boolean;
  i integer;
begin
  if occasion_param is null then
    return 0;
  end if;

  select raw_text into v_raw_text from business_requests where id = request_id_param;

  if preferred_package_id_param is not null then
    select bop.*, p.latitude as partner_lat, p.longitude as partner_lng
    into v_preferred
    from business_occasion_packages bop
    join brand_partners p on p.id = bop.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param) and not public._business_closed_for_request(p.id, request_id_param)
    where bop.id = preferred_package_id_param
    and bop.active = true
    and bop.occasion_type = occasion_param
    and (bop.min_guests is null or party_size_param is null or party_size_param >= bop.min_guests)
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param;

    if found then
      v_offer_price := case
        when v_preferred.price_per_person is not null and party_size_param is not null
          then v_preferred.price_per_person * party_size_param
        else v_preferred.price_per_person
      end;
      -- Genuinely per-person only when a real rate exists AND it could NOT
      -- be multiplied into a total (party size unknown) -- the exact other
      -- half of the case expression directly above, never re-derived
      -- separately so the two can't drift apart.
      v_price_is_per_person := (v_preferred.price_per_person is not null and party_size_param is null);

      select exists(
        select 1 from business_request_offers
        where request_id = request_id_param and partner_id = v_preferred.partner_id
      ) into v_already_offered;

      insert into business_request_offers (
        request_id, partner_id, offer_type, offer_description, offer_title, included_items,
        offer_price, price_is_per_person, package_id, status, responded_at
      )
      values (
        request_id_param, v_preferred.partner_id, 'standard',
        v_preferred.name || coalesce(': ' || v_preferred.description, ''),
        v_preferred.name, v_preferred.included_items,
        v_offer_price, v_price_is_per_person, v_preferred.id, 'offered', now()
      )
      on conflict (request_id, partner_id) do update
        set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
            offer_title = excluded.offer_title, included_items = excluded.included_items,
            offer_price = excluded.offer_price, price_is_per_person = excluded.price_is_per_person,
            package_id = excluded.package_id, responded_at = now()
        where business_request_offers.status = 'pending';

      if found then
        if not v_already_offered then
          v_new_count := v_new_count + 1;
        end if;

        if service_key is null then
          select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
        end if;
        select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_preferred.partner_id;
        if v_managing_profiles is not null then
          for i in 1 .. array_length(v_managing_profiles, 1) loop
            perform net.http_post(
              url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
              headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
              body := jsonb_build_object(
                'recipient_id', v_managing_profiles[i],
                'title', 'Your occasion package was just matched!',
                'body', '"' || v_preferred.name || '" matches a new request: ' || coalesce(public.business_safe_request_summary(request_id_param), 'a new request'),
                'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
              )
            );
          end loop;
        end if;
      end if;
    end if;
  end if;

  for v_pkg in
    select bop.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_occasion_packages bop
    join brand_partners p on p.id = bop.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param) and not public._business_closed_for_request(p.id, request_id_param)
    where bop.active = true
    and bop.occasion_type = occasion_param
    and (preferred_package_id_param is null or bop.id != preferred_package_id_param)
    and (bop.min_guests is null or party_size_param is null or party_size_param >= bop.min_guests)
    and (
      date_param is null or bop.available_days is null
      or extract(dow from date_param)::smallint = any(bop.available_days)
    )
    and p.latitude is not null and p.longitude is not null
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by bop.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_pkg.partner_id
    ) into v_already_offered;

    v_offer_price := case
      when v_pkg.price_per_person is not null and party_size_param is not null
        then v_pkg.price_per_person * party_size_param
      else v_pkg.price_per_person
    end;
    v_price_is_per_person := (v_pkg.price_per_person is not null and party_size_param is null);

    insert into business_request_offers (
      request_id, partner_id, offer_type, offer_description, offer_title, included_items,
      offer_price, price_is_per_person, package_id, status, responded_at
    )
    values (
      request_id_param, v_pkg.partner_id, 'standard',
      v_pkg.name || coalesce(': ' || v_pkg.description, ''),
      v_pkg.name, v_pkg.included_items,
      v_offer_price, v_price_is_per_person, v_pkg.id, 'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_title = excluded.offer_title, included_items = excluded.included_items,
          offer_price = excluded.offer_price, price_is_per_person = excluded.price_is_per_person,
          package_id = excluded.package_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      if service_key is null then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      end if;
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_pkg.partner_id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Your occasion package was just matched!',
              'body', '"' || v_pkg.name || '" matches a new request: ' || coalesce(public.business_safe_request_summary(request_id_param), 'a new request'),
              'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  return v_new_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public._match_request_to_policy_core(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, party_size_param integer, time_window_start_param time without time zone, time_window_end_param time without time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  v_request_date date;
  service_key text;
  v_policy record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text, date into v_raw_text, v_request_date from business_requests where id = request_id_param;

  for v_policy in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select bfp.*, p.latitude as partner_lat, p.longitude as partner_lng, p.name as partner_name
    from business_fulfillment_policies bfp
    join brand_partners p on p.id = bfp.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
      and not public._business_closed_for_request(p.id, request_id_param)
    left join reputation r on r.partner_id = bfp.partner_id
    where bfp.active = true
    and bfp.auto_accept_party_size_max is not null
    and p.latitude is not null and p.longitude is not null
    and (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
    and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
    and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
    and (
      bfp.active_hours_start is null or bfp.active_hours_end is null
      or time_window_start_param is null or time_window_end_param is null
      or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
    )
    and (
      bfp.active_days is null or v_request_date is null
      or extract(dow from v_request_date)::smallint = any(bfp.active_days)
    )
    and (
      not bfp.weather_dependent
      or bfp.last_rain_risk is distinct from 'high'
      or bfp.last_weather_checked_at is null
      or bfp.last_weather_checked_at <= now() - interval '3 hours'
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= radius_miles_param
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      bfp.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_policy.partner_id
    ) into v_already_offered;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, status, responded_at)
    values (
      request_id_param, v_policy.partner_id, 'standard',
      'Automatically accepted -- within ' || coalesce(v_policy.partner_name, 'this business') || '''s standing party-size policy.',
      'offered', now()
    )
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      if service_key is null then
        select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
      end if;
      select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_policy.partner_id;
      if v_managing_profiles is not null then
        for i in 1 .. array_length(v_managing_profiles, 1) loop
          continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
          perform net.http_post(
            url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
            headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
            body := jsonb_build_object(
              'recipient_id', v_managing_profiles[i],
              'title', 'Auto-accepted a new request!',
              'body', 'Your fulfillment policy auto-accepted: ' || coalesce(public.business_safe_request_summary(request_id_param), 'a new request'),
              'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
            )
          );
        end loop;
      end if;
    end if;
  end loop;

  -- Missed-match instrumentation: priority order stays the same reasoning
  -- as before -- can't auto-accept at all, then party size, then hours,
  -- then active days (the new predicate, inserted before weather so
  -- weather stays the real catch-all it already was), and by elimination
  -- weather is the only real predicate left once the first four all pass.
  insert into business_match_exclusions (request_id, partner_id, source, reason, availability_id)
  select
    request_id_param,
    bfp.partner_id,
    'policy',
    case
      when bfp.auto_accept_party_size_max is null then 'no_auto_accept'
      when not (
        (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
        and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
        and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
      ) then 'party_size_out_of_range'
      when public._business_closed_for_request(bfp.partner_id, request_id_param) then 'hours_mismatch'  -- item 116: known closed then
      when not (
        bfp.active_hours_start is null or bfp.active_hours_end is null
        or time_window_start_param is null or time_window_end_param is null
        or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
      ) then 'hours_mismatch'
      when not (
        bfp.active_days is null or v_request_date is null
        or extract(dow from v_request_date)::smallint = any(bfp.active_days)
      ) then 'active_days_mismatch'
      else 'weather_unfavorable'
    end,
    null
  from business_fulfillment_policies bfp
  join brand_partners p on p.id = bfp.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
  where bfp.active = true
  and p.latitude is not null and p.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
      sin(radians(latitude_param)) * sin(radians(p.latitude))
    ))
  )) <= radius_miles_param
  and not (
    bfp.auto_accept_party_size_max is not null
    and (party_size_param is null or party_size_param <= bfp.auto_accept_party_size_max)
    and (bfp.party_size_min is null or party_size_param is null or party_size_param >= bfp.party_size_min)
    and (bfp.party_size_max is null or party_size_param is null or party_size_param <= bfp.party_size_max)
    and (
      bfp.active_hours_start is null or bfp.active_hours_end is null
      or time_window_start_param is null or time_window_end_param is null
      or (time_window_start_param, time_window_end_param) overlaps (bfp.active_hours_start, bfp.active_hours_end)
    )
    and (
      bfp.active_days is null or v_request_date is null
      or extract(dow from v_request_date)::smallint = any(bfp.active_days)
    )
    and (
      not bfp.weather_dependent
      or bfp.last_rain_risk is distinct from 'high'
      or bfp.last_weather_checked_at is null
      or bfp.last_weather_checked_at <= now() - interval '3 hours'
    )
    and not public._business_closed_for_request(bfp.partner_id, request_id_param)
  )
  on conflict (request_id, partner_id) where source = 'policy' do nothing;

  return v_new_count;
end;
$function$;

create or replace function public._routing_rules_version(path_param text)
returns text
language sql
immutable
as $function$
  select case path_param
    when 'fanout' then 'fanout.2026-09-27.3'          -- + item 116 checks 6/7: below minimum spend excluded; want-more ranks
    when 'directed' then 'directed.2026-09-27.1'
    when 'availability' then 'availability.2026-09-27.2'  -- + item 116 check 7
    when 'package' then 'package.2026-09-27.3'        -- + item 116 check 7
    when 'policy' then 'policy.2026-09-27.3'          -- + item 116 check 7
  end
$function$;
