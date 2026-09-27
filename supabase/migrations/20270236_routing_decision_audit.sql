-- Routing decision audit (2026-09-27, owner decision "chosen + excluded"; live-loop milestone). INTERNAL ONLY.
--
-- Answers, per business request: why did it go to these businesses, why was another excluded, how many eligible
-- candidates existed, and why did nobody offer. Written FROM the real decision, never reconstructed later:
--
--   routing_decisions    one row per routing call (path, rules version, request snapshot, counts)
--   routing_candidates   one row per business in that call's candidate set: chosen (rank + signal codes) or excluded
--                        (canonical reason codes, a deterministic primary reason). A decision-time snapshot, never updated.
--   routing_audit_failures  a failed audit write (the request itself is never blocked by one)
--   routing_candidate_outcomes  view linking each candidate to what happened next (offer, response, reservation...)
--
-- Paths:
--   fanout        _business_request_fanout (rewritten here with the SAME selection and ordering): the candidate set is
--                 every active, geolocated business within a consideration radius (2x the request radius, at least
--                 +10 mi, at most 100 mi), so a near miss outside the radius is visible as outside_geo_range. Businesses
--                 farther away, inactive or without coordinates were never considered and are not recorded.
--   directed, availability, package, policy
--                 the existing functions keep their bodies (renamed *_core); a thin wrapper tags the call and a trigger
--                 on business_request_offers records each offer that call created or upgraded, as CHOSEN. These paths
--                 record only what they produced (their own internal filtering is not audited).
--
-- No client can read any of it (no grants); no business-facing payload references it. Safe to rerun.

-- ---------------------------------------------------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------------------------------------------------
create table if not exists public.routing_decisions (
  id bigserial primary key,
  request_id uuid not null references public.business_requests (id) on delete cascade,
  path text not null check (path in ('fanout', 'directed', 'availability', 'package', 'policy')),
  rules_version text not null,
  call_id uuid,
  request_radius_miles numeric,
  consideration_radius_miles numeric,
  request_snapshot jsonb not null default '{}'::jsonb,
  considered_count integer,
  in_range_count integer,
  eligible_count integer,
  chosen_count integer,
  created_at timestamptz not null default now()
);
create unique index if not exists routing_decisions_call_request on public.routing_decisions (call_id, request_id) where call_id is not null;
create index if not exists routing_decisions_request on public.routing_decisions (request_id);

create table if not exists public.routing_candidates (
  decision_id bigint not null references public.routing_decisions (id) on delete cascade,
  partner_id uuid not null references public.brand_partners (id) on delete cascade,
  outcome text not null check (outcome in ('chosen', 'excluded')),
  rank integer,
  primary_reason text,
  reason_codes text[] not null default '{}',
  signals text[] not null default '{}',
  sort_key jsonb,
  distance_miles numeric(7, 2),
  created_at timestamptz not null default now(),
  primary key (decision_id, partner_id),
  constraint routing_candidates_reason_vocab check (reason_codes <@ array['outside_geo_range', 'wrong_category',
    'wrong_cuisine', 'restriction_conflict', 'capacity_too_small', 'unavailable', 'below_routing_cutoff']::text[]),
  constraint routing_candidates_signal_vocab check (signals <@ array['occasion_offered', 'exact_tag', 'group_size_fits',
    'deprioritized_size', 'dietary_all_declared', 'attribute_match', 'established_record', 'directed_by_customer',
    'availability_posting', 'occasion_package', 'standing_policy', 'upgraded_routed_opportunity']::text[]),
  constraint routing_candidates_shape check (
    (outcome = 'chosen' and primary_reason is null and reason_codes = '{}')
    or (outcome = 'excluded' and cardinality(reason_codes) > 0 and primary_reason = reason_codes[1]))
);
create index if not exists routing_candidates_partner on public.routing_candidates (partner_id);

create table if not exists public.routing_audit_failures (
  id bigserial primary key,
  request_id uuid,
  path text,
  error text,
  created_at timestamptz not null default now()
);

alter table public.routing_decisions enable row level security;
alter table public.routing_candidates enable row level security;
alter table public.routing_audit_failures enable row level security;
revoke all on public.routing_decisions, public.routing_candidates, public.routing_audit_failures from public, anon, authenticated;
revoke all on sequence public.routing_decisions_id_seq, public.routing_audit_failures_id_seq from public, anon, authenticated;

-- A candidate row is a decision-time snapshot: never edited (a cascade from a deleted request/business may remove it).
create or replace function public._routing_candidate_frozen()
returns trigger language plpgsql as $$
begin
  raise exception 'A routing candidate is a decision-time snapshot and never changes.';
end $$;
drop trigger if exists routing_candidate_frozen on public.routing_candidates;
create trigger routing_candidate_frozen before update on public.routing_candidates
  for each row execute function public._routing_candidate_frozen();
drop trigger if exists routing_decision_frozen on public.routing_decisions;

-- The rules version per path. Bump the path's value whenever its selection or ordering changes, so outcomes can be
-- compared across versions.
create or replace function public._routing_rules_version(path_param text)
returns text language sql immutable as $$
  select case path_param
    when 'fanout' then 'fanout.2026-09-27.1'          -- category group, restrictions (item 86), 10 cap, ordering items 80/81/88
    when 'directed' then 'directed.2026-09-27.1'
    when 'availability' then 'availability.2026-09-27.1'
    when 'package' then 'package.2026-09-27.1'
    when 'policy' then 'policy.2026-09-27.1'
  end
$$;

-- Canonical order of exclusion reasons; the first applicable one is the primary reason.
create or replace function public._routing_reason_order()
returns text[] language sql immutable as $$
  select array['outside_geo_range', 'wrong_category', 'wrong_cuisine', 'restriction_conflict', 'capacity_too_small',
               'unavailable', 'below_routing_cutoff']::text[]
$$;

-- Only structural request facts: never the requester, their words, a note, a gathering/match, interests, attributes
-- or dietary needs (accessibility and dietary needs stay out of every log).
create or replace function public._routing_request_snapshot(request_id_param uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('category', r.category, 'category_group', public.request_category_group(r.category),
                            'party_size', r.party_size, 'occasion', r.occasion, 'cuisine', r.cuisine,
                            'has_date', r.date is not null, 'has_time', r.time_window_start is not null,
                            'targeted', r.target_partner_id is not null)
  from business_requests r where r.id = request_id_param
$$;

create or replace function public._routing_record_failure(request_id_param uuid, path_param text, error_param text)
returns void language plpgsql security definer set search_path = public as $$
begin
  raise warning 'routing audit write failed (% / %): %', path_param, request_id_param, error_param;
  begin
    insert into routing_audit_failures (request_id, path, error) values (request_id_param, path_param, left(error_param, 500));
  exception when others then
    raise warning 'routing audit failure could not be recorded: %', sqlerrm;
  end;
end $$;

revoke all on function public._routing_candidate_frozen(), public._routing_rules_version(text), public._routing_reason_order(),
  public._routing_request_snapshot(uuid), public._routing_record_failure(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Fan-out: same filters, same ordering, same cap and pushes as before; the ranked list is computed ONCE and both the
-- offers and the audit come from it. Only change to routing: a final tie-break on the business id, so equal candidates
-- are ordered deterministically (they were in arbitrary order before).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function public._business_request_fanout(request_id_param uuid, latitude_param double precision,
  longitude_param double precision, radius_miles_param double precision, category_filter_param text[] default null::text[],
  business_major_filter_param text default null::text)
returns integer language plpgsql security definer set search_path = public as $function$
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
           (public._business_declines(p.id, null, v_children, v_pets, v_outdoor, false, false) is not null) as other_conflict
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
    where e.cat_ok and not e.declines and e.distance_miles <= radius_miles_param
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
$function$;
revoke all on function public._business_request_fanout(uuid, double precision, double precision, double precision, text[], text)
  from public, anon, authenticated;
grant execute on function public._business_request_fanout(uuid, double precision, double precision, double precision, text[], text)
  to service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- The other paths: bodies unchanged (renamed *_core); a wrapper tags the call; a trigger records what it produced.
-- ---------------------------------------------------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_proc where proname = '_match_request_to_availability_core' and pronamespace = 'public'::regnamespace) then
    alter function public._match_request_to_availability(uuid, double precision, double precision, double precision, text, date,
      time without time zone, time without time zone, uuid, integer) rename to _match_request_to_availability_core;
  end if;
  if not exists (select 1 from pg_proc where proname = '_match_request_to_package_core' and pronamespace = 'public'::regnamespace) then
    alter function public._match_request_to_package(uuid, double precision, double precision, double precision, text, integer,
      date, uuid) rename to _match_request_to_package_core;
  end if;
  if not exists (select 1 from pg_proc where proname = '_match_request_to_policy_core' and pronamespace = 'public'::regnamespace) then
    alter function public._match_request_to_policy(uuid, double precision, double precision, double precision, integer,
      time without time zone, time without time zone) rename to _match_request_to_policy_core;
  end if;
  if not exists (select 1 from pg_proc where proname = '_route_request_to_partner_core' and pronamespace = 'public'::regnamespace) then
    alter function public._route_request_to_partner(uuid, uuid) rename to _route_request_to_partner_core;
  end if;
  if not exists (select 1 from pg_proc where proname = '_route_gathering_to_partner_core' and pronamespace = 'public'::regnamespace) then
    alter function public._route_gathering_to_partner(uuid, uuid, boolean) rename to _route_gathering_to_partner_core;
  end if;
end $$;

create or replace function public._routing_begin(path_param text)
returns void language sql as $$
  select set_config('app.routing_path', path_param, true), set_config('app.routing_call', gen_random_uuid()::text, true);
$$;
create or replace function public._routing_end()
returns void language sql as $$
  select set_config('app.routing_path', '', true), set_config('app.routing_call', '', true);
$$;
revoke all on function public._routing_begin(text), public._routing_end() from public, anon, authenticated;

create or replace function public._match_request_to_availability(request_id_param uuid, latitude_param double precision,
  longitude_param double precision, radius_miles_param double precision, category_param text, date_param date,
  time_window_start_param time without time zone, time_window_end_param time without time zone,
  preferred_availability_id_param uuid default null::uuid, party_size_param integer default null::integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  perform _routing_begin('availability');
  v := _match_request_to_availability_core(request_id_param, latitude_param, longitude_param, radius_miles_param, category_param,
         date_param, time_window_start_param, time_window_end_param, preferred_availability_id_param, party_size_param);
  perform _routing_end();
  return v;
end $$;

create or replace function public._match_request_to_package(request_id_param uuid, latitude_param double precision,
  longitude_param double precision, radius_miles_param double precision, occasion_param text, party_size_param integer,
  date_param date, preferred_package_id_param uuid default null::uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  perform _routing_begin('package');
  v := _match_request_to_package_core(request_id_param, latitude_param, longitude_param, radius_miles_param, occasion_param,
         party_size_param, date_param, preferred_package_id_param);
  perform _routing_end();
  return v;
end $$;

create or replace function public._match_request_to_policy(request_id_param uuid, latitude_param double precision,
  longitude_param double precision, radius_miles_param double precision, party_size_param integer,
  time_window_start_param time without time zone, time_window_end_param time without time zone)
returns integer language plpgsql security definer set search_path = public as $$
declare v integer;
begin
  perform _routing_begin('policy');
  v := _match_request_to_policy_core(request_id_param, latitude_param, longitude_param, radius_miles_param, party_size_param,
         time_window_start_param, time_window_end_param);
  perform _routing_end();
  return v;
end $$;

create or replace function public._route_request_to_partner(request_id_param uuid, partner_id_param uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform _routing_begin('directed');
  v := _route_request_to_partner_core(request_id_param, partner_id_param);
  perform _routing_end();
  return v;
end $$;

create or replace function public._route_gathering_to_partner(gathering_id_param uuid, partner_id_param uuid,
  notify_param boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform _routing_begin('directed');
  v := _route_gathering_to_partner_core(gathering_id_param, partner_id_param, notify_param);
  perform _routing_end();
  return v;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    '_match_request_to_availability(uuid, double precision, double precision, double precision, text, date, time without time zone, time without time zone, uuid, integer)',
    '_match_request_to_availability_core(uuid, double precision, double precision, double precision, text, date, time without time zone, time without time zone, uuid, integer)',
    '_match_request_to_package(uuid, double precision, double precision, double precision, text, integer, date, uuid)',
    '_match_request_to_package_core(uuid, double precision, double precision, double precision, text, integer, date, uuid)',
    '_match_request_to_policy(uuid, double precision, double precision, double precision, integer, time without time zone, time without time zone)',
    '_match_request_to_policy_core(uuid, double precision, double precision, double precision, integer, time without time zone, time without time zone)',
    '_route_request_to_partner(uuid, uuid)', '_route_request_to_partner_core(uuid, uuid)',
    '_route_gathering_to_partner(uuid, uuid, boolean)', '_route_gathering_to_partner_core(uuid, uuid, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Records an offer created (or a routed pending opportunity upgraded) by a tagged call, as CHOSEN.
create or replace function public._routing_record_offer()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_path text := coalesce(current_setting('app.routing_path', true), '');
  v_call uuid := nullif(current_setting('app.routing_call', true), '')::uuid;
  v_decision bigint;
  v_upgrade boolean := TG_OP = 'UPDATE';
begin
  if v_path not in ('directed', 'availability', 'package', 'policy') or v_call is null then return null; end if;
  if TG_OP = 'UPDATE' and not (OLD.status = 'pending' and NEW.status = 'offered') then return null; end if;
  if v_path = 'directed' and TG_OP <> 'INSERT' then return null; end if;
  begin
    insert into routing_decisions (request_id, path, rules_version, call_id, request_snapshot, chosen_count)
    values (NEW.request_id, v_path, _routing_rules_version(v_path), v_call, _routing_request_snapshot(NEW.request_id), 0)
    on conflict (call_id, request_id) where call_id is not null do update set chosen_count = routing_decisions.chosen_count
    returning id into v_decision;
    update routing_decisions set chosen_count = chosen_count + 1 where id = v_decision;
    insert into routing_candidates (decision_id, partner_id, outcome, rank, signals)
    values (v_decision, NEW.partner_id, 'chosen', (select chosen_count from routing_decisions where id = v_decision),
            array_remove(array[
              case v_path when 'directed' then 'directed_by_customer' when 'availability' then 'availability_posting'
                          when 'package' then 'occasion_package' when 'policy' then 'standing_policy' end,
              case when v_upgrade then 'upgraded_routed_opportunity' end], null))
    on conflict (decision_id, partner_id) do nothing;
  exception when others then
    perform _routing_record_failure(NEW.request_id, v_path, sqlerrm);
  end;
  return null;
end $$;
revoke all on function public._routing_record_offer() from public, anon, authenticated;
drop trigger if exists routing_record_offer on public.business_request_offers;
create trigger routing_record_offer after insert or update of status on public.business_request_offers
  for each row execute function public._routing_record_offer();

-- ---------------------------------------------------------------------------------------------------------------------
-- What happened next, per candidate (internal analysis; no grants)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace view public.routing_candidate_outcomes as
select d.id as decision_id, d.request_id, d.path, d.rules_version, d.created_at as decided_at,
       c.partner_id, c.outcome as routing_outcome, c.rank, c.primary_reason, c.reason_codes, c.signals,
       o.id as offer_id, o.status as offer_status, o.created_at as offer_created_at, o.responded_at, o.accepted_at,
       o.completed_at, o.cancelled_at, o.decline_reason,
       r.status as request_status,
       res.status as reservation_status,
       (select ce.reason_code from cancellation_events ce
         where (ce.entity_type, ce.entity_id) in (('business_reservation', res.id), ('business_request', d.request_id))
         order by ce.created_at desc limit 1) as cancellation_reason,
       (select oo.match_fit from business_offer_outcomes oo where oo.offer_id = o.id order by oo.created_at desc limit 1) as match_fit,
       case
         when c.outcome = 'excluded' then 'not_routed'
         when o.id is null then 'no_offer_row'
         when o.status = 'completed' then 'completed'
         when o.status = 'accepted' then 'accepted'
         when o.status = 'offered' then 'offer_sent'
         when o.status = 'pending' and r.status = 'open' then 'awaiting_business'
         when o.status = 'pending' then 'no_response'
         else o.status
       end as chain_outcome
from routing_decisions d
join routing_candidates c on c.decision_id = d.id
join business_requests r on r.id = d.request_id
left join business_request_offers o on o.request_id = d.request_id and o.partner_id = c.partner_id
left join business_reservations res on res.offer_id = o.id;
revoke all on public.routing_candidate_outcomes from public, anon, authenticated;
