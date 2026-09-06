-- Intent engine vision, layer 3 (semantic tags) -- first increment
-- (2026-09-06/27). Per direct user pick when asked how to scope this
-- (memory project_intent_engine_vision): expand the existing
-- BUSINESS_ATTRIBUTE_OPTIONS vocabulary rather than inventing a new
-- tags table/schema -- a flat text[] is "perfectly adequate for the
-- current stage" per the user's own words -- and fold "Hobbies &
-- Interests" (the vision doc's own item: a hobby like photography
-- should surface a meetup, a camera store, a class, a trail, and a
-- coffee shop, not be trapped under one category) into this same
-- vocabulary as cross-cutting "good for X" tags rather than a 20th
-- major category. Adds 10 new values to the existing 8:
--   specialty_coffee, laptop_friendly, dog_friendly, waterfront,
--   late_night (general quality/vibe tags), and board_game_friendly,
--   photography_friendly, book_lovers, craft_friendly, fitness_focused
--   (hobby-adjacent tags -- any business in any category can self-tag
--   "good for board games" etc., which is exactly the cross-category
--   behavior the vision doc wants, achieved via the attributes axis
--   instead of a category fan-out mechanism).
--
-- Deliberately did NOT add "romantic" as its own value alongside the
-- existing "date_friendly" -- the two are the same real-world quality,
-- and this vocabulary already has one honest name for it.
--
-- No hard filter anywhere uses this array -- attributeAndCuisineBonus()
-- (intentResolverScoring.js) already scores any overlap between an ask's
-- extracted attributes and a business's own row.attributes generically
-- (no vocabulary hardcoded in that function), so widening this array is
-- sufficient to wire the new tags into ranking; no resolver code change
-- needed for the bonus itself.
--
-- CREATE OR REPLACE FUNCTION on an *unchanged* parameter list is safe
-- from the overload gotcha documented in CLAUDE.md -- confirmed via
-- pg_get_function_identity_arguments that update_business_profile and
-- create_business_request each have exactly one live overload before
-- this migration, and their signatures are reproduced byte-for-byte
-- below, only the attributes validation array inside each body changes.

-- 1. Widen the CHECK constraints on both tables that store this vocabulary.
alter table brand_partners drop constraint brand_partners_attributes_check;
alter table brand_partners
  add constraint brand_partners_attributes_check
  check (attributes <@ array[
    'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music',
    'kid_friendly', 'quiet', 'casual', 'upscale',
    'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront',
    'late_night', 'board_game_friendly', 'photography_friendly',
    'book_lovers', 'craft_friendly', 'fitness_focused'
  ]::text[]);

alter table business_requests drop constraint business_requests_attributes_check;
alter table business_requests
  add constraint business_requests_attributes_check
  check (attributes <@ array[
    'outdoor_seating', 'date_friendly', 'group_friendly', 'live_music',
    'kid_friendly', 'quiet', 'casual', 'upscale',
    'specialty_coffee', 'laptop_friendly', 'dog_friendly', 'waterfront',
    'late_night', 'board_game_friendly', 'photography_friendly',
    'book_lovers', 'craft_friendly', 'fitness_focused'
  ]::text[]);

-- 2. update_business_profile() -- same signature, wider attributes check.
CREATE OR REPLACE FUNCTION public.update_business_profile(partner_id_param uuid, name_param text, description_param text, address_param text, latitude_param double precision, longitude_param double precision, logo_url_param text, category_param text DEFAULT NULL::text, attributes_param text[] DEFAULT NULL::text[], cuisine_param text DEFAULT NULL::text, differentiator_param text DEFAULT NULL::text, subcategory_param text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_valid_subcats text[];
begin
  if not exists (
    select 1 from profiles
    where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business';
  end if;

  if name_param is null or trim(name_param) = '' then
    raise exception 'Business name cannot be empty';
  end if;

  if category_param is not null and category_param not in (
    'food_drink', 'activities_recreation', 'entertainment_nightlife', 'dating_social',
    'arts_culture_learning', 'shopping', 'wellness_beauty', 'family_kids',
    'outdoors_nature', 'pets', 'home_local_services', 'auto_transportation',
    'business_networking', 'community_volunteering', 'travel_experiences',
    'stay_getaway', 'health_personal_care', 'education_classes', 'attractions_things_to_see',
    'other'
  ) then
    raise exception 'Invalid category';
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

  if differentiator_param is not null and char_length(differentiator_param) > 280 then
    raise exception 'Differentiator is too long';
  end if;

  v_valid_subcats := case category_param
    when 'food_drink' then array['Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour']
    when 'activities_recreation' then array['Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling']
    when 'entertainment_nightlife' then array['Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife']
    when 'dating_social' then array['Dating','Speed Dating','Singles Events','Group Hangouts']
    when 'arts_culture_learning' then array['Reading','Art','Photography','Crafts']
    when 'shopping' then array['Farmers Markets','Thrift & Vintage']
    when 'wellness_beauty' then array['Meditation','Spa Day','Self-Care']
    when 'family_kids' then array['Family Playdate','Kids Activity']
    when 'outdoors_nature' then array['Hiking','Outdoors','Camping','Fishing','Kayaking']
    when 'pets' then array['Dogs','Cats','Dog Meetup']
    when 'business_networking' then array['Networking','Coworking']
    when 'community_volunteering' then array['Volunteering','Faith & Spirituality','Fundraiser']
    when 'travel_experiences' then array['Travel','Day Trip']
    when 'stay_getaway' then array['Weekend Getaway','Staycation','Road Trip']
    when 'education_classes' then array['Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup']
    when 'attractions_things_to_see' then array['Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing']
    else array[]::text[]
  end;
  if subcategory_param is not null and not (subcategory_param = any(v_valid_subcats)) then
    raise exception 'Invalid subcategory for this category';
  end if;

  update brand_partners
  set name = name_param,
      description = description_param,
      address = address_param,
      latitude = latitude_param,
      longitude = longitude_param,
      logo_url = logo_url_param,
      category = category_param,
      attributes = coalesce(attributes_param, attributes),
      cuisine = case when attributes_param is not null then cuisine_param else cuisine end,
      differentiator = coalesce(differentiator_param, differentiator),
      subcategory = subcategory_param
  where id = partner_id_param;
end;
$function$;

-- 3. create_business_request() -- same signature, wider attributes check.
CREATE OR REPLACE FUNCTION public.create_business_request(raw_text_param text, latitude_param double precision, longitude_param double precision, category_param text DEFAULT NULL::text, party_size_param integer DEFAULT NULL::integer, budget_min_param integer DEFAULT NULL::integer, budget_max_param integer DEFAULT NULL::integer, date_param date DEFAULT NULL::date, time_window_start_param time without time zone DEFAULT NULL::time without time zone, time_window_end_param time without time zone DEFAULT NULL::time without time zone, radius_miles_param double precision DEFAULT 15, submission_id_param uuid DEFAULT NULL::uuid, preferred_availability_id_param uuid DEFAULT NULL::uuid, attributes_param text[] DEFAULT NULL::text[], cuisine_param text DEFAULT NULL::text, occasion_param text DEFAULT NULL::text)
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

  if occasion_param is not null and occasion_param not in ('birthday', 'anniversary', 'date_night', 'celebration', 'casual_hangout', 'business_meal', 'family_gathering', 'other') then
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
  select public._ai_auto_respond_to_business_requests(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, party_size_param, time_window_start_param, time_window_end_param) into v_ai_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0) + coalesce(v_ai_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;
