-- Intent Layer + Business Fulfillment, Phase 3 (see CLAUDE.md's "Intent
-- Layer + Business Fulfillment" plan, phase 3: "Gathering/community ->
-- business demand"). A gathering becomes a demand generator for Business
-- Fulfillment, not just a receiver of sponsorship
-- (business_partnership_requests' existing single-target shape) -- "8 of
-- us are going out Saturday, find us somewhere to eat" is a materially
-- stronger ask than a solo one: real party size (the gathering's actual
-- approved-attendee count, never user-typed), real date (the gathering's
-- own scheduled_at), real location (the gathering's own precise
-- coordinates, never re-asked of the device). Reuses Phase 2's
-- broadcast-with-competing-offers shape completely unchanged -- same
-- business_requests/business_request_offers tables, same offer/accept/
-- complete RPCs -- this migration only adds a second way to *create* a
-- request, not a second lifecycle.
--
-- Community demand generation ("find us somewhere for the club to meet")
-- is deliberately NOT built in this pass -- communities have no scheduled
-- date/precise location the way a gathering does (confirmed in this
-- schema's own Unified Map section: communities are topic-based, not
-- place/time-based), so there's no real signal to source party
-- size/date/location from the way there is for a gathering. Flagged as a
-- real, deliberately deferred gap, not an oversight -- the plan's own
-- phase 3 text names gatherings explicitly and communities only in the
-- section header's shorthand.

alter table public.business_requests
  add column if not exists gathering_id uuid references public.gatherings(id) on delete set null;

create index if not exists business_requests_gathering_id_idx on public.business_requests(gathering_id);

-- ---------- FUNCTION: _business_request_fanout (internal helper) ----------
-- Factored out of create_business_request's own fan-out block, verbatim,
-- so create_business_request_for_gathering below doesn't duplicate the
-- haversine/eligibility logic. Locked down to nobody (not even
-- authenticated) -- a nested call from within another SECURITY DEFINER
-- function owned by the same role bypasses this at execution time (the
-- definer's own implicit right to call its own functions), same
-- lockdown-but-internally-callable shape already established by
-- expire_stale_business_requests(); verified live before relying on it.
-- Direct client access is deliberately blocked because this takes a raw
-- request_id/lat/lng/radius with no ownership check of its own -- a
-- caller who could invoke it directly for someone else's request could
-- spam unrelated businesses with extra fake opportunities past the real
-- cap.
create or replace function public._business_request_fanout(
  request_id_param uuid,
  latitude_param double precision,
  longitude_param double precision,
  radius_miles_param double precision
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_notified_count integer;
begin
  with eligible as (
    select p.id, (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) as distance_miles
    from brand_partners p
    where p.active = true
    and p.latitude is not null
    and p.longitude is not null
  )
  insert into business_request_offers (request_id, partner_id)
  select request_id_param, id
  from eligible
  where distance_miles <= radius_miles_param
  order by distance_miles asc
  limit 10;

  get diagnostics v_notified_count = row_count;
  return v_notified_count;
end;
$function$;

revoke all on function public._business_request_fanout(uuid, double precision, double precision, double precision) from public, anon, authenticated;

-- ---------- FUNCTION: create_business_request (re-pointed at the shared helper) ----------
-- Pure internal refactor -- same signature, same validation, same
-- behavior as the Phase 2 original; only the fan-out block itself moved
-- into the shared helper above so create_business_request_for_gathering
-- doesn't duplicate it.
create or replace function public.create_business_request(
  raw_text_param text,
  latitude_param double precision,
  longitude_param double precision,
  category_param text default null,
  party_size_param integer default null,
  budget_min_param integer default null,
  budget_max_param integer default null,
  date_param date default null,
  time_window_start_param time default null,
  time_window_end_param time default null,
  radius_miles_param double precision default 15
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  v_expires_at := case
    when date_param is not null and time_window_end_param is not null
      then (date_param + time_window_end_param)::timestamptz
    when date_param is not null
      then (date_param + time '23:59:59')::timestamptz
    else now() + interval '48 hours'
  end;

  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, budget_min, budget_max,
    date, time_window_start, time_window_end, latitude, longitude,
    radius_miles, expires_at
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param,
    budget_min_param, budget_max_param, date_param, time_window_start_param,
    time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;

revoke all on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision) from public, anon;
grant execute on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision) to authenticated;

-- ---------- FUNCTION: create_business_request_for_gathering ----------
-- Host-only (matches business_partnership_requests' existing host/creator/
-- leader-only precedent for "ask a business on behalf of the group,"
-- rather than letting any attendee commit the group to a venue decision).
-- Every field that CAN be sourced from real data IS -- party_size is the
-- real approved-attendee count (+1 for the host), date is the gathering's
-- own scheduled_at, latitude/longitude are the gathering's own precise
-- coordinates (read server-side, never re-collected from the device or
-- exposed to the client -- same narrow-need exception to the fuzzing rule
-- get_gathering_meetup_point() already established). raw_text/category/
-- budget_max are the one genuinely subjective part -- what the host is
-- actually asking for -- and stay caller-supplied, same as the solo path.
create or replace function public.create_business_request_for_gathering(
  gathering_id_param uuid,
  raw_text_param text,
  category_param text default null,
  budget_max_param integer default null,
  radius_miles_param double precision default 15
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_host_id uuid;
  v_scheduled_at timestamptz;
  v_lat double precision;
  v_lng double precision;
  v_party_size integer;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  select host_id, scheduled_at, precise_lat, precise_lng
  into v_host_id, v_scheduled_at, v_lat, v_lng
  from gatherings where id = gathering_id_param;

  if v_host_id is null then
    raise exception 'Gathering not found.';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can ask businesses on behalf of this gathering.';
  end if;
  if v_lat is null or v_lng is null then
    raise exception 'This gathering has no location set.';
  end if;

  select count(*) into v_party_size
  from gathering_interest
  where gathering_id = gathering_id_param and status = 'approved';
  v_party_size := coalesce(v_party_size, 0) + 1;

  -- A request tied to a specific gathering stops being useful once that
  -- gathering has already happened -- expire at the gathering's own
  -- start time (capped at 30 days out either way, matching the solo
  -- path's own sanity bound), never the generic 48h default.
  v_expires_at := least(v_scheduled_at, now() + interval '30 days');
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, date, latitude, longitude,
    radius_miles, expires_at, gathering_id
  ) values (
    auth.uid(), trim(raw_text_param), category_param, v_party_size,
    v_scheduled_at::date, v_lat, v_lng, coalesce(radius_miles_param, 15),
    v_expires_at, gathering_id_param
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15)) into v_notified_count;

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', v_party_size);
end;
$function$;

revoke all on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision) from public, anon;
grant execute on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision) to authenticated;
