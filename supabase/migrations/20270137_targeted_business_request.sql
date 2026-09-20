-- "Ask a specific business" uses the SAME request model as "Ask nearby businesses" (owner rule, item 29).
--
-- One business_requests table, one set of validators, one creator per source. The only difference is the recipient set:
-- broadcast = the ranked eligible businesses (fan-out + matchers); targeted = exactly ONE chosen business (a pending, directed
-- offer row, immediate push), no fan-out and no other business is told. New optional columns:
--   target_partner_id  which business a targeted request was addressed to (null for broadcasts)
--   note_for_business  the requester's optional note. It is free text, so it exists ONLY on a targeted request, is shown only to
--                      that one business (get_business_opportunities, when is_directed), must pass the same rule-based safety
--                      filter as a gathering title (_title_safe_for_business), and is never part of the request summary or any
--                      push body. Broadcast requests keep the minimum-payload rule: no consumer free text reaches a business.
alter table public.business_requests add column if not exists target_partner_id uuid references public.brand_partners(id) on delete set null;
alter table public.business_requests add column if not exists note_for_business text;
alter table public.business_requests drop constraint if exists business_requests_note_len;
alter table public.business_requests add constraint business_requests_note_len check (note_for_business is null or length(note_for_business) <= 300);

-- Shared: address one request to exactly one business (pending directed offer + immediate owner push, as the gathering path does).
create or replace function public._route_request_to_partner(request_id_param uuid, partner_id_param uuid)
returns uuid
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_offer_id uuid;
  v_profile uuid;
  service_key text;
begin
  if not exists (select 1 from brand_partners where id = partner_id_param and active = true) then
    raise exception 'That business could not be found';
  end if;
  insert into business_request_offers (request_id, partner_id, is_directed)
  values (request_id_param, partner_id_param, true)
  on conflict (request_id, partner_id) do nothing
  returning id into v_offer_id;
  if v_offer_id is not null then
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
          'body', 'New request: ' || public.business_safe_request_summary(request_id_param),
          'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
        )
      );
    end loop;
  end if;
  return v_offer_id;
end;
$function$;
revoke all on function public._route_request_to_partner(uuid, uuid) from public, anon, authenticated;

-- A targeted request's optional note: same rule-based filter as a gathering title; a failing note is refused (the person can fix it).
create or replace function public._clean_note_for_business(note_param text)
returns text
language plpgsql immutable set search_path to 'public'
as $function$
declare v text := nullif(btrim(coalesce(note_param, '')), '');
begin
  if v is null then return null; end if;
  -- Same rule set as _title_safe_for_business (no link / email / phone-like digits / profanity list), with the note's own 300 cap.
  if length(v) > 300
     or v ~* '(https?://|www\.|[a-z0-9-]+\.(com|net|org|io|co|me|app|link|ly|xyz)\y)'
     or v ~ '@'
     or regexp_replace(v, '[^0-9]', '', 'g') ~ '[0-9]{7,}'
     or v ~* '\m(fuck|fucking|shit|bitch|cunt|nigger|nigga|faggot|retard|whore|slut|dick|cock|pussy|porn|nude|nudes|sex|escort)\M' then
    raise exception 'Please keep the note short and remove links, emails or phone numbers.';
  end if;
  return v;
end;
$function$;
revoke all on function public._clean_note_for_business(text) from public, anon;

drop function if exists public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision, uuid, uuid, text[], text, text, uuid, text, boolean, text[], text[]);
drop function if exists public.create_business_request_for_gathering(uuid, text, text, integer, double precision, text, text[]);

CREATE OR REPLACE FUNCTION public.create_business_request(raw_text_param text, latitude_param double precision, longitude_param double precision, category_param text DEFAULT NULL::text, party_size_param integer DEFAULT NULL::integer, budget_min_param integer DEFAULT NULL::integer, budget_max_param integer DEFAULT NULL::integer, date_param date DEFAULT NULL::date, time_window_start_param time without time zone DEFAULT NULL::time without time zone, time_window_end_param time without time zone DEFAULT NULL::time without time zone, radius_miles_param double precision DEFAULT 15, submission_id_param uuid DEFAULT NULL::uuid, preferred_availability_id_param uuid DEFAULT NULL::uuid, attributes_param text[] DEFAULT NULL::text[], cuisine_param text DEFAULT NULL::text, occasion_param text DEFAULT NULL::text, preferred_package_id_param uuid DEFAULT NULL::uuid, experience_level_param text DEFAULT NULL::text, surprise_mode_param boolean DEFAULT false, shared_interests_param text[] DEFAULT NULL::text[], dietary_param text[] DEFAULT NULL::text[], target_partner_id_param uuid DEFAULT NULL::uuid, note_param text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_request_id uuid;
  v_expires_at timestamptz;
  v_notified_count integer;
  v_avail_new_count integer;
  v_policy_new_count integer;
  v_ai_new_count integer;
  v_package_new_count integer;
  v_duplicate_id uuid;
  v_shared_interests text[];
  v_note text;
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  if attributes_param is not null and not (attributes_param <@ array[
    'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music',
    'kid_friendly', 'quiet', 'casual', 'upscale',
    'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront',
    'late_night', 'board_game_friendly', 'photography_friendly',
    'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events'
  ]::text[]) then
    raise exception 'Invalid attribute';
  end if;

  if dietary_param is not null and (cardinality(dietary_param) > 8 or not dietary_param <@ array['vegetarian','vegan','gluten_free','dairy_free','nut_allergy','shellfish_allergy','halal','kosher']::text[]) then
    raise exception 'Invalid dietary need';
  end if;

  if cuisine_param is not null and cuisine_param not in ('italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'other') then
    raise exception 'Invalid cuisine';
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

  if experience_level_param is not null and experience_level_param not in ('simple', 'special', 'go_all_out') then
    raise exception 'Invalid experience level';
  end if;

  -- Opt-in interest sharing (2026-09-18 design): a snapshot of tags the CALLER already declared on their
  -- own profile, minus sensitive tags, capped at 8, and never attached to a surprise-mode request.
  -- Anything else the client sends is silently dropped -- a client can never share what it didn't declare.
  if shared_interests_param is not null and not coalesce(surprise_mode_param, false) then
    select coalesce(array_agg(t order by t), '{}') into v_shared_interests
    from (
      select distinct t from unnest(shared_interests_param) as t
      where t in (select unnest(interests) from public.profiles where id = auth.uid())
        and t <> all (array['Faith & Spirituality', 'Dating', 'Speed Dating', 'Singles Events', 'Group Hangouts'])
      limit 8
    ) s;
    if cardinality(v_shared_interests) = 0 then v_shared_interests := null; end if;
  end if;

  if target_partner_id_param is not null then
    -- Targeted: one chosen business. The same ask sent to two DIFFERENT businesses is legitimate, so the duplicate check is per target.
    if not exists (select 1 from brand_partners where id = target_partner_id_param and active = true) then
      raise exception 'That business could not be found';
    end if;
    v_note := public._clean_note_for_business(note_param);
    select id into v_duplicate_id from business_requests
     where requester_id = auth.uid() and target_partner_id = target_partner_id_param and status = 'open'
       and raw_text = trim(raw_text_param) and created_at > now() - interval '10 minutes'
     order by created_at desc limit 1;
    if v_duplicate_id is not null then
      return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true);
    end if;
  else
    v_duplicate_id := public._business_request_spam_guard(auth.uid(), raw_text_param);
    if v_duplicate_id is not null then
      return jsonb_build_object('requestId', v_duplicate_id, 'notifiedCount', 0, 'duplicate', true);
    end if;
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
    radius_miles, expires_at, submission_id, attributes, cuisine, occasion,
    experience_level, surprise_mode, shared_interests, dietary, target_partner_id, note_for_business
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param,
    budget_min_param, budget_max_param, date_param, time_window_start_param,
    time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at,
    (select id from intent_submissions where id = submission_id_param and user_id = auth.uid()),
    coalesce(attributes_param, '{}'), cuisine_param, occasion_param,
    experience_level_param, coalesce(surprise_mode_param, false), v_shared_interests,
    coalesce((select array_agg(distinct t order by t) from unnest(dietary_param) t), '{}'),
    target_partner_id_param, v_note
  ) returning id into v_request_id;

  if target_partner_id_param is not null then
    perform public._route_request_to_partner(v_request_id, target_partner_id_param);
    return jsonb_build_object('requestId', v_request_id, 'notifiedCount', 1, 'targeted', true);
  end if;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, date_param, time_window_start_param, time_window_end_param, preferred_availability_id_param, party_size_param) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), party_size_param, time_window_start_param, time_window_end_param) into v_policy_new_count;
  select public._match_request_to_package(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), occasion_param, party_size_param, date_param, preferred_package_id_param) into v_package_new_count;
  select public._ai_auto_respond_to_business_requests(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, party_size_param, time_window_start_param, time_window_end_param) into v_ai_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0) + coalesce(v_package_new_count, 0) + coalesce(v_ai_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$
;

revoke all on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision, uuid, uuid, text[], text, text, uuid, text, boolean, text[], text[], uuid, text) from public, anon;
grant execute on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision, uuid, uuid, text[], text, text, uuid, text, boolean, text[], text[], uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.create_business_request_for_gathering(gathering_id_param uuid, raw_text_param text, category_param text DEFAULT NULL::text, budget_max_param integer DEFAULT NULL::integer, radius_miles_param double precision DEFAULT 15, occasion_param text DEFAULT NULL::text, dietary_param text[] DEFAULT NULL::text[], target_partner_id_param uuid DEFAULT NULL::uuid, note_param text DEFAULT NULL::text)
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
    radius_miles, expires_at, gathering_id, occasion, dietary, target_partner_id, note_for_business
  ) values (
    auth.uid(), trim(raw_text_param), category_param, v_party_size,
    v_scheduled_at::date, v_lat, v_lng, coalesce(radius_miles_param, 15),
    v_expires_at, gathering_id_param, occasion_param, public.normalize_dietary(dietary_param), target_partner_id_param, v_note
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

revoke all on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision, text, text[], uuid, text) from public, anon;
grant execute on function public.create_business_request_for_gathering(uuid, text, text, integer, double precision, text, text[], uuid, text) to authenticated;

CREATE OR REPLACE FUNCTION public.get_business_opportunities(partner_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from public.profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'Not authorized for this business';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      bro.id, bro.request_id, bro.partner_id, bro.offer_type, bro.offer_price, bro.price_is_per_person,
      bro.offer_description, bro.proposed_time, bro.created_at, bro.expires_at,
      bro.responded_at, bro.accepted_at, bro.completed_at, bro.status,
      bro.availability_id, bro.viewed_at, bro.decline_reason, bro.decline_note,
      bro.experience_id, bro.media_path, bro.media_type, bro.cancelled_at, bro.package_id, bro.is_directed,
      jsonb_build_object(
        'category', br.category,
        'party_size', br.party_size,
        'budget_min', br.budget_min,
        'budget_max', br.budget_max,
        'date', br.date,
        'time_window_start', br.time_window_start,
        'time_window_end', br.time_window_end,
        'status', br.status,
        'expires_at', br.expires_at,
        'summary', public.business_safe_request_summary(br.id),
        'is_match_request', br.match_id is not null,
        'attributes', br.attributes,
        'dietary', case when cardinality(br.dietary) > 0 then to_jsonb(br.dietary) else null end,
        'cuisine', br.cuisine,
        'occasion', br.occasion,
        'experience_level', br.experience_level,
        'surprise_mode', br.surprise_mode,
        'addon_type', br.addon_type,
        'is_addon', br.parent_request_id is not null,
        'plan_time', br.plan_time,
        'note', case when bro.is_directed then br.note_for_business else null end,
        'gatherings', case when g.id is not null then jsonb_build_object(
          'interest_tag', g.interest_tag,
          'title', case when bro.is_directed and public._title_safe_for_business(g.title) then g.title else null end,
          'scheduled_at', g.scheduled_at,
          'price_level', g.price_level,
          'party_type', g.party_type
        ) else null end,
        'requester_display_name', case
          when bro.status in ('accepted', 'completed') and br.match_id is null
          then req.display_name
          else null
        end
      ) as business_requests,
      case when bres.id is not null then jsonb_build_object(
        'status', bres.status,
        'business_payments', case when bp.id is not null then jsonb_build_object('status', bp.status) else null end
      ) else null end as business_reservations
    from public.business_request_offers bro
    join public.business_requests br on br.id = bro.request_id
    left join public.gatherings g on g.id = br.gathering_id
    left join public.profiles req on req.id = br.requester_id
    left join public.business_reservations bres on bres.offer_id = bro.id
    left join public.business_payments bp on bp.reservation_id = bres.id
    where bro.partner_id = partner_id_param
  ) t;

  return v_result;
end;
$function$
;
