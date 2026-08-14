-- Intent Layer + Business Fulfillment, follow-up hardening pass (see
-- CLAUDE.md's "Intent Layer + Business Fulfillment" plan) -- a spam guard
-- on the two request-creation entry points. Neither create_business_request
-- nor create_business_request_for_gathering had any protection against a
-- caller (accidentally, via a double-tap, or deliberately) submitting the
-- same ask repeatedly -- each call unconditionally inserted a new row and
-- re-ran the fan-out, so a double-tap on "Ask Nearby Businesses" would
-- notify the same nearby businesses twice for the literal same request, and
-- nothing stopped a caller from having an unbounded number of simultaneously
-- open requests outstanding at once.
--
-- Two guards, both enforced server-side (not just a client-side disabled
-- button, matching this schema's own established distrust of the client as
-- the real gate for anything that writes):
--
--   1. Idempotency against a literal duplicate ask: if the caller already
--      has a genuinely open request with the same raw_text (trimmed,
--      case-insensitive), the existing request's id is returned instead of
--      creating a second one -- no new row, no second fan-out, no double
--      notification. Not an error -- a repeat submission of the exact same
--      text is treated as "you already asked this," not "you did something
--      wrong."
--   2. A hard cap (5) on simultaneously open requests per requester, across
--      both the solo and gathering-sourced paths (same requester_id pool,
--      same business_requests table) -- a real, stated limit, not a
--      fabricated metric, matching this schema's existing "don't overwhelm
--      supply" fan-out caps (10 nearest businesses, 5 nearest availability
--      postings). Raises a real error rather than silently rejecting.
--
-- The gathering-sourced path also gets a narrower, more specific duplicate
-- check ahead of the shared text-match guard: re-asking on behalf of the
-- same gathering while an earlier ask for that same gathering is still open
-- is a duplicate regardless of whether the raw_text happens to match
-- word-for-word (a host re-typing the ask slightly differently is still
-- the same underlying duplicate action for that gathering).

-- ---------- FUNCTION: _business_request_spam_guard (new, internal) ----------
-- Returns the id of an existing open duplicate (same requester, same
-- trimmed/lowercased raw_text) if one exists; raises if the requester is
-- already at the open-request cap; otherwise returns null, meaning the
-- caller should proceed with a real insert. Locked down (revoked from
-- public/anon/authenticated) since it takes a raw requester id with no
-- ownership check of its own -- same shape as _business_request_fanout and
-- _match_request_to_availability, only safely callable from within another
-- SECURITY DEFINER function owned by the same role (verified empirically
-- for those two functions earlier in this same build; unchanged here).
create or replace function public._business_request_spam_guard(
  requester_id_param uuid,
  raw_text_param text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing_id uuid;
  v_open_count integer;
  v_cap constant integer := 5;
begin
  select id into v_existing_id
  from business_requests
  where requester_id = requester_id_param
    and status = 'open'
    and lower(trim(raw_text)) = lower(trim(raw_text_param))
  order by created_at desc
  limit 1;

  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select count(*) into v_open_count
  from business_requests
  where requester_id = requester_id_param and status = 'open';

  if v_open_count >= v_cap then
    raise exception 'You already have % open requests out at once. Cancel one before asking for something new.', v_open_count;
  end if;

  return null;
end;
$function$;

revoke all on function public._business_request_spam_guard(uuid, text) from public, anon, authenticated;

-- ---------- FUNCTION: create_business_request (re-pointed to add the spam guard) ----------
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
  v_avail_new_count integer;
  v_duplicate_id uuid;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  v_duplicate_id := public._business_request_spam_guard(auth.uid(), raw_text_param);
  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true);
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
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, date_param, time_window_start_param, time_window_end_param) into v_avail_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;

revoke all on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision) from public, anon;
grant execute on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision) to authenticated;

-- ---------- FUNCTION: create_business_request_for_gathering (re-pointed to add the spam guard) ----------
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
  v_avail_new_count integer;
  v_duplicate_id uuid;
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

  -- Narrower than the shared text-match guard below: re-asking on behalf
  -- of the same gathering while an earlier ask for it is still open is a
  -- duplicate action regardless of whether the wording matches exactly.
  select id into v_duplicate_id
  from business_requests
  where gathering_id = gathering_id_param and status = 'open'
  order by created_at desc
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true, 'partySize', null);
  end if;

  v_duplicate_id := public._business_request_spam_guard(auth.uid(), raw_text_param);
  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true, 'partySize', null);
  end if;

  select count(*) into v_party_size
  from gathering_interest
  where gathering_id = gathering_id_param and status = 'approved';
  v_party_size := coalesce(v_party_size, 0) + 1;

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
  select public._match_request_to_availability(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), category_param, v_scheduled_at::date, null, null) into v_avail_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', v_party_size);
end;
$function$;

revoke all on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision) from public, anon;
grant execute on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision) to authenticated;
