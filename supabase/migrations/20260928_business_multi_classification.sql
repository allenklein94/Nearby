-- Intent engine vision, remaining piece 1 of 2 (multi-classification
-- businesses) -- per direct user pick of scope (memory
-- project_intent_engine_vision, 2026-09-06 doc, "A business should carry
-- multiple classifications simultaneously"): brand_partners/
-- business_partner_requests gain a new `categories text[]` -- a
-- normalized, curated SECONDARY classification, additive to the existing
-- `category` (one of the 19 majors -- what the business fundamentally
-- is) and `subcategory` (one leaf tag under that major -- its
-- specialization). `categories` holds *other* leaf tags the business
-- also legitimately belongs to, not restricted to its own primary
-- major's subset (the whole point -- a food_drink bar that's also a
-- live-music venue should be reachable by an ask resolving to either).
-- Per direct user instruction: never a freeform array -- reuses the
-- exact same curated 75-tag flat leaf vocabulary `subcategory` already
-- validates against (gatheringCategories.js's INTEREST_OPTIONS), not a
-- new one. Matching hierarchy (also per direct user spec): primary
-- category match (row.category, already SCORE_INTEREST_MATCH) >
-- subcategory match > secondary category match ~= semantic
-- tag/occasion match -- secondary category is scored as one more flat
-- SCORE_HAPPENING_NOW bonus (new secondaryCategoryBonus(), same file,
-- same shape as subcategoryBonus()/occasionBonus()/
-- attributeAndCuisineBonus() -- this codebase's own established "every
-- non-primary/non-distance signal is one flat bonus tier" pattern, not a
-- new intermediate weight class), and is capped at that one flat bonus
-- regardless of how many secondary categories are set or how many
-- happen to match, so it can never outrank a real subcategory match by
-- virtue of having more tags.
--
-- Bundled bug fix, found while scoping this: `business_requests.category`,
-- `business_availability.category`, and `business_priority_signals.category`
-- were all still constrained to the PRE-EXPANSION 26-tag list (the old
-- gatheringCategories.js vocabulary from before the 2026-09-06 taxonomy
-- expansion to 75 tags/19 majors) -- never widened when that expansion
-- shipped, even though AskBusinessScreen.js's CATEGORY_OPTIONS and
-- BusinessDashboardScreen.js's priority-boost picker already both render
-- the full new 75-tag INTEREST_OPTIONS list (confirmed by reading both
-- screens directly). Picking almost any of the ~49 new tags in either
-- screen and submitting has been failing at the DB level with a raw
-- constraint-violation error since that expansion shipped. Fixed here
-- (real stabilization work, in scope regardless of user request per
-- CLAUDE.md's feature-freeze convention) because it's also a genuine
-- prerequisite for this feature: `categories` is only useful for
-- matching once an ask can actually resolve to one of the new tags in
-- the first place. create-assistant's own hardcoded VALID_CATEGORIES
-- copy is fixed in the same pass (see that file's own diff).
--
-- CREATE OR REPLACE on an unchanged parameter list (approve_business_
-- partner_request) is safe per the documented overload gotcha. Both
-- update_business_profile (new trailing categories_param) and
-- search_active_business_availability (new returned `categories` column
-- -- a RETURNS TABLE column-list change, which Postgres itself refuses
-- as an in-place REPLACE) explicitly DROP their prior exact signature
-- first, confirmed single-overload before and after.

-- 1. Bug fix: widen the three stale category CHECK constraints to the
-- real, current 75-tag flat leaf vocabulary (identical array to
-- brand_partners_subcategory_check's own, confirmed by direct comparison).
alter table business_requests drop constraint business_requests_category_check;
alter table business_requests add constraint business_requests_category_check
  check (category is null or category = any(array['Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour','Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling','Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife','Dating','Speed Dating','Singles Events','Group Hangouts','Reading','Art','Photography','Crafts','Farmers Markets','Thrift & Vintage','Meditation','Spa Day','Self-Care','Family Playdate','Kids Activity','Hiking','Outdoors','Camping','Fishing','Kayaking','Dogs','Cats','Dog Meetup','Networking','Coworking','Volunteering','Faith & Spirituality','Fundraiser','Travel','Day Trip','Weekend Getaway','Staycation','Road Trip','Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup','Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing']::text[]));

alter table business_availability drop constraint business_availability_category_check;
alter table business_availability add constraint business_availability_category_check
  check (category is null or category = any(array['Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour','Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling','Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife','Dating','Speed Dating','Singles Events','Group Hangouts','Reading','Art','Photography','Crafts','Farmers Markets','Thrift & Vintage','Meditation','Spa Day','Self-Care','Family Playdate','Kids Activity','Hiking','Outdoors','Camping','Fishing','Kayaking','Dogs','Cats','Dog Meetup','Networking','Coworking','Volunteering','Faith & Spirituality','Fundraiser','Travel','Day Trip','Weekend Getaway','Staycation','Road Trip','Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup','Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing']::text[]));

alter table business_priority_signals drop constraint business_priority_signals_category_check;
alter table business_priority_signals add constraint business_priority_signals_category_check
  check (category = any(array['Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour','Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling','Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife','Dating','Speed Dating','Singles Events','Group Hangouts','Reading','Art','Photography','Crafts','Farmers Markets','Thrift & Vintage','Meditation','Spa Day','Self-Care','Family Playdate','Kids Activity','Hiking','Outdoors','Camping','Fishing','Kayaking','Dogs','Cats','Dog Meetup','Networking','Coworking','Volunteering','Faith & Spirituality','Fundraiser','Travel','Day Trip','Weekend Getaway','Staycation','Road Trip','Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup','Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing']::text[]));

-- 2. New `categories` secondary-classification column, same curated
-- 75-tag vocabulary, on both the live table and the pending-request table.
alter table brand_partners add column if not exists categories text[] not null default '{}';
alter table brand_partners add constraint brand_partners_categories_check
  check (categories <@ array['Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour','Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling','Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife','Dating','Speed Dating','Singles Events','Group Hangouts','Reading','Art','Photography','Crafts','Farmers Markets','Thrift & Vintage','Meditation','Spa Day','Self-Care','Family Playdate','Kids Activity','Hiking','Outdoors','Camping','Fishing','Kayaking','Dogs','Cats','Dog Meetup','Networking','Coworking','Volunteering','Faith & Spirituality','Fundraiser','Travel','Day Trip','Weekend Getaway','Staycation','Road Trip','Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup','Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing']::text[]);

alter table business_partner_requests add column if not exists categories text[] not null default '{}';
alter table business_partner_requests add constraint business_partner_requests_categories_check
  check (categories <@ array['Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour','Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling','Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife','Dating','Speed Dating','Singles Events','Group Hangouts','Reading','Art','Photography','Crafts','Farmers Markets','Thrift & Vintage','Meditation','Spa Day','Self-Care','Family Playdate','Kids Activity','Hiking','Outdoors','Camping','Fishing','Kayaking','Dogs','Cats','Dog Meetup','Networking','Coworking','Volunteering','Faith & Spirituality','Fundraiser','Travel','Day Trip','Weekend Getaway','Staycation','Road Trip','Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup','Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing']::text[]);

-- 3. update_business_profile() -- new trailing categories_param. Adding a
-- parameter changes the signature, so the prior exact 12-arg overload is
-- dropped explicitly first (per CLAUDE.md's documented overload gotcha).
drop function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text, text);

CREATE OR REPLACE FUNCTION public.update_business_profile(partner_id_param uuid, name_param text, description_param text, address_param text, latitude_param double precision, longitude_param double precision, logo_url_param text, category_param text DEFAULT NULL::text, attributes_param text[] DEFAULT NULL::text[], cuisine_param text DEFAULT NULL::text, differentiator_param text DEFAULT NULL::text, subcategory_param text DEFAULT NULL::text, categories_param text[] DEFAULT NULL::text[])
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

  if categories_param is not null and not (categories_param <@ array['Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour','Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling','Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife','Dating','Speed Dating','Singles Events','Group Hangouts','Reading','Art','Photography','Crafts','Farmers Markets','Thrift & Vintage','Meditation','Spa Day','Self-Care','Family Playdate','Kids Activity','Hiking','Outdoors','Camping','Fishing','Kayaking','Dogs','Cats','Dog Meetup','Networking','Coworking','Volunteering','Faith & Spirituality','Fundraiser','Travel','Day Trip','Weekend Getaway','Staycation','Road Trip','Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup','Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing']::text[]) then
    raise exception 'Invalid secondary category';
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
      subcategory = subcategory_param,
      categories = coalesce(categories_param, categories)
  where id = partner_id_param;
end;
$function$;

-- 4. approve_business_partner_request() -- unchanged signature, just
-- carries `categories` through from the request row like every other
-- classification field already does.
CREATE OR REPLACE FUNCTION public.approve_business_partner_request(request_id_param uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req record;
  new_partner_id uuid;
  service_key text;
  matched_profile_id uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_admin = true) then
    raise exception 'Only admins can approve business partner requests';
  end if;

  select * into req from business_partner_requests where id = request_id_param and status = 'pending';
  if req is null then
    raise exception 'Request not found or already reviewed';
  end if;

  insert into brand_partners (name, description, active, category, address, latitude, longitude, attributes, cuisine, priority_occasions, subcategory, categories)
  values (req.business_name, req.business_description, true, req.category, req.address, req.latitude, req.longitude, req.attributes, req.cuisine, req.priority_occasions, req.subcategory, req.categories)
  returning id into new_partner_id;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = new_partner_id where id = req.requester_id;

  update gatherings set hosting_partner_id = new_partner_id where host_id = req.requester_id and hosting_partner_id is null;
  update communities set hosting_partner_id = new_partner_id where creator_id = req.requester_id and hosting_partner_id is null;

  update business_partner_requests
  set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(), resulting_partner_id = new_partner_id
  where id = request_id_param;

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'apply_approved', new_partner_id);

  insert into business_acquisition_events (session_id, user_id, event, partner_id)
  values (gen_random_uuid(), req.requester_id, 'published', new_partner_id);

  if req.source = 'web' and req.applicant_phone is not null then
    select id into matched_profile_id from auth.users where phone = req.applicant_phone limit 1;
    if matched_profile_id is not null then
      perform public._claim_web_business_requests(matched_profile_id);
    end if;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  perform net.http_post(
    url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := jsonb_build_object(
      'recipient_id', req.requester_id,
      'title', 'You''re approved as a partner! 🎉',
      'body', '"' || req.business_name || '" is now live on Nearby. Business Mode is unlocked — tap to get started.',
      'data', jsonb_build_object('type', 'business_partner_approved', 'partner_id', new_partner_id)
    )
  );

  return new_partner_id;
end;
$function$;

-- 5. search_active_business_availability() -- adds `categories` to the
-- returned columns. A RETURNS TABLE column-list change is itself a
-- return-type change, which Postgres refuses to apply via a plain
-- CREATE OR REPLACE (errors "cannot change return type of existing
-- function") -- explicit drop first, same reasoning as #3 above even
-- though the input arguments themselves are unchanged here.
drop function public.search_active_business_availability(text, double precision, double precision, double precision, integer);

CREATE OR REPLACE FUNCTION public.search_active_business_availability(category_param text DEFAULT NULL::text, latitude_param double precision DEFAULT NULL::double precision, longitude_param double precision DEFAULT NULL::double precision, radius_miles_param double precision DEFAULT 15, party_size_param integer DEFAULT NULL::integer)
 RETURNS TABLE(id uuid, partner_id uuid, partner_name text, title text, description text, offer_type text, price numeric, category text, starts_at timestamp with time zone, ends_at timestamp with time zone, distance_miles double precision, attributes text[], cuisine text, remaining_capacity integer, accommodates_party_types text[], priority_occasions text[], subcategory text, categories text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    ba.id, ba.partner_id, p.name as partner_name, ba.title, ba.description,
    ba.offer_type, ba.price, ba.category, ba.starts_at, ba.ends_at,
    case
      when latitude_param is null or longitude_param is null or p.latitude is null or p.longitude is null then null
      else (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
          sin(radians(latitude_param)) * sin(radians(p.latitude))
        ))
      ))
    end as distance_miles,
    p.attributes, p.cuisine, ba.remaining_capacity, p.accommodates_party_types, p.priority_occasions, p.subcategory, p.categories
  from business_availability ba
  join brand_partners p on p.id = ba.partner_id and p.active = true
  where ba.status = 'active'
  and ba.ends_at > now()
  and (ba.remaining_capacity is null or party_size_param is null or ba.remaining_capacity >= party_size_param)
  and (category_param is null or ba.category is null or ba.category = category_param)
  and (
    latitude_param is null or longitude_param is null or p.latitude is null or p.longitude is null
    or (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= least(radius_miles_param, ba.radius_miles)
  )
  order by distance_miles asc nulls last, ba.created_at desc
  limit 30;
$function$;
