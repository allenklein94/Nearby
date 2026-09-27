-- Item 116, step 2 only (owner, 2026-09-27, LOCKED scope): business routing must not send a request to a business that is
-- KNOWN closed at the requested time. A live-market eligibility bug, not a ranking change.
--   known closed at the requested date/time -> excluded       temporarily closed -> excluded
--   known open -> eligible                                    unknown hours -> eligible (unknown is not closed)
--   a live availability posting covering the requested time -> eligible (it establishes availability)
--   no requested date -> unchanged (nothing is known); a date with no time -> excluded only when that whole day is declared
--   closed (or the business is temporarily closed)
-- Not changed: minimum spend / budget, "want more", any ranking weight, Open-now surfaces, directed (one-business) requests.
--
-- _business_hours_status is an exact port of the ONE app evaluator hoursStatus() (src/utils/operatingStatus.js): same
-- validation gate, temporary closure, special days, weekly hours, all-day, split and overnight ranges, business timezone.
-- A journey test (src/journeys/businessHoursParity.journey.js) runs both on the same cases so they cannot drift.
-- The request's date + start time are read as wall-clock at the business (routing is local: <= 100 miles).

create or replace function public._hours_span_minutes(iv jsonb)
returns int4range language sql immutable as $$
  select case
    when jsonb_typeof(iv) <> 'array' or jsonb_array_length(iv) <> 2 then null
    when public._operating_minutes(iv->>0) is null or public._operating_minutes(iv->>1) is null then null
    when public._operating_minutes(iv->>0) = public._operating_minutes(iv->>1) then null
    else int4range(public._operating_minutes(iv->>0),
                   case when public._operating_minutes(iv->>1) <= public._operating_minutes(iv->>0)
                        then public._operating_minutes(iv->>1) + 1440 else public._operating_minutes(iv->>1) end, '[)')
  end
$$;

-- The day's declared hours: a special day wins over the weekday.
create or replace function public._hours_for_day(h jsonb, d date)
returns jsonb language sql immutable as $$
  select coalesce(
    (select s->'hours' from jsonb_array_elements(case when jsonb_typeof(h->'special') = 'array' then h->'special' else '[]'::jsonb end) s
      where s->>'date' = to_char(d, 'YYYY-MM-DD') limit 1),
    h->'week'->(array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from d)::int + 1])
$$;

-- open | closed | unknown for owner-declared hours at a moment (hoursStatus() in SQL).
create or replace function public._business_hours_status(h jsonb, at_param timestamptz)
returns text language plpgsql stable set search_path to 'public' as $$
declare
  v_local timestamp;
  v_day date;
  v_min int;
  v_today jsonb;
  v_prev jsonb;
  iv jsonb;
  r int4range;
begin
  if h is null or jsonb_typeof(h) <> 'object' or public._operating_hours_problem(h) is not null then return 'unknown'; end if;
  if (h->>'temporarily_closed') = 'true' then return 'closed'; end if;
  begin
    v_local := at_param at time zone (h->>'timezone');
  exception when others then return 'unknown';
  end;
  v_day := v_local::date;
  v_min := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_today := public._hours_for_day(h, v_day);
  if v_today #>> '{}' = 'all_day' then return 'open'; end if;
  if jsonb_typeof(v_today) = 'array' then
    for iv in select * from jsonb_array_elements(v_today) loop
      r := public._hours_span_minutes(iv);
      if r is not null and v_min >= lower(r) and v_min < upper(r) then return 'open'; end if;
    end loop;
  end if;
  v_prev := public._hours_for_day(h, v_day - 1);
  if jsonb_typeof(v_prev) = 'array' then
    for iv in select * from jsonb_array_elements(v_prev) loop
      r := public._hours_span_minutes(iv);
      if r is not null and upper(r) > 1440 and v_min < upper(r) - 1440 then return 'open'; end if;
    end loop;
  end if;
  return 'closed';
end;
$$;

-- True only when the business is KNOWN closed for this request and no live posting of its own covers it.
create or replace function public._business_closed_for_request(partner_id_param uuid, request_id_param uuid)
returns boolean language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_hours jsonb;
  v_date date;
  v_time time;
  v_at timestamptz;
  v_closed boolean := false;
begin
  select date, time_window_start into v_date, v_time from business_requests where id = request_id_param;
  if v_date is null then return false; end if;  -- no requested date: nothing is known, behavior unchanged
  select operating_hours into v_hours from brand_partners where id = partner_id_param;
  if v_hours is null or public._operating_hours_problem(v_hours) is not null then return false; end if;  -- unknown = eligible
  if v_time is not null then
    begin
      v_at := (v_date + v_time) at time zone (v_hours->>'timezone');
    exception when others then return false;
    end;
    v_closed := public._business_hours_status(v_hours, v_at) = 'closed';
  else
    -- a date with no time: only a whole declared-closed day (or a temporary closure) is known
    v_closed := coalesce((v_hours->>'temporarily_closed') = 'true', false)
                or coalesce(public._hours_for_day(v_hours, v_date) #>> '{}' = 'closed', false);
  end if;
  if not coalesce(v_closed, false) then return false; end if;  -- never let an unknown become "closed"
  -- a live availability posting that covers the requested time (or day) establishes availability
  return not exists (
    select 1 from business_availability a
    where a.partner_id = partner_id_param and a.status = 'active' and coalesce(a.remaining_capacity, 1) > 0
      and (a.ends_at is null or a.ends_at > now())
      and case when v_at is not null
               then a.starts_at <= v_at and (a.ends_at is null or v_at < a.ends_at)
               else a.starts_at < ((v_date + 1)::timestamp at time zone (v_hours->>'timezone'))
                    and (a.ends_at is null or a.ends_at > (v_date::timestamp at time zone (v_hours->>'timezone')))
          end);
end;
$$;

revoke all on function public._hours_span_minutes(jsonb) from public, anon, authenticated;
revoke all on function public._hours_for_day(jsonb, date) from public, anon, authenticated;
revoke all on function public._business_hours_status(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public._business_closed_for_request(uuid, uuid) from public, anon, authenticated;

create or replace function public._routing_rules_version(path_param text)
 returns text language sql immutable as $$
  select case path_param
    when 'fanout' then 'fanout.2026-09-27.2'          -- + item 116 step 2: a business known closed at the requested time is not routed
    when 'directed' then 'directed.2026-09-27.1'
    when 'availability' then 'availability.2026-09-27.1'
    when 'package' then 'package.2026-09-27.1'
    when 'policy' then 'policy.2026-09-27.1'
  end
$$;

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
           public._business_closed_for_request(p.id, request_id_param) as closed_then
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
      (r.total_opportunities is not null and r.total_opportunities >= 5) as k_established
    from near e
    left join reputation r on r.partner_id = e.id
    where e.cat_ok and not e.declines and not e.closed_then and e.distance_miles <= radius_miles_param
  ),
  ranked as (
    select s.*, row_number() over (order by
      s.k_deprio asc, s.k_occ desc, s.k_exact desc, s.k_fits desc, s.k_diet desc, s.k_overlap desc, s.k_established desc,
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
          case when k.rn > 10 then 'below_routing_cutoff' end]) x where x is not null),
      'signals', array(select x from unnest(array[
          case when k.k_occ then 'occasion_offered' end,
          case when k.k_exact then 'exact_tag' end,
          case when k.k_fits then 'group_size_fits' end,
          case when k.k_deprio then 'deprioritized_size' end,
          case when k.k_diet then 'dietary_all_declared' end,
          case when k.k_overlap > 0 then 'attribute_match' end,
          case when k.k_established then 'established_record' end]) x where x is not null),
      'sort_key', case when k.id is not null then jsonb_build_object(
          'deprioritized_size', k.k_deprio, 'occasion_offered', k.k_occ, 'exact_tag', k.k_exact, 'group_size_fits', k.k_fits,
          'dietary_all_declared', k.k_diet, 'attribute_overlap', k.k_overlap, 'established_record', k.k_established,
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
$function$
;

-- The two auto-offer matchers that can offer on a business's behalf without a posting (occasion packages, fulfillment-policy
-- auto-accept) apply the same rule, beside _business_declines_request (bodies patched from live, only that line added; the
-- policy path records a closed business under its existing 'hours_mismatch' exclusion reason). The availability matcher is
-- unchanged: a live posting is itself the availability. Directed (one-business) requests are unchanged.

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
    join brand_partners p on p.id = bop.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_closed_for_request(p.id, request_id_param)
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
    join brand_partners p on p.id = bop.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_closed_for_request(p.id, request_id_param)
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
$function$

;

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
    join brand_partners p on p.id = bfp.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param)
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
  join brand_partners p on p.id = bfp.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param)
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
$function$

;

create or replace function public._routing_rules_version(path_param text)
 returns text language sql immutable as $$
  select case path_param
    when 'fanout' then 'fanout.2026-09-27.2'          -- + item 116 step 2: a business known closed at the requested time is not routed
    when 'directed' then 'directed.2026-09-27.1'
    when 'availability' then 'availability.2026-09-27.1'
    when 'package' then 'package.2026-09-27.2'        -- + item 116 step 2
    when 'policy' then 'policy.2026-09-27.2'          -- + item 116 step 2
  end
$$;
