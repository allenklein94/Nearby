-- Extend structured dietary needs (see 20261223) to gathering, match and community requests. One validator
-- (normalize_dietary) shared by the three create functions; same closed vocabulary as the CHECK on business_requests.dietary.
-- Adding a trailing parameter creates a second overload, so each old exact signature is dropped first and grants re-applied.

create or replace function public.normalize_dietary(dietary_param text[])
returns text[]
language plpgsql
immutable
set search_path to 'public'
as $fn$
begin
  if dietary_param is null then return '{}'; end if;
  if cardinality(dietary_param) > 8 or not dietary_param <@ array['vegetarian','vegan','gluten_free','dairy_free','nut_allergy','shellfish_allergy','halal','kosher']::text[] then
    raise exception 'Invalid dietary need';
  end if;
  return coalesce((select array_agg(distinct t order by t) from unnest(dietary_param) t), '{}');
end;
$fn$;
revoke all on function public.normalize_dietary(text[]) from public, anon, authenticated;

drop function if exists public.create_business_request_for_gathering(gathering_id_param uuid, raw_text_param text, category_param text, budget_max_param integer, radius_miles_param double precision, occasion_param text);
CREATE OR REPLACE FUNCTION public.create_business_request_for_gathering(gathering_id_param uuid, raw_text_param text, category_param text DEFAULT NULL::text, budget_max_param integer DEFAULT NULL::integer, radius_miles_param double precision DEFAULT 15, occasion_param text DEFAULT NULL::text, dietary_param text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_policy_new_count integer;
  v_duplicate_id uuid;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  if occasion_param is not null and occasion_param not in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'wedding', 'housewarming',
    'new_job', 'promotion', 'retirement', 'achievement', 'moving',
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'milestone',
    'life_event', 'other'
  ) then
    raise exception 'Invalid occasion';
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
    radius_miles, expires_at, gathering_id, occasion, dietary
  ) values (
    auth.uid(), trim(raw_text_param), category_param, v_party_size,
    v_scheduled_at::date, v_lat, v_lng, coalesce(radius_miles_param, 15),
    v_expires_at, gathering_id_param, occasion_param, public.normalize_dietary(dietary_param)
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), category_param, v_scheduled_at::date, null, null, null, v_party_size) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), v_party_size, null, null) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', v_party_size);
end;
$function$;

revoke all on function public.create_business_request_for_gathering from public, anon;
grant execute on function public.create_business_request_for_gathering to authenticated;

drop function if exists public.create_business_request_for_match(match_id_param uuid, raw_text_param text, latitude_param double precision, longitude_param double precision, category_param text, budget_max_param integer, date_param date, time_window_start_param time without time zone, time_window_end_param time without time zone, radius_miles_param double precision, occasion_param text);
CREATE OR REPLACE FUNCTION public.create_business_request_for_match(match_id_param uuid, raw_text_param text, latitude_param double precision, longitude_param double precision, category_param text DEFAULT NULL::text, budget_max_param integer DEFAULT NULL::integer, date_param date DEFAULT NULL::date, time_window_start_param time without time zone DEFAULT NULL::time without time zone, time_window_end_param time without time zone DEFAULT NULL::time without time zone, radius_miles_param double precision DEFAULT 15, occasion_param text DEFAULT NULL::text, dietary_param text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_match record;
  v_proposal record;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_new_count integer;
  v_policy_new_count integer;
  v_duplicate_id uuid;
  v_category text;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  if occasion_param is not null and occasion_param not in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'wedding', 'housewarming',
    'new_job', 'promotion', 'retirement', 'achievement', 'moving',
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'milestone',
    'life_event', 'other'
  ) then
    raise exception 'Invalid occasion';
  end if;

  select * into v_match from matches where id = match_id_param;
  if v_match is null then
    raise exception 'Match not found.';
  end if;
  if auth.uid() <> v_match.user_a and auth.uid() <> v_match.user_b then
    raise exception 'You are not part of this match.';
  end if;

  select * into v_proposal
  from date_proposals
  where match_id = match_id_param and status = 'accepted'
  order by responded_at desc
  limit 1;

  if v_proposal is null then
    raise exception 'A plan must be proposed and accepted by your match before asking businesses.';
  end if;

  v_category := coalesce(category_param, v_proposal.category);

  select id into v_duplicate_id
  from business_requests
  where match_id = match_id_param and status = 'open'
  order by created_at desc
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true, 'partySize', 2);
  end if;

  v_duplicate_id := public._business_request_spam_guard(auth.uid(), raw_text_param);
  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true, 'partySize', 2);
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
    requester_id, raw_text, category, party_size, budget_max, date,
    time_window_start, time_window_end, latitude, longitude, radius_miles,
    expires_at, match_id, occasion, dietary
  ) values (
    auth.uid(), trim(raw_text_param), v_category, 2, budget_max_param, date_param,
    time_window_start_param, time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at, match_id_param, occasion_param, public.normalize_dietary(dietary_param)
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), v_category, date_param, time_window_start_param, time_window_end_param, v_proposal.availability_id, 2) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), 2, time_window_start_param, time_window_end_param) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', 2);
end;
$function$;

revoke all on function public.create_business_request_for_match from public, anon;
grant execute on function public.create_business_request_for_match to authenticated;

drop function if exists public.create_business_request_for_community(community_id_param uuid, raw_text_param text, category_param text, party_size_param integer, budget_max_param integer, date_param date, radius_miles_param double precision);
CREATE OR REPLACE FUNCTION public.create_business_request_for_community(community_id_param uuid, raw_text_param text, category_param text DEFAULT NULL::text, party_size_param integer DEFAULT NULL::integer, budget_max_param integer DEFAULT NULL::integer, date_param date DEFAULT NULL::date, radius_miles_param double precision DEFAULT 15, dietary_param text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owns_target boolean;
  v_lat double precision;
  v_lng double precision;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_new_count integer;
  v_policy_new_count integer;
  v_duplicate_id uuid;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  select exists(
    select 1 from community_members
    where community_id = community_id_param and user_id = auth.uid() and role in ('creator', 'leader')
  ) into v_owns_target;

  if not v_owns_target then
    raise exception 'Only a community creator or leader can ask businesses on behalf of this community.';
  end if;

  select area_lat, area_lng into v_lat, v_lng from communities where id = community_id_param;

  if v_lat is null or v_lng is null then
    raise exception 'Set a Community Area for this community first, so nearby businesses can be found.';
  end if;

  select id into v_duplicate_id
  from business_requests
  where community_id = community_id_param and status = 'open'
  order by created_at desc
  limit 1;

  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true);
  end if;

  v_duplicate_id := public._business_request_spam_guard(auth.uid(), raw_text_param);
  if v_duplicate_id is not null then
    return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true);
  end if;

  v_expires_at := case
    when date_param is not null then (date_param + time '23:59:59')::timestamptz
    else now() + interval '48 hours'
  end;
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, budget_max, date,
    latitude, longitude, radius_miles, expires_at, community_id, dietary
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param, budget_max_param, date_param,
    v_lat, v_lng, coalesce(radius_miles_param, 15), v_expires_at, community_id_param, public.normalize_dietary(dietary_param)
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), category_param, date_param, null, null, null, party_size_param) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), party_size_param, null, null) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;

revoke all on function public.create_business_request_for_community from public, anon;
grant execute on function public.create_business_request_for_community to authenticated;
