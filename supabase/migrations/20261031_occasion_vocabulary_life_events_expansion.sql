-- Item 73 (CLAUDE.md): "This can work for non-social life events too ...
-- don't hard-code the product around birthdays." Widens the occasion
-- vocabulary with 8 real values from the user's own list that weren't
-- covered yet -- wedding, retirement, new_job, achievement, moving,
-- reunion, welcome, holiday_gathering -- and, on the client
-- (businessAttributes.js), reorganizes the whole vocabulary into a real
-- grouped architecture (Celebrations / Milestones / Social Moments /
-- Custom) instead of one ever-longer flat chip row. 'promotion' is
-- relabeled from "Promotion / New Job" to plain "Promotion" now that
-- 'new_job' is its own real value -- a label-only change, the key itself
-- and every existing row's data are untouched.
--
-- Every occasion vocabulary gate in the schema is widened together, in
-- one migration, specifically because this repo has now hit the same
-- "an inline copy of the list drifted" bug twice (Item 68's own fix
-- comment describes the first instance) -- widen table CHECK constraints
-- AND every function with its own inline copy in the same change, or the
-- next occasion added risks silently regressing a subset of them again.
--
-- A REAL, PRE-EXISTING BUG found and fixed here, disclosed rather than
-- silently bundled: set_business_priority_occasions() -- the RPC behind
-- BusinessDashboardScreen.js's own "priority occasions" chip picker,
-- which already renders the full flat OCCASION_OPTIONS list including
-- graduation/baby_shower/engagement/housewarming/promotion/farewell/
-- milestone/life_event -- had its OWN inline validation stuck at the
-- original 8-value list from 20260913_business_priority_occasions.sql,
-- never updated when 20261016_celebrate_occasion_vocabulary_expansion.sql
-- widened everything else to 16 values. The table's own
-- brand_partners_priority_occasions_check constraint was correctly
-- widened at the time -- only this one function's application-level
-- check was missed. Confirmed live before fixing: a business picking
-- graduation (or any of the 7 other newer values) as a priority occasion
-- hit "Invalid occasion" from this RPC, even though the column itself
-- would have happily accepted it. Fixed to the same real vocabulary as
-- every other gate in this migration.
--
-- Deliberately NOT touched, a disclosed scope boundary matching Item 68's
-- own precedent exactly: business_availability_bundle_occasion_check
-- (business-declared "Experience Bundle" postings) stays scoped to its
-- own deliberately narrower 5-occasion list -- extending bundle support
-- to the 8 new values would mean designing new experienceTemplates.js
-- component templates for each, a real, separate, bigger feature.
--
-- TWO MORE REAL, PRE-EXISTING GAPS found live (via a disposable rolled-
-- back transaction) after the rest of this migration was already applied,
-- both disclosed and fixed here rather than left for a future session to
-- rediscover the hard way:
--
-- (1) business_occasion_packages_occasion_type_check (Item 68's own
-- Occasion Packages table) was stuck at the original 16-value list --
-- create_occasion_package/update_occasion_package's own inline checks
-- were correctly widened to 24 values above, but the underlying TABLE
-- constraint never was, so a business trying to create a real "Retirement
-- Send-off Package" (or any of the other 7 new values) would pass the
-- function-level check and then hit a hard, confusing 23514 at the INSERT
-- itself. Confirmed live before fixing: exactly this failure reproduced
-- for occasion_type = 'retirement'.
--
-- (2) business_partner_requests_priority_occasions_check (the pending-
-- application table, distinct from brand_partners' own already-widened
-- version above) was never widened even by the ORIGINAL Sep 16 2026
-- 8->16 expansion -- still stuck at the very first 8-value list from
-- 20260913_business_priority_occasions.sql. BusinessPartnerApplyScreen.js
-- inserts directly into this table (no RPC/function layer in front of
-- it) and its own chip picker already renders the full, current
-- OCCASION_OPTIONS list -- so any applicant picking graduation, wedding,
-- or any of the 15 non-original values as a priority occasion has always
-- hit a hard, unexplained submission failure. Widened to the same
-- 24-value list as brand_partners' own version for consistency.

alter table public.business_occasion_packages drop constraint if exists business_occasion_packages_occasion_type_check;
alter table public.business_occasion_packages
  add constraint business_occasion_packages_occasion_type_check
  check (occasion_type = any (array[
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'wedding', 'housewarming',
    'new_job', 'promotion', 'retirement', 'achievement', 'moving',
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'milestone',
    'life_event', 'other'
  ]));

alter table public.business_partner_requests drop constraint if exists business_partner_requests_priority_occasions_check;
alter table public.business_partner_requests
  add constraint business_partner_requests_priority_occasions_check
  check (priority_occasions <@ array[
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'wedding', 'housewarming',
    'new_job', 'promotion', 'retirement', 'achievement', 'moving',
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'milestone',
    'life_event', 'other'
  ]::text[]);


-- ---------- Table CHECK constraints ----------

alter table public.business_requests drop constraint if exists business_requests_occasion_check;
alter table public.business_requests
  add constraint business_requests_occasion_check
  check (occasion is null or occasion = any (array[
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'wedding', 'housewarming',
    'new_job', 'promotion', 'retirement', 'achievement', 'moving',
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'milestone',
    'life_event', 'other'
  ]));

alter table public.brand_partners drop constraint if exists brand_partners_priority_occasions_check;
alter table public.brand_partners
  add constraint brand_partners_priority_occasions_check
  check (priority_occasions <@ array[
    'birthday', 'anniversary', 'date_night', 'celebration',
    'casual_hangout', 'business_meal', 'family_gathering',
    'graduation', 'baby_shower', 'engagement', 'wedding', 'housewarming',
    'new_job', 'promotion', 'retirement', 'achievement', 'moving',
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'milestone',
    'life_event', 'other'
  ]::text[]);

alter table public.occasion_group_plans drop constraint if exists occasion_group_plans_occasion_type_check;
alter table public.occasion_group_plans
  add constraint occasion_group_plans_occasion_type_check
  check (occasion_type = any (array[
    'birthday', 'anniversary', 'graduation', 'baby_shower', 'engagement',
    'wedding', 'housewarming', 'new_job', 'promotion', 'retirement',
    'achievement', 'moving', 'farewell', 'reunion', 'welcome',
    'holiday_gathering', 'milestone', 'life_event', 'other'
  ]));

alter table public.occasions drop constraint if exists occasions_occasion_type_check;
alter table public.occasions
  add constraint occasions_occasion_type_check
  check (occasion_type = any (array[
    'birthday', 'anniversary', 'graduation', 'milestone', 'life_event',
    'baby_shower', 'engagement', 'wedding', 'housewarming', 'new_job',
    'promotion', 'retirement', 'achievement', 'moving', 'farewell',
    'reunion', 'welcome', 'holiday_gathering', 'other'
  ]));

-- ---------- Functions with their own inline occasion validation ----------

CREATE OR REPLACE FUNCTION public.create_business_request(raw_text_param text, latitude_param double precision, longitude_param double precision, category_param text DEFAULT NULL::text, party_size_param integer DEFAULT NULL::integer, budget_min_param integer DEFAULT NULL::integer, budget_max_param integer DEFAULT NULL::integer, date_param date DEFAULT NULL::date, time_window_start_param time without time zone DEFAULT NULL::time without time zone, time_window_end_param time without time zone DEFAULT NULL::time without time zone, radius_miles_param double precision DEFAULT 15, submission_id_param uuid DEFAULT NULL::uuid, preferred_availability_id_param uuid DEFAULT NULL::uuid, attributes_param text[] DEFAULT NULL::text[], cuisine_param text DEFAULT NULL::text, occasion_param text DEFAULT NULL::text, preferred_package_id_param uuid DEFAULT NULL::uuid)
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
begin
  if raw_text_param is null or length(trim(raw_text_param)) = 0 then
    raise exception 'A request needs some text describing what you want.';
  end if;

  if attributes_param is not null and not (attributes_param <@ array[
    'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music',
    'kid_friendly', 'quiet', 'casual', 'upscale',
    'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront',
    'late_night', 'board_game_friendly', 'photography_friendly',
    'book_lovers', 'craft_friendly', 'fitness_focused'
  ]::text[]) then
    raise exception 'Invalid attribute';
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
    radius_miles, expires_at, submission_id, attributes, cuisine, occasion
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param,
    budget_min_param, budget_max_param, date_param, time_window_start_param,
    time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at,
    (select id from intent_submissions where id = submission_id_param and user_id = auth.uid()),
    coalesce(attributes_param, '{}'), cuisine_param, occasion_param
  ) returning id into v_request_id;

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

CREATE OR REPLACE FUNCTION public.create_business_request_for_gathering(gathering_id_param uuid, raw_text_param text, category_param text DEFAULT NULL::text, budget_max_param integer DEFAULT NULL::integer, radius_miles_param double precision DEFAULT 15, occasion_param text DEFAULT NULL::text)
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
    radius_miles, expires_at, gathering_id, occasion
  ) values (
    auth.uid(), trim(raw_text_param), category_param, v_party_size,
    v_scheduled_at::date, v_lat, v_lng, coalesce(radius_miles_param, 15),
    v_expires_at, gathering_id_param, occasion_param
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), category_param, v_scheduled_at::date, null, null, null, v_party_size) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, v_lat, v_lng, coalesce(radius_miles_param, 15), v_party_size, null, null) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', v_party_size);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_business_request_for_match(match_id_param uuid, raw_text_param text, latitude_param double precision, longitude_param double precision, category_param text DEFAULT NULL::text, budget_max_param integer DEFAULT NULL::integer, date_param date DEFAULT NULL::date, time_window_start_param time without time zone DEFAULT NULL::time without time zone, time_window_end_param time without time zone DEFAULT NULL::time without time zone, radius_miles_param double precision DEFAULT 15, occasion_param text DEFAULT NULL::text)
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
    expires_at, match_id, occasion
  ) values (
    auth.uid(), trim(raw_text_param), v_category, 2, budget_max_param, date_param,
    time_window_start_param, time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at, match_id_param, occasion_param
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), v_category, date_param, time_window_start_param, time_window_end_param, v_proposal.availability_id, 2) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), 2, time_window_start_param, time_window_end_param) into v_policy_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count, 'partySize', 2);
end;
$function$
;

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
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'milestone',
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
$function$
;

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
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'milestone',
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
$function$
;

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
    'farewell', 'reunion', 'welcome', 'holiday_gathering', 'milestone',
    'life_event', 'other'
  ]::text[]) then
    raise exception 'Invalid occasion';
  end if;

  update brand_partners
  set priority_occasions = occasions_param
  where id = partner_id_param;
end;
$function$
;

-- ---------- send_occasion_planning_nudges: add 'wedding' to the 14-day lead-time bucket ----------

CREATE OR REPLACE FUNCTION public.send_occasion_planning_nudges()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  service_key text;
  occasion_row record;
  v_next_date date;
  v_year int;
  v_month int;
  v_day int;
  v_lead_days int;
  v_emoji text;
  v_noun text;
  v_body_suffix text;
begin
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for occasion_row in
    select id, user_id, occasion_type, title, occasion_date, recurs_annually,
           who_for_name, who_for_friend_id, resulting_plan_id, last_planned_at,
           reminder_enabled
    from occasions
    where reminder_enabled
  loop
    if occasion_row.recurs_annually then
      v_year := extract(year from current_date)::int;
      v_month := extract(month from occasion_row.occasion_date)::int;
      v_day := extract(day from occasion_row.occasion_date)::int;
      begin
        v_next_date := make_date(v_year, v_month, v_day);
      exception when others then
        v_next_date := make_date(v_year, 2, 28);
      end;
      if v_next_date < current_date then
        begin
          v_next_date := make_date(v_year + 1, v_month, v_day);
        exception when others then
          v_next_date := make_date(v_year + 1, 2, 28);
        end;
      end if;
    else
      v_next_date := occasion_row.occasion_date;
    end if;

    v_lead_days := case occasion_row.occasion_type
      when 'anniversary' then 14
      when 'graduation' then 14
      when 'baby_shower' then 14
      when 'engagement' then 14
      when 'wedding' then 14
      when 'housewarming' then 14
      else 7
    end;

    if (v_next_date - current_date) <> v_lead_days then
      continue;
    end if;

    -- Already turned into a real plan for this upcoming date -- don't nag
    -- about something the user already handled. See the prior migration's
    -- header comment for why ~350 days is an honest approximation, not an
    -- exact per-year-instance check this table has no way to make.
    if occasion_row.resulting_plan_id is not null
       and occasion_row.last_planned_at is not null
       and occasion_row.last_planned_at > (v_next_date - interval '350 days') then
      continue;
    end if;

    if not coalesce((select notify_social from profiles where id = occasion_row.user_id), true) then
      continue;
    end if;

    -- Item 73: extended with the 8 new life-event types -- without this,
    -- each would have silently fallen through to the generic "📅 Upcoming
    -- Occasion," even though every one of them has a real, specific icon/
    -- label already defined client-side (OCCASION_OPTIONS,
    -- businessAttributes.js) -- kept in sync with those exact choices.
    v_emoji := case occasion_row.occasion_type
      when 'birthday' then '🎂'
      when 'anniversary' then '💑'
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
      when 'milestone' then '🏆'
      when 'life_event' then '🌟'
      else '📅'
    end;
    v_noun := case occasion_row.occasion_type
      when 'birthday' then 'Birthday'
      when 'anniversary' then 'Anniversary'
      when 'graduation' then 'Graduation'
      when 'baby_shower' then 'Baby Shower'
      when 'engagement' then 'Engagement'
      when 'wedding' then 'Wedding'
      when 'housewarming' then 'Housewarming'
      when 'new_job' then 'New Job'
      when 'promotion' then 'Promotion'
      when 'retirement' then 'Retirement'
      when 'achievement' then 'Achievement'
      when 'moving' then 'Move'
      when 'farewell' then 'Farewell'
      when 'reunion' then 'Reunion'
      when 'welcome' then 'Welcome'
      when 'holiday_gathering' then 'Holiday Gathering'
      when 'milestone' then 'Milestone'
      when 'life_event' then 'Life Event'
      else 'Occasion'
    end;
    v_body_suffix := case occasion_row.occasion_type when 'anniversary' then 'together?' else '?' end;

    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', occasion_row.user_id,
        'title', v_emoji || ' Upcoming ' || v_noun,
        'body', occasion_row.title || ' is in ' || v_lead_days || ' days. Plan something' || v_body_suffix,
        'data', jsonb_build_object(
          'type', 'occasion_upcoming',
          'occasion_id', occasion_row.id,
          'occasion_type', occasion_row.occasion_type,
          'occasion_title', occasion_row.title,
          'who_for_name', occasion_row.who_for_name,
          'who_for_friend_id', occasion_row.who_for_friend_id
        )
      )
    );
  end loop;
end;
$function$
;
