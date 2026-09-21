-- New occasion (owner request, 2026-09-21): first_date ("First Date"), so "first date" is a real intent rather than only a
-- Dating & Social tag. Same as 20270182: every occasion vocabulary gate widened together -- the table CHECKs and the functions
-- with an inline copy, each patched from its LIVE definition. Bundles keep their own narrow list (business_availability).

alter table public.brand_partners drop constraint if exists brand_partners_priority_occasions_check;
alter table public.brand_partners add constraint brand_partners_priority_occasions_check CHECK ((priority_occasions <@ ARRAY['birthday'::text, 'anniversary'::text, 'date_night'::text, 'celebration'::text, 'casual_hangout'::text, 'business_meal'::text, 'family_gathering'::text, 'graduation'::text, 'baby_shower'::text, 'engagement'::text, 'wedding'::text, 'housewarming'::text, 'new_job'::text, 'promotion'::text, 'retirement'::text, 'achievement'::text, 'moving'::text, 'farewell'::text, 'reunion'::text, 'welcome'::text, 'holiday_gathering'::text, 'bachelor_bachelorette'::text, 'fundraiser'::text, 'first_date'::text, 'milestone'::text, 'life_event'::text, 'other'::text]));

alter table public.business_occasion_packages drop constraint if exists business_occasion_packages_occasion_type_check;
alter table public.business_occasion_packages add constraint business_occasion_packages_occasion_type_check CHECK ((occasion_type = ANY (ARRAY['birthday'::text, 'anniversary'::text, 'date_night'::text, 'celebration'::text, 'casual_hangout'::text, 'business_meal'::text, 'family_gathering'::text, 'graduation'::text, 'baby_shower'::text, 'engagement'::text, 'wedding'::text, 'housewarming'::text, 'new_job'::text, 'promotion'::text, 'retirement'::text, 'achievement'::text, 'moving'::text, 'farewell'::text, 'reunion'::text, 'welcome'::text, 'holiday_gathering'::text, 'bachelor_bachelorette'::text, 'fundraiser'::text, 'first_date'::text, 'milestone'::text, 'life_event'::text, 'other'::text])));

alter table public.business_partner_requests drop constraint if exists business_partner_requests_priority_occasions_check;
alter table public.business_partner_requests add constraint business_partner_requests_priority_occasions_check CHECK ((priority_occasions <@ ARRAY['birthday'::text, 'anniversary'::text, 'date_night'::text, 'celebration'::text, 'casual_hangout'::text, 'business_meal'::text, 'family_gathering'::text, 'graduation'::text, 'baby_shower'::text, 'engagement'::text, 'wedding'::text, 'housewarming'::text, 'new_job'::text, 'promotion'::text, 'retirement'::text, 'achievement'::text, 'moving'::text, 'farewell'::text, 'reunion'::text, 'welcome'::text, 'holiday_gathering'::text, 'bachelor_bachelorette'::text, 'fundraiser'::text, 'first_date'::text, 'milestone'::text, 'life_event'::text, 'other'::text]));

alter table public.business_requests drop constraint if exists business_requests_occasion_check;
alter table public.business_requests add constraint business_requests_occasion_check CHECK (((occasion IS NULL) OR (occasion = ANY (ARRAY['birthday'::text, 'anniversary'::text, 'date_night'::text, 'celebration'::text, 'casual_hangout'::text, 'business_meal'::text, 'family_gathering'::text, 'graduation'::text, 'baby_shower'::text, 'engagement'::text, 'wedding'::text, 'housewarming'::text, 'new_job'::text, 'promotion'::text, 'retirement'::text, 'achievement'::text, 'moving'::text, 'farewell'::text, 'reunion'::text, 'welcome'::text, 'holiday_gathering'::text, 'bachelor_bachelorette'::text, 'fundraiser'::text, 'first_date'::text, 'milestone'::text, 'life_event'::text, 'other'::text]))));

alter table public.occasion_group_plans drop constraint if exists occasion_group_plans_occasion_type_check;
alter table public.occasion_group_plans add constraint occasion_group_plans_occasion_type_check CHECK ((occasion_type = ANY (ARRAY['birthday'::text, 'anniversary'::text, 'celebration'::text, 'graduation'::text, 'baby_shower'::text, 'engagement'::text, 'wedding'::text, 'housewarming'::text, 'new_job'::text, 'promotion'::text, 'retirement'::text, 'achievement'::text, 'moving'::text, 'farewell'::text, 'reunion'::text, 'welcome'::text, 'holiday_gathering'::text, 'bachelor_bachelorette'::text, 'fundraiser'::text, 'first_date'::text, 'milestone'::text, 'life_event'::text, 'other'::text])));

alter table public.occasions drop constraint if exists occasions_occasion_type_check;
alter table public.occasions add constraint occasions_occasion_type_check CHECK ((occasion_type = ANY (ARRAY['birthday'::text, 'anniversary'::text, 'celebration'::text, 'graduation'::text, 'milestone'::text, 'life_event'::text, 'baby_shower'::text, 'engagement'::text, 'wedding'::text, 'housewarming'::text, 'new_job'::text, 'promotion'::text, 'retirement'::text, 'achievement'::text, 'moving'::text, 'farewell'::text, 'reunion'::text, 'welcome'::text, 'holiday_gathering'::text, 'bachelor_bachelorette'::text, 'fundraiser'::text, 'first_date'::text, 'other'::text])));

CREATE OR REPLACE FUNCTION public._occasion_emoji(occasion_type_param text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case occasion_type_param
    when 'birthday' then '🎂'
    when 'anniversary' then '💍'
    when 'celebration' then '🎉'
    when 'graduation' then '🎓'
    when 'baby_shower' then '🍼'
    when 'engagement' then '💒'
    when 'wedding' then '💐'
    when 'housewarming' then '🏠'
    when 'new_job' then '🚀'
    when 'promotion' then '📈'
    when 'retirement' then '🌅'
    when 'achievement' then '🏆'
    when 'moving' then '📦'
    when 'farewell' then '👋'
    when 'reunion' then '🤗'
    when 'welcome' then '🙌'
    when 'holiday_gathering' then '🎇'
    when 'bachelor_bachelorette' then '🎊'
    when 'fundraiser' then '🎗️'
    when 'first_date' then '🌹'
    when 'milestone' then '🥂'
    when 'life_event' then '🌟'
    when 'other' then '✨'
    else '📅'
  end;
$function$;

CREATE OR REPLACE FUNCTION public._occasion_noun(occasion_type_param text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case occasion_type_param
    when 'birthday' then 'Birthday'
    when 'anniversary' then 'Anniversary'
    when 'celebration' then 'Celebration'
    when 'graduation' then 'Graduation'
    when 'baby_shower' then 'Baby Shower'
    when 'engagement' then 'Engagement'
    when 'wedding' then 'Wedding'
    when 'housewarming' then 'Housewarming'
    when 'new_job' then 'New Job'
    when 'promotion' then 'Promotion'
    when 'retirement' then 'Retirement'
    when 'achievement' then 'Achievement'
    when 'moving' then 'Moving'
    when 'farewell' then 'Farewell'
    when 'reunion' then 'Reunion'
    when 'welcome' then 'Welcome'
    when 'holiday_gathering' then 'Holiday Gathering'
    when 'bachelor_bachelorette' then 'Bachelor/Bachelorette Party'
    when 'fundraiser' then 'Fundraiser'
    when 'first_date' then 'First Date'
    when 'milestone' then 'Milestone'
    when 'life_event' then 'Life Event'
    when 'other' then 'Occasion'
    else 'Occasion'
  end;
$function$;

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
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'bachelor_bachelorette', 'fundraiser', 'first_date', 'milestone',
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
    radius_miles, expires_at, gathering_id, occasion, dietary, target_partner_id, note_for_business
  ) values (
    auth.uid(), trim(raw_text_param), category_param, v_party_size,
    v_local_date, v_local_time, v_lat, v_lng, coalesce(radius_miles_param, 15),
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
$function$;

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
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'bachelor_bachelorette', 'fundraiser', 'first_date', 'milestone',
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

CREATE OR REPLACE FUNCTION public.create_business_request(raw_text_param text, latitude_param double precision, longitude_param double precision, category_param text DEFAULT NULL::text, party_size_param integer DEFAULT NULL::integer, budget_min_param integer DEFAULT NULL::integer, budget_max_param integer DEFAULT NULL::integer, date_param date DEFAULT NULL::date, time_window_start_param time without time zone DEFAULT NULL::time without time zone, time_window_end_param time without time zone DEFAULT NULL::time without time zone, radius_miles_param double precision DEFAULT 15, submission_id_param uuid DEFAULT NULL::uuid, preferred_availability_id_param uuid DEFAULT NULL::uuid, attributes_param text[] DEFAULT NULL::text[], cuisine_param text DEFAULT NULL::text, occasion_param text DEFAULT NULL::text, preferred_package_id_param uuid DEFAULT NULL::uuid, experience_level_param text DEFAULT NULL::text, surprise_mode_param boolean DEFAULT false, shared_interests_param text[] DEFAULT NULL::text[], dietary_param text[] DEFAULT NULL::text[], target_partner_id_param uuid DEFAULT NULL::uuid, note_param text DEFAULT NULL::text, items_param text[] DEFAULT NULL::text[])
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

  if items_param is not null and (cardinality(items_param) > 9 or not items_param <@ array['coffee','tea','pastries','cake','sandwiches','appetizers','full_meal','desserts','soft_drinks']::text[]) then
    raise exception 'Invalid requested item';
  end if;

  if cuisine_param is not null and cuisine_param not in ('italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'other') then
    raise exception 'Invalid cuisine';
  end if;

  if occasion_param is not null and occasion_param not in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'wedding', 'housewarming',
    'new_job', 'promotion', 'retirement', 'achievement', 'moving',
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'bachelor_bachelorette', 'fundraiser', 'first_date', 'milestone',
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

  v_expires_at := coalesce(
    public._business_request_expiry(auth.uid(), date_param, time_window_start_param, time_window_end_param),
    now() + interval '48 hours');

  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, budget_min, budget_max,
    date, time_window_start, time_window_end, latitude, longitude,
    radius_miles, expires_at, submission_id, attributes, cuisine, occasion,
    experience_level, surprise_mode, shared_interests, dietary, target_partner_id, note_for_business, requested_items
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param,
    budget_min_param, budget_max_param, date_param, time_window_start_param,
    time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at,
    (select id from intent_submissions where id = submission_id_param and user_id = auth.uid()),
    coalesce(attributes_param, '{}'), cuisine_param, occasion_param,
    experience_level_param, coalesce(surprise_mode_param, false), v_shared_interests,
    coalesce((select array_agg(distinct t order by t) from unnest(dietary_param) t), '{}'),
    target_partner_id_param, v_note,
    coalesce((select array_agg(distinct t order by t) from unnest(items_param) t), '{}')
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
$function$;

CREATE OR REPLACE FUNCTION public.create_occasion_package(occasion_type_param text, name_param text, description_param text DEFAULT NULL::text, included_items_param text[] DEFAULT '{}'::text[], min_guests_param integer DEFAULT NULL::integer, price_per_person_param numeric DEFAULT NULL::numeric, available_days_param smallint[] DEFAULT NULL::smallint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_package_id uuid;
  v_items text[];
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  if name_param is null or length(trim(name_param)) = 0 then
    raise exception 'Give this package a real name.';
  end if;

  if occasion_type_param is null or occasion_type_param not in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'wedding', 'housewarming',
    'new_job', 'promotion', 'retirement', 'achievement', 'moving',
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'bachelor_bachelorette', 'fundraiser', 'first_date', 'milestone',
    'life_event', 'other'
  ) then
    raise exception 'Invalid occasion';
  end if;

  if min_guests_param is not null and min_guests_param <= 0 then
    raise exception 'Minimum guests must be a positive number.';
  end if;

  if price_per_person_param is not null and price_per_person_param < 0 then
    raise exception 'Price per person cannot be negative.';
  end if;

  if available_days_param is not null and not (available_days_param <@ array[0,1,2,3,4,5,6]::smallint[]) then
    raise exception 'Invalid day of week';
  end if;

  select array_agg(trim(item)) into v_items
  from unnest(coalesce(included_items_param, '{}'::text[])) as item
  where length(trim(item)) > 0;

  insert into business_occasion_packages (
    partner_id, occasion_type, name, description, included_items,
    min_guests, price_per_person, available_days
  ) values (
    v_partner_id, occasion_type_param, trim(name_param),
    nullif(trim(coalesce(description_param, '')), ''),
    coalesce(v_items, '{}'), min_guests_param, price_per_person_param, available_days_param
  ) returning id into v_package_id;

  return jsonb_build_object('packageId', v_package_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_business_priority_occasions(partner_id_param uuid, occasions_param text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  if not (occasions_param <@ array[
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'wedding', 'housewarming',
    'new_job', 'promotion', 'retirement', 'achievement', 'moving',
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'bachelor_bachelorette', 'fundraiser', 'first_date', 'milestone',
    'life_event', 'other'
  ]::text[]) then
    raise exception 'Invalid occasion';
  end if;

  update brand_partners
  set priority_occasions = occasions_param
  where id = partner_id_param;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_occasion_package(package_id_param uuid, occasion_type_param text, name_param text, description_param text DEFAULT NULL::text, included_items_param text[] DEFAULT '{}'::text[], min_guests_param integer DEFAULT NULL::integer, price_per_person_param numeric DEFAULT NULL::numeric, available_days_param smallint[] DEFAULT NULL::smallint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_items text[];
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  if not exists (
    select 1 from business_occasion_packages where id = package_id_param and partner_id = v_partner_id
  ) then
    raise exception 'Package not found.';
  end if;

  if name_param is null or length(trim(name_param)) = 0 then
    raise exception 'Give this package a real name.';
  end if;

  if occasion_type_param is null or occasion_type_param not in (
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'wedding', 'housewarming',
    'new_job', 'promotion', 'retirement', 'achievement', 'moving',
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'bachelor_bachelorette', 'fundraiser', 'first_date', 'milestone',
    'life_event', 'other'
  ) then
    raise exception 'Invalid occasion';
  end if;

  if min_guests_param is not null and min_guests_param <= 0 then
    raise exception 'Minimum guests must be a positive number.';
  end if;

  if price_per_person_param is not null and price_per_person_param < 0 then
    raise exception 'Price per person cannot be negative.';
  end if;

  if available_days_param is not null and not (available_days_param <@ array[0,1,2,3,4,5,6]::smallint[]) then
    raise exception 'Invalid day of week';
  end if;

  select array_agg(trim(item)) into v_items
  from unnest(coalesce(included_items_param, '{}'::text[])) as item
  where length(trim(item)) > 0;

  update business_occasion_packages
  set occasion_type = occasion_type_param,
      name = trim(name_param),
      description = nullif(trim(coalesce(description_param, '')), ''),
      included_items = coalesce(v_items, '{}'),
      min_guests = min_guests_param,
      price_per_person = price_per_person_param,
      available_days = available_days_param,
      updated_at = now()
  where id = package_id_param and partner_id = v_partner_id;

  return jsonb_build_object('packageId', package_id_param);
end;
$function$;
