-- Item 80 ("Make it special" -- CLAUDE.md): after a user has a primary
-- business relationship going for an occasion (a restaurant reservation
-- for a birthday, say), let them optionally add real, independent
-- business engagements on top of it -- flowers, a photographer,
-- transportation, decorations, dessert, a gift -- without turning it into
-- a second, parallel business-request system.
--
-- Core model, exactly per the locked spec: ONE primary business_requests
-- row, zero or more "add-on" business_requests rows that point back at
-- it, each running through the exact same request -> fanout -> offer ->
-- accept/decline -> reservation lifecycle every other business_requests
-- row already uses. An add-on declining does not touch the primary, and
-- vice versa -- there is no shared state to invalidate, because there is
-- no new state machine here at all, just a self-reference on the existing
-- table plus two small, surgical extensions to already-existing functions.
--
-- Taxonomy: 3 new leaf tags (Florist, Party & Event Decor, Gift Shop)
-- fill the 3 real gaps in the existing 75-tag CATEGORY_GROUPS vocabulary
-- (gatheringCategories.js) that a Flowers/Decorations/Gift add-on needs to
-- classify a business by; Photographer and Dessert both already have a
-- perfect home in the existing vocabulary (Photography, Bakeries) and
-- need nothing new. Transportation has no leaf tag by design (matches
-- the existing auto_transportation MAJOR only, same as every other
-- major-only category) -- deliberately not fabricated, mirrors this
-- schema's own precedent for home_local_services/health_personal_care.
-- These 3 new tags are additive to the one shared flat CHECK list used
-- across 7 constraints (confirmed via a live search for every constraint
-- referencing this exact array before writing this migration) -- widened
-- together so nothing drifts, per this repo's own "one ontology"
-- discipline.

alter table brand_partners drop constraint brand_partners_categories_check;
alter table brand_partners add constraint brand_partners_categories_check
  check (categories <@ array[
    'Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour',
    'Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling',
    'Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife',
    'Dating','Speed Dating','Singles Events','Group Hangouts',
    'Reading','Art','Photography','Crafts',
    'Farmers Markets','Thrift & Vintage','Florist','Party & Event Decor','Gift Shop',
    'Meditation','Spa Day','Self-Care',
    'Family Playdate','Kids Activity',
    'Hiking','Outdoors','Camping','Fishing','Kayaking',
    'Dogs','Cats','Dog Meetup',
    'Networking','Coworking',
    'Volunteering','Faith & Spirituality','Fundraiser',
    'Travel','Day Trip','Weekend Getaway','Staycation','Road Trip',
    'Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup',
    'Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing'
  ]::text[]);

alter table brand_partners drop constraint brand_partners_subcategory_check;
alter table brand_partners add constraint brand_partners_subcategory_check
  check (subcategory is null or subcategory = any(array[
    'Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour',
    'Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling',
    'Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife',
    'Dating','Speed Dating','Singles Events','Group Hangouts',
    'Reading','Art','Photography','Crafts',
    'Farmers Markets','Thrift & Vintage','Florist','Party & Event Decor','Gift Shop',
    'Meditation','Spa Day','Self-Care',
    'Family Playdate','Kids Activity',
    'Hiking','Outdoors','Camping','Fishing','Kayaking',
    'Dogs','Cats','Dog Meetup',
    'Networking','Coworking',
    'Volunteering','Faith & Spirituality','Fundraiser',
    'Travel','Day Trip','Weekend Getaway','Staycation','Road Trip',
    'Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup',
    'Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing'
  ]::text[]));

alter table business_partner_requests drop constraint business_partner_requests_categories_check;
alter table business_partner_requests add constraint business_partner_requests_categories_check
  check (categories <@ array[
    'Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour',
    'Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling',
    'Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife',
    'Dating','Speed Dating','Singles Events','Group Hangouts',
    'Reading','Art','Photography','Crafts',
    'Farmers Markets','Thrift & Vintage','Florist','Party & Event Decor','Gift Shop',
    'Meditation','Spa Day','Self-Care',
    'Family Playdate','Kids Activity',
    'Hiking','Outdoors','Camping','Fishing','Kayaking',
    'Dogs','Cats','Dog Meetup',
    'Networking','Coworking',
    'Volunteering','Faith & Spirituality','Fundraiser',
    'Travel','Day Trip','Weekend Getaway','Staycation','Road Trip',
    'Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup',
    'Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing'
  ]::text[]);

alter table business_partner_requests drop constraint business_partner_requests_subcategory_check;
alter table business_partner_requests add constraint business_partner_requests_subcategory_check
  check (subcategory is null or subcategory = any(array[
    'Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour',
    'Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling',
    'Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife',
    'Dating','Speed Dating','Singles Events','Group Hangouts',
    'Reading','Art','Photography','Crafts',
    'Farmers Markets','Thrift & Vintage','Florist','Party & Event Decor','Gift Shop',
    'Meditation','Spa Day','Self-Care',
    'Family Playdate','Kids Activity',
    'Hiking','Outdoors','Camping','Fishing','Kayaking',
    'Dogs','Cats','Dog Meetup',
    'Networking','Coworking',
    'Volunteering','Faith & Spirituality','Fundraiser',
    'Travel','Day Trip','Weekend Getaway','Staycation','Road Trip',
    'Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup',
    'Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing'
  ]::text[]));

alter table business_requests drop constraint business_requests_category_check;
alter table business_requests add constraint business_requests_category_check
  check (category is null or category = any(array[
    'Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour',
    'Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling',
    'Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife',
    'Dating','Speed Dating','Singles Events','Group Hangouts',
    'Reading','Art','Photography','Crafts',
    'Farmers Markets','Thrift & Vintage','Florist','Party & Event Decor','Gift Shop',
    'Meditation','Spa Day','Self-Care',
    'Family Playdate','Kids Activity',
    'Hiking','Outdoors','Camping','Fishing','Kayaking',
    'Dogs','Cats','Dog Meetup',
    'Networking','Coworking',
    'Volunteering','Faith & Spirituality','Fundraiser',
    'Travel','Day Trip','Weekend Getaway','Staycation','Road Trip',
    'Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup',
    'Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing'
  ]::text[]));

alter table business_availability drop constraint business_availability_category_check;
alter table business_availability add constraint business_availability_category_check
  check (category is null or category = any(array[
    'Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour',
    'Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling',
    'Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife',
    'Dating','Speed Dating','Singles Events','Group Hangouts',
    'Reading','Art','Photography','Crafts',
    'Farmers Markets','Thrift & Vintage','Florist','Party & Event Decor','Gift Shop',
    'Meditation','Spa Day','Self-Care',
    'Family Playdate','Kids Activity',
    'Hiking','Outdoors','Camping','Fishing','Kayaking',
    'Dogs','Cats','Dog Meetup',
    'Networking','Coworking',
    'Volunteering','Faith & Spirituality','Fundraiser',
    'Travel','Day Trip','Weekend Getaway','Staycation','Road Trip',
    'Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup',
    'Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing'
  ]::text[]));

alter table business_priority_signals drop constraint business_priority_signals_category_check;
alter table business_priority_signals add constraint business_priority_signals_category_check
  check (category is null or category = any(array[
    'Coffee','Foodie','Cooking','Wine','Brunch','Bakeries','Bars & Lounges','Breweries','Food Trucks','Happy Hour',
    'Fitness','Yoga','Sports','Running','Pickleball','Tennis','Cycling','Swimming','Climbing','Golf','Bowling',
    'Music','Movies','Gaming','Dancing','Concerts','Karaoke','Comedy','Trivia','Nightlife',
    'Dating','Speed Dating','Singles Events','Group Hangouts',
    'Reading','Art','Photography','Crafts',
    'Farmers Markets','Thrift & Vintage','Florist','Party & Event Decor','Gift Shop',
    'Meditation','Spa Day','Self-Care',
    'Family Playdate','Kids Activity',
    'Hiking','Outdoors','Camping','Fishing','Kayaking',
    'Dogs','Cats','Dog Meetup',
    'Networking','Coworking',
    'Volunteering','Faith & Spirituality','Fundraiser',
    'Travel','Day Trip','Weekend Getaway','Staycation','Road Trip',
    'Workshops','Lectures','Cooking Class','Study Group','Language Exchange','Tech Meetup',
    'Museums','Zoos','Aquariums','Landmarks','Amusement Park','Sightseeing'
  ]::text[]));

-- ---------------------------------------------------------------------
-- Schema: business_requests gains a self-reference. An add-on IS a
-- business_requests row -- same table, same lifecycle, same RLS, same
-- offer/accept/decline/reservation machinery -- distinguished only by
-- carrying a pointer back to the primary request it enhances plus a
-- fixed add-on type. The both-or-neither CHECK keeps "primary" and
-- "add-on" mutually exclusive and always paired at the data level, not
-- just by convention in application code.
-- ---------------------------------------------------------------------

alter table business_requests add column parent_request_id uuid references business_requests(id) on delete set null;
alter table business_requests add column addon_type text;
alter table business_requests add constraint business_requests_addon_type_check
  check (addon_type is null or addon_type in ('dessert', 'flowers', 'photographer', 'decorations', 'transportation', 'gift'));
alter table business_requests add constraint business_requests_addon_pairing_check
  check ((parent_request_id is null) = (addon_type is null));

create index idx_business_requests_parent_request_id on business_requests(parent_request_id) where parent_request_id is not null;

-- ---------------------------------------------------------------------
-- An add-on must never spawn its own separate `plans` row -- it belongs
-- to the primary request's own plan. This is the one guard that keeps
-- "one occasion, one plan, multiple optional business engagements" real
-- at the data level instead of just a UI convention: without it, every
-- add-on would silently create a second, redundant Plans-tab entry.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_plan_from_business_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.parent_request_id is null then
    insert into public.plans (
      plan_type, created_by, title, scheduled_at, location_lat, location_lng,
      party_size, budget_max, status, resulting_business_request_id
    ) values (
      'business_request', new.requester_id, coalesce(new.raw_text, new.category),
      new.date::timestamptz, new.latitude, new.longitude,
      new.party_size, new.budget_max, 'draft', new.id
    );
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------
-- _business_request_fanout generalized (not duplicated) with two new,
-- optional trailing filters. Every existing caller (create_business_
-- request) keeps passing exactly 4 positional args and gets byte-
-- identical behavior -- both filters default to null, which is a
-- structural no-op in the WHERE clause below. Add-on requests are the
-- first caller to ever pass a real filter, so a "Flowers" add-on
-- broadcasts only to real florist-classified partners (or, for
-- Transportation, real auto_transportation-major partners) instead of
-- blasting every nearby business regardless of fit -- the general ask
-- flow's own "any business could help" broadcast semantics are
-- deliberately untouched for every other caller.
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS public._business_request_fanout(uuid, double precision, double precision, double precision);

CREATE FUNCTION public._business_request_fanout(
  request_id_param uuid,
  latitude_param double precision,
  longitude_param double precision,
  radius_miles_param double precision,
  category_filter_param text[] DEFAULT NULL,
  business_major_filter_param text DEFAULT NULL
)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_notified_count integer := 0;
  v_raw_text text;
  v_req_attributes text[];
  v_req_cuisine text;
  service_key text;
  v_row record;
  v_managing_profiles uuid[];
  i integer;
begin
  select raw_text, attributes, cuisine into v_raw_text, v_req_attributes, v_req_cuisine from business_requests where id = request_id_param;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_row in
    with eligible as (
      select p.id, p.attributes, p.cuisine, (3958.8 * acos(
        least(1.0, greatest(-1.0,
          cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
          sin(radians(latitude_param)) * sin(radians(p.latitude))
        ))
      )) as distance_miles
      from brand_partners p
      where p.active = true
      and p.latitude is not null
      and p.longitude is not null
      and (category_filter_param is null or p.subcategory = any(category_filter_param) or p.categories && category_filter_param)
      and (business_major_filter_param is null or p.category = business_major_filter_param)
    ),
    reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    insert into business_request_offers (request_id, partner_id)
    select request_id_param, e.id
    from eligible e
    left join reputation r on r.partner_id = e.id
    where e.distance_miles <= radius_miles_param
    order by
      (cardinality(array(select unnest(coalesce(e.attributes, '{}')) intersect select unnest(coalesce(v_req_attributes, '{}'))))
        + (case when v_req_cuisine is not null and e.cuisine = v_req_cuisine then 1 else 0 end)) desc,
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      e.distance_miles asc
    limit 10
    returning partner_id
  loop
    v_notified_count := v_notified_count + 1;

    select array_agg(id) into v_managing_profiles from profiles where managed_partner_id = v_row.partner_id;
    if v_managing_profiles is not null then
      for i in 1 .. array_length(v_managing_profiles, 1) loop
        continue when not coalesce((select notify_business from profiles where id = v_managing_profiles[i]), true);
        perform net.http_post(
          url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
          headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
          body := jsonb_build_object(
            'recipient_id', v_managing_profiles[i],
            'title', 'New opportunity nearby!',
            'body', 'A customer is asking for: "' || left(coalesce(v_raw_text, ''), 60) || '"',
            'data', jsonb_build_object('type', 'business_opportunity_received', 'request_id', request_id_param)
          )
        );
      end loop;
    end if;
  end loop;

  return v_notified_count;
end;
$function$;

-- ---------------------------------------------------------------------
-- The one new consumer-facing RPC. Deliberately does NOT re-collect
-- location/date/time/party size from the caller -- all inherited from
-- the parent request, since an add-on is enhancing an already-described
-- occasion, not starting a new one. Privacy: raw_text is generated here,
-- server-side, from the occasion type only -- never the parent's own
-- free-text raw_text (which may carry a celebrated person's name),
-- mirroring composeCelebrationAskTextForBusiness's own convention
-- (Item 69, CLAUDE.md).
--
-- Matching is deliberately narrower than the general create_business_
-- request path: _match_request_to_policy (no category awareness at all)
-- and _match_request_to_package (occasion-only, meant for the PRIMARY
-- experience) are both skipped entirely here -- calling either would
-- surface an unrelated business's generic policy or an occasion package
-- as if it were a "Flowers" match. Only the (now category-aware) fanout
-- and category-scoped availability/AI-auto-respond matchers run, and
-- only when a real leaf category exists for this add-on type
-- (Transportation has none by design -- major-only fanout is its only
-- matching path, exactly mirroring auto_transportation's existing
-- zero-leaf-tag precedent elsewhere in this schema).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_plan_addon_request(
  parent_request_id_param uuid,
  addon_type_param text,
  note_param text DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_parent record;
  v_category text;
  v_business_major text;
  v_label text;
  v_request_id uuid;
  v_expires_at timestamptz;
  v_raw_text text;
  v_existing_open_id uuid;
  v_notified_count integer := 0;
  v_avail_new_count integer := 0;
  v_ai_new_count integer := 0;
begin
  if addon_type_param is null or addon_type_param not in ('dessert', 'flowers', 'photographer', 'decorations', 'transportation', 'gift') then
    raise exception 'Invalid add-on type';
  end if;

  select * into v_parent from business_requests
    where id = parent_request_id_param and requester_id = auth.uid()
    for update;
  if not found then
    raise exception 'Request not found.';
  end if;
  if v_parent.parent_request_id is not null then
    raise exception 'Add-ons cannot themselves have add-ons.';
  end if;
  if v_parent.status = 'cancelled' then
    raise exception 'This plan was cancelled -- add-ons cannot be added to a cancelled request.';
  end if;

  select id into v_existing_open_id from business_requests
    where parent_request_id = parent_request_id_param
    and addon_type = addon_type_param
    and status = 'open'
    limit 1;
  if v_existing_open_id is not null then
    raise exception 'You already have an open % request for this plan.', addon_type_param;
  end if;

  v_category := case addon_type_param
    when 'dessert' then 'Bakeries'
    when 'flowers' then 'Florist'
    when 'photographer' then 'Photography'
    when 'decorations' then 'Party & Event Decor'
    when 'gift' then 'Gift Shop'
    else null
  end;
  v_business_major := case addon_type_param
    when 'dessert' then 'food_drink'
    when 'flowers' then 'shopping'
    when 'photographer' then 'arts_culture_learning'
    when 'decorations' then 'shopping'
    when 'gift' then 'shopping'
    when 'transportation' then 'auto_transportation'
  end;
  v_label := case addon_type_param
    when 'dessert' then 'Dessert'
    when 'flowers' then 'Flowers'
    when 'photographer' then 'Photographer'
    when 'decorations' then 'Decorations'
    when 'transportation' then 'Transportation'
    when 'gift' then 'Gift'
  end;

  v_raw_text := v_label || case when v_parent.occasion is not null and v_parent.occasion <> 'other'
    then ' for a ' || replace(v_parent.occasion, '_', ' ') || ' celebration'
    else ' to go with an upcoming plan' end
    || case when note_param is not null and length(trim(note_param)) > 0
      then ' — ' || left(trim(note_param), 200) else '' end;

  v_expires_at := coalesce(v_parent.expires_at, now() + interval '48 hours');
  if v_expires_at < now() + interval '1 hour' then
    v_expires_at := now() + interval '1 hour';
  end if;

  insert into business_requests (
    requester_id, raw_text, category, party_size, date, time_window_start,
    time_window_end, latitude, longitude, radius_miles, expires_at, occasion,
    parent_request_id, addon_type
  ) values (
    auth.uid(), v_raw_text, v_category, v_parent.party_size, v_parent.date,
    v_parent.time_window_start, v_parent.time_window_end, v_parent.latitude,
    v_parent.longitude, v_parent.radius_miles, v_expires_at, v_parent.occasion,
    parent_request_id_param, addon_type_param
  ) returning id into v_request_id;

  select public._business_request_fanout(
    v_request_id, v_parent.latitude, v_parent.longitude, v_parent.radius_miles,
    case when v_category is not null then array[v_category] else null end,
    case when v_category is null then v_business_major else null end
  ) into v_notified_count;

  if v_category is not null then
    select public._match_request_to_availability(v_request_id, v_parent.latitude, v_parent.longitude, v_parent.radius_miles, v_category, v_parent.date, v_parent.time_window_start, v_parent.time_window_end, null, v_parent.party_size) into v_avail_new_count;
    select public._ai_auto_respond_to_business_requests(v_request_id, v_parent.latitude, v_parent.longitude, v_parent.radius_miles, v_category, v_parent.party_size, v_parent.time_window_start, v_parent.time_window_end) into v_ai_new_count;
  end if;

  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_ai_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'addonType', addon_type_param, 'category', v_category, 'notifiedCount', v_notified_count);
end;
$function$;

REVOKE ALL ON FUNCTION public.create_plan_addon_request(uuid, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_plan_addon_request(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------
-- get_business_opportunities (Item 69): add addon_type/is_addon to the
-- already-fixed jsonb column list so a business can tell "this is a
-- Flowers add-on to someone's bigger plan" apart from a standalone ask --
-- same privacy boundary as everything else this function already
-- returns (no requester identity, no parent request's own raw_text).
-- Plain CREATE OR REPLACE on an unchanged jsonb-returning signature --
-- no overload risk (confirmed: RETURNS jsonb, not RETURNS TABLE).
-- ---------------------------------------------------------------------

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
      bro.id, bro.request_id, bro.partner_id, bro.offer_type, bro.offer_price,
      bro.offer_description, bro.proposed_time, bro.created_at, bro.expires_at,
      bro.responded_at, bro.accepted_at, bro.completed_at, bro.status,
      bro.availability_id, bro.viewed_at, bro.decline_reason, bro.decline_note,
      bro.experience_id, bro.media_path, bro.media_type, bro.cancelled_at, bro.package_id,
      jsonb_build_object(
        'raw_text', br.raw_text,
        'category', br.category,
        'party_size', br.party_size,
        'budget_min', br.budget_min,
        'budget_max', br.budget_max,
        'date', br.date,
        'time_window_start', br.time_window_start,
        'time_window_end', br.time_window_end,
        'status', br.status,
        'expires_at', br.expires_at,
        'gathering_id', br.gathering_id,
        'match_id', br.match_id,
        'attributes', br.attributes,
        'cuisine', br.cuisine,
        'occasion', br.occasion,
        'addon_type', br.addon_type,
        'is_addon', br.parent_request_id is not null,
        'gatherings', case when g.id is not null then jsonb_build_object(
          'interest_tag', g.interest_tag,
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
$function$;
