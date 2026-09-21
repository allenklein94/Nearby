-- Gathering -> business request carries the gathering's DECLARED attributes (owner decision, 2026-09-21, step 1 only).
-- A gathering declares structured facts itself (gatherings.features: quiet, kid_friendly, stroller_friendly, family_seating and the
-- accessibility keys; default empty, CHECKed to keys of the ONE business attribute vocabulary), so the request's
-- existing `attributes` column (already read by fan-out ranking, the opportunity scorer and the "Customer is looking for" line)
-- receives them: no second attribute system. gatherings.beginner_friendly is deliberately NOT copied: it is NOT NULL DEFAULT true
-- (every gathering has it, 25 of 25 in prod), so it is a default, not a declaration, and copying it would invent a claim. SNAPSHOT: copied once when the request row is created; later edits to the gathering
-- never touch an existing request. Deliberately NOT carried: plan kind (friends/date), who is going, attendee identities, any
-- social context (minimum-payload rule). Existing non-gathering requests are untouched. Signatures unchanged (no new overload).
create or replace function public._gathering_request_attributes(gathering_id_param uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select array_agg(distinct x order by x)
       from gatherings g,
            unnest(coalesce(g.features, '{}'::text[])) x
      where g.id = gathering_id_param),
    '{}'::text[]);
$fn$;
revoke all on function public._gathering_request_attributes(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_business_request_for_gathering(gathering_id_param uuid, raw_text_param text, category_param text DEFAULT NULL::text, budget_max_param integer DEFAULT NULL::integer, radius_miles_param double precision DEFAULT 15, occasion_param text DEFAULT NULL::text, dietary_param text[] DEFAULT NULL::text[], target_partner_id_param uuid DEFAULT NULL::uuid, note_param text DEFAULT NULL::text, date_param date DEFAULT NULL::date, time_start_param time without time zone DEFAULT NULL::time without time zone)
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
  v_note text;
  v_local_date date;
  v_local_time time;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  if occasion_param is not null and occasion_param not in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'wedding', 'housewarming',
    'new_job', 'promotion', 'retirement', 'achievement', 'moving',
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'bachelor_bachelorette', 'fundraiser', 'first_date', 'self_care', 'networking', 'vacation', 'milestone',
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

  if target_partner_id_param is not null then
    if not exists (select 1 from brand_partners where id = target_partner_id_param and active = true) then
      raise exception 'That business could not be found';
    end if;
    v_note := public._clean_note_for_business(note_param);
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

  v_party_size := public._gathering_party_size(gathering_id_param);
  select local_date, local_time into v_local_date, v_local_time from public._gathering_local_when(v_scheduled_at, v_host_id, date_param, time_start_param);

  v_expires_at := least(v_scheduled_at, now() + interval '30 days');
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, date, time_window_start, latitude, longitude,
    radius_miles, expires_at, gathering_id, occasion, dietary, target_partner_id, note_for_business, attributes
  ) values (
    auth.uid(), trim(raw_text_param), category_param, v_party_size,
    v_local_date, v_local_time, v_lat, v_lng, coalesce(radius_miles_param, 15),
    v_expires_at, gathering_id_param, occasion_param, public.normalize_dietary(dietary_param), target_partner_id_param, v_note,
    public._gathering_request_attributes(gathering_id_param)
  ) returning id into v_request_id;

  if target_partner_id_param is not null then
    perform public._route_request_to_partner(v_request_id, target_partner_id_param);
    return jsonb_build_object('requestId', v_request_id, 'notifiedCount', 1, 'partySize', v_party_size, 'targeted', true);
  end if;

  select public._business_request_fanout(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), category_param, v_scheduled_at::date, null, null, null, v_party_size) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), v_party_size, null, null) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', v_party_size);
end;
$function$

;

CREATE OR REPLACE FUNCTION public._route_gathering_to_partner(gathering_id_param uuid, partner_id_param uuid, notify_param boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_g record;
  v_request_id uuid;
  v_party integer;
  v_expires timestamptz;
  v_offer_id uuid;
  v_profile uuid;
  service_key text;
  v_local_date date;
  v_local_time time;
begin
  select id, host_id, scheduled_at, precise_lat, precise_lng, interest_tag into v_g
  from gatherings where id = gathering_id_param;
  if v_g.id is null or v_g.precise_lat is null or v_g.precise_lng is null or v_g.scheduled_at < now() then
    return null;
  end if;
  if not exists (select 1 from brand_partners where id = partner_id_param and active = true) then
    return null;
  end if;

  select id into v_request_id from business_requests
  where gathering_id = gathering_id_param and status = 'open'
  order by created_at desc limit 1;

  if v_request_id is null then
    v_party := public._gathering_party_size(gathering_id_param);
    select local_date, local_time into v_local_date, v_local_time from public._gathering_local_when(v_g.scheduled_at, v_g.host_id);
    v_expires := least(v_g.scheduled_at, now() + interval '30 days');
    if v_expires < now() + interval '1 hour' then v_expires := now() + interval '1 hour'; end if;
    insert into business_requests (
      requester_id, raw_text, category, party_size, date, time_window_start, latitude, longitude,
      radius_miles, expires_at, gathering_id, attributes
    ) values (
      v_g.host_id,
      case when v_g.interest_tag is not null then 'A ' || v_g.interest_tag || ' gathering looking for a place to go'
           else 'A gathering looking for a place to go' end,
      v_g.interest_tag, v_party, v_local_date, v_local_time, v_g.precise_lat, v_g.precise_lng,
      15, v_expires, gathering_id_param, public._gathering_request_attributes(gathering_id_param)
    ) returning id into v_request_id;
  end if;

  insert into business_request_offers (request_id, partner_id, is_directed)
  values (v_request_id, partner_id_param, true)
  on conflict (request_id, partner_id) do update
    set is_directed = true
    where business_request_offers.is_directed = false and business_request_offers.status = 'pending'
  returning id into v_offer_id;

  if v_offer_id is not null and notify_param then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    for v_profile in select id from profiles where managed_partner_id = partner_id_param loop
      continue when not coalesce((select notify_business from profiles where id = v_profile), true);
      continue when service_key is null;
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_profile,
          'title', 'A customer asked for your business',
          'body', 'New request: ' || public.business_safe_request_summary(v_request_id),
          'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', v_request_id)
        )
      );
    end loop;
  end if;

  return v_request_id;
end;
$function$

;
