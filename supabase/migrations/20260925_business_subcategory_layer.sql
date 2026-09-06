-- Intent engine vision, layer 2 (subcategory) -- first increment
-- (2026-09-06, CLAUDE.md's Active section / memory
-- project_intent_engine_vision). A business's own durable self-
-- classification (brand_partners.category / business_partner_requests
-- .category) has only ever been the coarse 19-value major group key (e.g.
-- 'food_drink') -- there was no way for a business to say "I'm
-- specifically a coffee shop" as part of its own identity, only per-
-- posting (business_availability.category, business_requests.category
-- already use the finer ~75-value leaf-tag vocabulary, since those model
-- one specific ask/offer, not the business's own standing identity).
--
-- Deliberately reuses the SAME leaf-tag vocabulary already living in
-- gatheringCategories.js's CATEGORY_GROUPS[].tags -- no new taxonomy
-- invented. Three majors (home_local_services, auto_transportation,
-- health_personal_care) have zero tags there by direct prior design (see
-- gatheringCategories.js's own comment) and so genuinely have no
-- subcategory to offer yet -- an honest gap, not a bug.
--
-- subcategory is a single nullable value (not multi-classification -- that
-- proposed layer is separate, undecided future work per the same memory
-- note) and, like category itself on this same function, is NOT coalesced
-- on update_business_profile()'s existing non-coalesce contract for that
-- field -- every caller must keep passing its current value forward, same
-- discipline category_param already requires.
alter table public.brand_partners add column if not exists subcategory text;
alter table public.business_partner_requests add column if not exists subcategory text;

alter table public.brand_partners add constraint brand_partners_subcategory_check
  check (subcategory is null or subcategory = any(array[
    'Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour',
    'Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling',
    'Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife',
    'Dating','Speed Dating','Singles Events','Group Hangouts',
    'Reading','Art','Photography','Crafts',
    'Farmers Markets','Thrift & Vintage',
    'Meditation','Spa Day','Self-Care',
    'Family Playdate','Kids Activity',
    'Hiking','Outdoors','Camping','Fishing','Kayaking',
    'Dogs','Cats','Dog Meetup',
    'Networking','Coworking',
    'Volunteering','Faith & Spirituality','Fundraiser',
    'Travel','Day Trip',
    'Weekend Getaway','Staycation','Road Trip',
    'Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup',
    'Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing'
  ]::text[]));

alter table public.business_partner_requests add constraint business_partner_requests_subcategory_check
  check (subcategory is null or subcategory = any(array[
    'Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour',
    'Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling',
    'Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife',
    'Dating','Speed Dating','Singles Events','Group Hangouts',
    'Reading','Art','Photography','Crafts',
    'Farmers Markets','Thrift & Vintage',
    'Meditation','Spa Day','Self-Care',
    'Family Playdate','Kids Activity',
    'Hiking','Outdoors','Camping','Fishing','Kayaking',
    'Dogs','Cats','Dog Meetup',
    'Networking','Coworking',
    'Volunteering','Faith & Spirituality','Fundraiser',
    'Travel','Day Trip',
    'Weekend Getaway','Staycation','Road Trip',
    'Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup',
    'Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing'
  ]::text[]));

-- update_business_profile(): adding a new trailing parameter changes the
-- function's identity signature even though the return type (void) is
-- unchanged -- CREATE OR REPLACE does NOT replace it in place here, it
-- silently creates a second overload alongside the original 11-arg
-- function (confirmed live: this exact migration was first applied
-- without this drop and left both signatures resolvable side by side).
-- The old 11-arg overload must be dropped explicitly first, same
-- "overload, not replace" gotcha this project's own CLAUDE.md already
-- flags for a RETURNS TABLE column-list change -- it turns out to apply
-- to a plain parameter-list change too, not just a return-type change.
-- Every line of the new function body below is byte-for-byte the live
-- version (confirmed via pg_get_functiondef before writing this) except
-- the new trailing subcategory_param, its own validation block, and the
-- one added line in the UPDATE.
drop function if exists public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text);

create or replace function public.update_business_profile(
  partner_id_param uuid, name_param text, description_param text, address_param text,
  latitude_param double precision, longitude_param double precision, logo_url_param text,
  category_param text default null, attributes_param text[] default null, cuisine_param text default null,
  differentiator_param text default null, subcategory_param text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  if attributes_param is not null and not (attributes_param <@ array['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music', 'kid_friendly', 'quiet', 'casual', 'upscale']::text[]) then
    raise exception 'Invalid attribute';
  end if;

  if cuisine_param is not null and cuisine_param not in ('italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'other') then
    raise exception 'Invalid cuisine';
  end if;

  if differentiator_param is not null and char_length(differentiator_param) > 280 then
    raise exception 'Differentiator is too long';
  end if;

  -- Subcategory must genuinely belong to the resulting category's own
  -- real leaf-tag set (gatheringCategories.js's CATEGORY_GROUPS) -- never
  -- allowed to drift onto a different major's vocabulary. category_param
  -- (not the pre-update stored category) is the right thing to validate
  -- against, since this function always overwrites category directly
  -- from category_param, same non-coalesce contract subcategory follows.
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

-- admin_review_business_content_screening(): same "byte-for-byte the live
-- version" discipline, return type (void) unchanged -- only the new
-- subcategory line in the business_profile write branch is added.
create or replace function public.admin_review_business_content_screening(screening_id_param uuid, approve_param boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row business_content_screening_results;
  v_entitlement jsonb;
  v_current_count integer;
  v_lat double precision;
  v_lng double precision;
  v_gathering_scheduled_at timestamptz;
  v_expires_at timestamptz;
  v_duration_hours numeric;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_request_status text;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  service_key text;
begin
  if not check_is_admin(auth.uid()) then
    raise exception 'Only admins can review business content';
  end if;

  select * into v_row from business_content_screening_results where id = screening_id_param for update;
  if v_row.id is null then
    raise exception 'Screening result not found';
  end if;
  if v_row.review_outcome is not null then
    raise exception 'This has already been reviewed';
  end if;

  if v_row.source = 'resweep' then
    update business_content_screening_results
    set review_outcome = case when approve_param then 'approved' else 'denied' end,
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = screening_id_param;
    return;
  end if;

  if approve_param and v_row.target_type = 'business_profile' then
    update brand_partners set
      name = coalesce(v_row.content_snapshot->>'name', name),
      description = v_row.content_snapshot->>'description',
      logo_url = v_row.content_snapshot->>'logoUrl',
      category = v_row.content_snapshot->>'category',
      attributes = coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
        '{}'::text[]
      ),
      cuisine = v_row.content_snapshot->>'cuisine',
      differentiator = v_row.content_snapshot->>'differentiator',
      subcategory = v_row.content_snapshot->>'subcategory'
    where id = v_row.partner_id;
  end if;

  if approve_param and v_row.target_type = 'experience' then
    if v_row.content_snapshot->>'experienceId' is null then
      select check_business_entitlement(v_row.partner_id, 'signature_experiences') into v_entitlement;
      if (v_entitlement ->> 'limit_value') is not null then
        select count(*) into v_current_count from business_experiences where partner_id = v_row.partner_id;
        if v_current_count >= (v_entitlement ->> 'limit_value')::integer then
          raise exception 'ENTITLEMENT_LIMIT:signature_experiences';
        end if;
      end if;

      insert into business_experiences (
        partner_id, title, description, icon, attributes, price_level, party_type, ai_suggested, media_path, media_type
      ) values (
        v_row.partner_id,
        v_row.content_snapshot->>'title',
        v_row.content_snapshot->>'description',
        v_row.content_snapshot->>'icon',
        coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        v_row.content_snapshot->>'priceLevel',
        v_row.content_snapshot->>'partyType',
        false,
        v_row.content_snapshot->>'mediaPath',
        v_row.content_snapshot->>'mediaType'
      );
    else
      update business_experiences set
        title = coalesce(v_row.content_snapshot->>'title', title),
        description = v_row.content_snapshot->>'description',
        icon = v_row.content_snapshot->>'icon',
        attributes = coalesce(
          (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'attributes')),
          '{}'::text[]
        ),
        price_level = v_row.content_snapshot->>'priceLevel',
        party_type = v_row.content_snapshot->>'partyType',
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        ai_suggested = false,
        updated_at = now()
      where id = (v_row.content_snapshot->>'experienceId')::uuid and partner_id = v_row.partner_id;
    end if;
  end if;

  if approve_param and v_row.target_type = 'offer' then
    v_expires_at := null;
    if (v_row.content_snapshot->>'gatheringId') is not null then
      select scheduled_at into v_gathering_scheduled_at from gatherings where id = (v_row.content_snapshot->>'gatheringId')::uuid;
      if v_gathering_scheduled_at is not null then
        v_expires_at := v_gathering_scheduled_at + interval '48 hours';
      end if;
    end if;

    insert into brand_offers (
      partner_id, title, description, reward_type, redemption_instructions, active,
      gathering_id, expires_at, redemption_limit, target_interest_tag,
      unlock_scope, unlock_community_id, unlock_min_members
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      coalesce(v_row.content_snapshot->>'rewardType', 'discount'),
      v_row.content_snapshot->>'redemptionInstructions',
      true,
      nullif(v_row.content_snapshot->>'gatheringId', '')::uuid,
      v_expires_at,
      nullif(v_row.content_snapshot->>'redemptionLimit', '')::integer,
      nullif(v_row.content_snapshot->>'targetInterestTag', ''),
      nullif(v_row.content_snapshot->>'unlockScope', ''),
      nullif(v_row.content_snapshot->>'unlockCommunityId', '')::uuid,
      nullif(v_row.content_snapshot->>'unlockMinMembers', '')::integer
    );
  end if;

  if approve_param and v_row.target_type = 'availability' then
    select latitude, longitude into v_lat, v_lng from brand_partners where id = v_row.partner_id;
    if v_lat is null or v_lng is null then
      raise exception 'This business no longer has an address set -- the availability posting could not be published.';
    end if;

    v_duration_hours := nullif(v_row.content_snapshot->>'durationHours', '')::numeric;
    v_starts_at := now();
    v_ends_at := case
      when v_duration_hours is not null then v_starts_at + (v_duration_hours || ' hours')::interval
      else date_trunc('day', v_starts_at) + interval '1 day' - interval '1 second'
    end;

    insert into business_availability (
      partner_id, category, title, description, offer_type, price,
      capacity, remaining_capacity, starts_at, ends_at, radius_miles
    ) values (
      v_row.partner_id,
      v_row.content_snapshot->>'category',
      v_row.content_snapshot->>'title',
      v_row.content_snapshot->>'description',
      v_row.content_snapshot->>'offerType',
      nullif(v_row.content_snapshot->>'price', '')::numeric,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      nullif(v_row.content_snapshot->>'capacity', '')::integer,
      v_starts_at,
      v_ends_at,
      coalesce(nullif(v_row.content_snapshot->>'radiusMiles', '')::double precision, 15)
    );
  end if;

  if approve_param and v_row.target_type = 'update' then
    insert into business_updates (partner_id, title, body)
    values (v_row.partner_id, v_row.content_snapshot->>'title', v_row.content_snapshot->>'body');
  end if;

  if approve_param and v_row.target_type = 'offer_response' then
    select status, requester_id, raw_text into v_request_status, v_requester_id, v_raw_text
    from business_requests where id = nullif(v_row.content_snapshot->>'requestId', '')::uuid;
    if v_request_status is distinct from 'open' then
      raise exception 'This request is no longer open -- the offer response could not be published.';
    end if;

    update business_request_offers
    set status = 'offered',
        offer_type = v_row.content_snapshot->>'offerType',
        offer_description = v_row.content_snapshot->>'offerDescription',
        offer_price = nullif(v_row.content_snapshot->>'offerPrice', '')::numeric,
        proposed_time = nullif(v_row.content_snapshot->>'proposedTime', '')::timestamptz,
        experience_id = nullif(v_row.content_snapshot->>'experienceId', '')::uuid,
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        responded_at = now()
    where request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid
      and partner_id = v_row.partner_id
      and status = 'pending';

    if not found then
      raise exception 'This offer response could not be published -- it may have expired or already been responded to.';
    end if;

    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select name into v_partner_name from brand_partners where id = v_row.partner_id;
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_requester_id,
        'title', 'New offer for your request!',
        'body', coalesce(v_partner_name, 'A business') || ' responded to "' || left(coalesce(v_raw_text, ''), 60) || '"',
        'data', jsonb_build_object('type', 'business_offer_received', 'request_id', nullif(v_row.content_snapshot->>'requestId', '')::uuid)
      )
    );
  end if;

  update business_content_screening_results
  set review_outcome = case when approve_param then 'approved' else 'denied' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = screening_id_param;
end;
$function$;

-- approve_business_partner_request(): the one other write path that
-- creates a brand_partners row from a business_partner_requests row --
-- without this, an application's own subcategory pick would silently
-- vanish the moment an admin approves it. Return type (uuid) and
-- parameter list are both unchanged, so this really is a safe in-place
-- replace, not the overload trap above. Byte-for-byte the live version
-- (confirmed via pg_get_functiondef before writing this) except
-- req.subcategory added to both the insert's column list and its values.
create or replace function public.approve_business_partner_request(request_id_param uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  insert into brand_partners (name, description, active, category, address, latitude, longitude, attributes, cuisine, priority_occasions, subcategory)
  values (req.business_name, req.business_description, true, req.category, req.address, req.latitude, req.longitude, req.attributes, req.cuisine, req.priority_occasions, req.subcategory)
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

revoke all on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text, text) from public, anon;
grant execute on function public.update_business_profile(uuid, text, text, text, double precision, double precision, text, text, text[], text, text, text) to authenticated;

revoke all on function public.admin_review_business_content_screening(uuid, boolean) from public, anon;
grant execute on function public.admin_review_business_content_screening(uuid, boolean) to authenticated;
