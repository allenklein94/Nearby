-- Idea "394" (owner approved all three fixes, 2026-10-24): a business request never stays open past the time it is for, and a
-- gathering's request follows the gathering's time. Smallest server changes; no new state, screen or push.
--   F1 A gathering's request closes exactly at the gathering's start (the one-hour floor is gone) and none can be created once
--      it has started (hint 'request_time_passed'): create_business_request_for_gathering and the directed route
--      _route_gathering_to_partner_core.
--   F2 Rescheduling a gathering moves its OPEN, still-answerable request with it (day, time, deadline; the request's plan date
--      follows) when no business has replied. Any business response (an offer, automatic reply, decline, withdrawn offer, or a
--      reply held for review) refuses the reschedule (hint 'gathering_request_has_replies'): the host cancels the request first.
--      A booked gathering keeps its time as before (20270343, checked first). Atomic: the move runs inside the gathering's own
--      UPDATE and locks the request and its business rows FOR UPDATE; every path that writes a reply (submit_business_offer,
--      post_business_availability's automatic replies, publishing a held reply) or creates a gathering's request now reads that
--      request / gathering under a share lock (a decline or withdraw already locks its row), so a reply and a reschedule can't
--      interleave: whichever commits first wins, the other sees it.
--      A reopened gathering request takes the gathering's current day/time (it may have moved while the request was closed).
--   F3 A standalone request (create_business_request) with a stated day AND time closes exactly at that time; a time already
--      passed is refused, nothing written (hint 'request_time_passed'). No stated time = the existing rule, unchanged.
--   Also: publishing a held reply refuses past the request's deadline before the hourly sweep, like submit_business_offer.
-- Same signatures (no new overloads); CREATE OR REPLACE keeps existing grants. Rollback:
-- scripts/rollback/20270344_request_deadlines_follow_gathering.rollback.sql.

create or replace function public._request_has_business_reply(request_id_param uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- Idea "394": has any business responded to this request? An offer (incl. automatic replies), a decline, a withdrawn offer,
  -- anything with a response time, or a reply still held for review.
  select exists (
    select 1 from business_request_offers o
    where o.request_id = request_id_param
      and (o.responded_at is not null or o.status in ('offered', 'accepted', 'completed', 'declined', 'withdrawn'))
  ) or exists (
    select 1 from business_content_screening_results s
    where s.target_type = 'offer_response' and s.review_outcome is null
      and s.content_snapshot->>'requestId' = request_id_param::text
  );
$function$;
revoke all on function public._request_has_business_reply(uuid) from public, anon, authenticated;

create or replace function public._gathering_request_follows_time()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_req record;
  v_date date;
  v_time time;
begin
  if date_trunc('milliseconds', new.scheduled_at) is not distinct from date_trunc('milliseconds', old.scheduled_at) then
    return null;
  end if;
  -- Only a request still answerable moves; one past its deadline (before the sweep) stays closed (Reopen is the host's choice).
  for v_req in
    select id from business_requests
    where gathering_id = new.id and status = 'open' and expires_at > now()
    order by id
    for update
  loop
    -- Wait for any reply being written on an existing row (submit, decline, withdraw lock it first); then look.
    perform 1 from business_request_offers where request_id = v_req.id order by id for update;
    if public._request_has_business_reply(v_req.id) then
      raise exception using
        message = 'Businesses have already replied to this gathering''s request, so its time can''t change. To change the time, cancel the request first.',
        hint = 'gathering_request_has_replies';
    end if;
    select local_date, local_time into v_date, v_time from public._gathering_local_when(new.scheduled_at, new.host_id);
    update business_requests
    set date = v_date, time_window_start = v_time, expires_at = least(new.scheduled_at, now() + interval '30 days')
    where id = v_req.id;
  end loop;
  return null;
end;
$function$;
revoke all on function public._gathering_request_follows_time() from public, anon, authenticated;

drop trigger if exists gathering_request_follows_time on public.gatherings;
create trigger gathering_request_follows_time after update of scheduled_at on public.gatherings
  for each row execute function public._gathering_request_follows_time();

-- The request's plan shows the request's day (create_plan_from_business_request copies it at creation); keep it that way.
create or replace function public.sync_plan_date_from_business_request()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.plans set scheduled_at = new.date::timestamptz
  where resulting_business_request_id = new.id and new.parent_request_id is null
    and scheduled_at is distinct from new.date::timestamptz;
  return new;
end;
$function$;
revoke all on function public.sync_plan_date_from_business_request() from public, anon, authenticated;

drop trigger if exists on_business_request_date_sync_plan on public.business_requests;
create trigger on_business_request_date_sync_plan after update of date on public.business_requests
  for each row when (new.date is distinct from old.date) execute function public.sync_plan_date_from_business_request();

CREATE OR REPLACE FUNCTION public.create_business_request_for_gathering(gathering_id_param uuid, raw_text_param text, category_param text DEFAULT NULL::text, budget_max_param integer DEFAULT NULL::integer, radius_miles_param double precision DEFAULT 15, occasion_param text DEFAULT NULL::text, dietary_param text[] DEFAULT NULL::text[], target_partner_id_param uuid DEFAULT NULL::uuid, note_param text DEFAULT NULL::text, date_param date DEFAULT NULL::date, time_start_param time without time zone DEFAULT NULL::time without time zone, items_param text[] DEFAULT NULL::text[])
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

  if items_param is not null and (cardinality(items_param) > 9 or not items_param <@ array['coffee','tea','pastries','cake','sandwiches','appetizers','full_meal','desserts','soft_drinks']::text[]) then
    raise exception 'Invalid requested items';
  end if;

  select host_id, scheduled_at, precise_lat, precise_lng
  into v_host_id, v_scheduled_at, v_lat, v_lng
  from gatherings where id = gathering_id_param
  for share;

  if v_host_id is null then
    raise exception 'Gathering not found.';
  end if;
  if v_host_id <> auth.uid() then
    raise exception 'Only the host can ask businesses on behalf of this gathering.';
  end if;
  if v_lat is null or v_lng is null then
    raise exception 'This gathering has no location set.';
  end if;
  -- Idea "394": nothing can be asked for a gathering that has started (its request would close at once).
  if v_scheduled_at <= now() then
    raise exception using message = 'This gathering has already started.', hint = 'request_time_passed';
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

  -- Idea "394": the request closes exactly at the start, never later (no one-hour floor).
  v_expires_at := least(v_scheduled_at, now() + interval '30 days');

  insert into business_requests (
    requester_id, raw_text, category, party_size, date, time_window_start, latitude, longitude,
    radius_miles, expires_at, gathering_id, occasion, dietary, target_partner_id, note_for_business, attributes, requested_items
  ) values (
    auth.uid(), trim(raw_text_param), category_param, v_party_size,
    v_local_date, v_local_time, v_lat, v_lng, coalesce(radius_miles_param, 15),
    v_expires_at, gathering_id_param, occasion_param, public.normalize_dietary(dietary_param), target_partner_id_param, v_note,
    public._gathering_request_attributes(gathering_id_param),
    coalesce((select array_agg(distinct t order by t) from unnest(items_param) t), '{}')
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

CREATE OR REPLACE FUNCTION public._route_gathering_to_partner_core(gathering_id_param uuid, partner_id_param uuid, notify_param boolean DEFAULT true)
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
  v_local_date date;
  v_local_time time;
begin
  select id, host_id, scheduled_at, precise_lat, precise_lng, interest_tag into v_g
  from gatherings where id = gathering_id_param
  for share;
  if v_g.id is null or v_g.precise_lat is null or v_g.precise_lng is null or v_g.scheduled_at <= now() then
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
    v_expires := least(v_g.scheduled_at, now() + interval '30 days');  -- idea "394": exactly at the start
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
    -- Item 125: the gathering's host asked this one business.
    perform public._emit_event('BUSINESS_REQUEST_SENT', 'business_request_offer', v_offer_id, v_g.host_id, 'route_gathering_to_partner',
      jsonb_build_object('request_id', v_request_id, 'partner_id', partner_id_param, 'offer_id', v_offer_id,
                         'gathering_id', gathering_id_param, 'directed', true),
      'BUSINESS_REQUEST_SENT:' || v_offer_id || ':directed');
  end if;

  return v_request_id;
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
    'book_lovers', 'craft_friendly', 'fitness_focused', 'private_dining', 'corporate_events', 'wifi', 'food_available', 'beginner_friendly', 'reservation_required', 'wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly', 'stroller_friendly', 'family_seating', 'kid_menu', 'pet_friendly', 'romantic', 'catering', 'lively', 'trendy', 'cozy', 'relaxed', 'social', 'professional'
  ]::text[]) then
    raise exception 'Invalid attribute';
  end if;

  if dietary_param is not null and (cardinality(dietary_param) > 8 or not dietary_param <@ array['vegetarian','vegan','gluten_free','dairy_free','nut_allergy','shellfish_allergy','halal','kosher']::text[]) then
    raise exception 'Invalid dietary need';
  end if;

  if items_param is not null and (cardinality(items_param) > 9 or not items_param <@ array['coffee','tea','pastries','cake','sandwiches','appetizers','full_meal','desserts','soft_drinks']::text[]) then
    raise exception 'Invalid requested item';
  end if;

  if cuisine_param is not null and cuisine_param not in ('italian', 'mexican', 'japanese', 'chinese', 'american', 'french', 'mediterranean', 'indian', 'thai', 'seafood', 'bbq', 'korean', 'vietnamese', 'greek', 'other') then
    raise exception 'Invalid cuisine';
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
    -- Idea "384": a chosen posting sent to one business must be THAT business's posting (never bound to another one).
    if preferred_availability_id_param is not null
       and not exists (select 1 from business_availability where id = preferred_availability_id_param and partner_id = target_partner_id_param) then
      raise exception 'That posting is not from this business' using hint = 'posting_mismatch';
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

  -- Idea "394": a stated day + time is the deadline itself (never an extra hour); already passed = nothing is sent.
  -- No stated time (a day alone, or no day) keeps the existing rule.
  if date_param is not null and (time_window_start_param is not null or time_window_end_param is not null) then
    if v_expires_at <= now() then
      raise exception using message = 'That time has already passed.', hint = 'request_time_passed';
    end if;
  elsif v_expires_at < now() + interval '1 hour' then
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
    -- Idea "384": a chosen posting sent to its own business is bound to that request only (its terms, price, capacity), never
    -- broadcast. If it can no longer be bound (ended, full for this party, inactive, out of range, business declines) the whole
    -- request is refused and rolled back: never sent without the posting's terms, never widened to other businesses.
    if preferred_availability_id_param is not null then
      if public._bind_preferred_posting(v_request_id, preferred_availability_id_param, latitude_param, longitude_param,
           coalesce(radius_miles_param, 15), party_size_param) < 0 then
        raise exception 'That posting is no longer available' using hint = 'posting_unavailable';
      end if;
      return jsonb_build_object('requestId', v_request_id, 'notifiedCount', 1, 'targeted', true, 'postingBound', true);
    end if;
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

CREATE OR REPLACE FUNCTION public.submit_business_offer(request_id_param uuid, offer_type_param text, offer_description_param text, offer_price_param numeric DEFAULT NULL::numeric, proposed_time_param timestamp with time zone DEFAULT NULL::timestamp with time zone, experience_id_param uuid DEFAULT NULL::uuid, media_path_param text DEFAULT NULL::text, media_type_param text DEFAULT NULL::text, offer_title_param text DEFAULT NULL::text, included_items_param text[] DEFAULT '{}'::text[], price_is_per_person_param boolean DEFAULT false, discount_pct_param numeric DEFAULT NULL::numeric, redemption_instructions_param text DEFAULT NULL::text, media_poster_path_param text DEFAULT NULL::text, creative_id_param uuid DEFAULT NULL::uuid, valid_until_param timestamp with time zone DEFAULT NULL::timestamp with time zone, available_from_param time without time zone DEFAULT NULL::time without time zone, available_until_param time without time zone DEFAULT NULL::time without time zone, proposed_time_alt_param timestamp with time zone DEFAULT NULL::timestamp with time zone, proposed_party_size_alt_param smallint DEFAULT NULL::smallint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_row record;
  v_request_status text;
  v_request_expires_at timestamptz;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  v_req_category text;
  v_req_gathering uuid;
  v_offer_title text;
  v_creative record;
  v_items text[];
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;

  if media_type_param is not null and media_type_param not in ('image', 'video') then
    raise exception 'Invalid media type';
  end if;

  select status, requester_id, raw_text, expires_at into v_request_status, v_requester_id, v_raw_text, v_request_expires_at
  from business_requests where id = request_id_param
  for share;  -- idea "394": waits for (or blocks) a reschedule moving this request
  if v_request_status is null then
    raise exception 'Request not found.';
  end if;
  if v_request_status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;
  -- The hourly sweep flips status; the deadline itself is authoritative the moment it passes.
  if v_request_expires_at is not null and v_request_expires_at <= now() then
    raise exception 'This request has expired.';
  end if;

  select * into v_row from business_request_offers
  where request_id = request_id_param and partner_id = v_partner_id
  for update;

  if v_row is null then
    raise exception 'This request was not sent to your business.';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'You have already responded to this request.';
  end if;

  if discount_pct_param is not null and (discount_pct_param < 0 or discount_pct_param > 100) then
    raise exception 'Discount percent must be between 0 and 100.';
  end if;

  -- A saved creative REPLACES any media passed: its file and poster come from the library row (already screened).
  if creative_id_param is not null then
    select * into v_creative from business_creatives
     where id = creative_id_param and partner_id = v_partner_id and archived_at is null;
    if not found then raise exception 'That saved creative is not available.'; end if;
    media_path_param := v_creative.media_path;
    media_type_param := v_creative.media_type;
    media_poster_path_param := v_creative.poster_path;
  end if;
  if valid_until_param is not null and (valid_until_param <= now() or valid_until_param > now() + interval '30 days') then
    raise exception 'Pick an end time that is later than now (within 30 days).';
  end if;
  -- "Available 6:00-8:00 PM": the owner's own time-of-day window for when this offer can be used, on the day the visit
  -- is for (the accepted alternative time's day, else the request's date). Both ends or neither; same-day only.
  if (available_from_param is null) <> (available_until_param is null) then
    raise exception 'Set both a start and an end for the available window, or neither.';
  end if;
  if available_from_param is not null and available_until_param <= available_from_param then
    raise exception 'The available window must end after it starts.';
  end if;
  -- Item 119: a second time the customer can choose instead, for the same full party. Both times or one; never the same
  -- time twice; the second one must still be ahead. One reply stays one reply (unique per business per request).
  if proposed_time_alt_param is not null then
    if proposed_time_param is null then
      raise exception 'Pick the first time before adding another.';
    end if;
    if proposed_time_alt_param = proposed_time_param then
      raise exception 'The second time is the same as the first.';
    end if;
    if proposed_time_alt_param <= now() or proposed_time_param <= now() then
      raise exception 'Pick times that are later than now.';
    end if;
  end if;
  -- Item 119b: the second time may be for FEWER people than the request ("4 at 7 PM or 6 at 8:30 PM"); the first time is
  -- always for the whole party, so a smaller time is never the only choice. The trigger checks it against the request.
  if proposed_party_size_alt_param is not null and proposed_time_alt_param is null then
    raise exception 'Add the second time before making it for fewer people.';
  end if;
  if redemption_instructions_param is not null and length(redemption_instructions_param) > 500 then
    raise exception 'Redemption instructions are too long.';
  end if;
  -- A video offer must carry a preview image (the frame Nearby screened); an image offer needs none.
  if media_type_param = 'video' and media_poster_path_param is null then
    raise exception 'A video needs a preview image.';
  end if;
  -- Media must live in this business's own folder of the offer-media bucket.
  if media_path_param is not null and media_path_param not like v_partner_id::text || '/%' then
    raise exception 'Invalid media.';
  end if;
  if media_poster_path_param is not null and media_poster_path_param not like v_partner_id::text || '/%' then
    raise exception 'Invalid media.';
  end if;

  v_offer_title := nullif(trim(coalesce(offer_title_param, '')), '');

  select array_agg(trim(item)) into v_items
  from unnest(coalesce(included_items_param, '{}'::text[])) as item
  where length(trim(item)) > 0;

  update business_request_offers
  set status = 'offered',
      offer_type = offer_type_param,
      offer_description = offer_description_param,
      offer_title = v_offer_title,
      included_items = coalesce(v_items, '{}'),
      offer_price = offer_price_param,
      price_is_per_person = coalesce(price_is_per_person_param, false),
      discount_pct = discount_pct_param,
      proposed_time = proposed_time_param,
      proposed_time_alt = proposed_time_alt_param,
      proposed_party_size_alt = case when proposed_time_alt_param is not null then proposed_party_size_alt_param else null end,
      experience_id = experience_id_param,
      media_path = media_path_param,
      media_type = media_type_param,
      media_poster_path = case when media_type_param = 'video' then media_poster_path_param else null end,
      redemption_instructions = nullif(trim(coalesce(redemption_instructions_param, '')), ''),
      creative_id = creative_id_param,
      valid_until = valid_until_param,
      available_from = available_from_param,
      available_until = available_until_param,
      responded_at = now()
  where id = v_row.id;

  -- Item 125: the reply is an event; the notification layer tells the customer (wording from _business_reply_push).
  perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', v_row.id, auth.uid(), 'submit_business_offer',
    jsonb_build_object('request_id', request_id_param, 'partner_id', v_partner_id, 'offer_id', v_row.id),
    'BUSINESS_OFFER_SENT:' || v_row.id);

  return jsonb_build_object('success', true, 'offerId', v_row.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.post_business_availability(category_param text, title_param text, description_param text, offer_type_param text, price_param numeric, capacity_param integer, starts_at_param timestamp with time zone, ends_at_param timestamp with time zone, radius_miles_param double precision DEFAULT 15, bundle_occasion_param text DEFAULT NULL::text, bundle_components_param text[] DEFAULT NULL::text[], discount_pct_param numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_partner_id uuid;
  v_lat double precision;
  v_lng double precision;
  v_availability_id uuid;
  v_matched_count integer := 0;
  v_matched_people uuid[] := array[]::uuid[];
  v_req record;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  v_bundle_components text[];
begin
  select managed_partner_id into v_partner_id from profiles where id = auth.uid();
  if v_partner_id is null then
    raise exception 'You do not manage a business.';
  end if;
  if title_param is null or length(trim(title_param)) = 0 then
    raise exception 'Give this availability a real title.';
  end if;
  if ends_at_param <= starts_at_param then
    raise exception 'End time must be after the start time.';
  end if;

  if bundle_occasion_param is not null and bundle_occasion_param not in (
    'date_night', 'anniversary', 'birthday', 'celebration', 'family_gathering'
  ) then
    raise exception 'Invalid bundle occasion';
  end if;

  if discount_pct_param is not null and (discount_pct_param < 0 or discount_pct_param > 100) then
    raise exception 'Discount percent must be between 0 and 100.';
  end if;
  if _discount_cap_violation(v_partner_id, offer_type_param, discount_pct_param) is not null then
    raise exception '%', _discount_cap_violation(v_partner_id, offer_type_param, discount_pct_param);
  end if;

  v_bundle_components := coalesce(bundle_components_param, '{}');
  if not (v_bundle_components <@ array[
    'dinner', 'something_to_do', 'finish_the_night',
    'something_fun', 'sweet_treat',
    'food', 'family_fun'
  ]::text[]) then
    raise exception 'Invalid bundle component';
  end if;
  if array_length(v_bundle_components, 1) > 0 and bundle_occasion_param is null then
    raise exception 'A bundle needs an occasion';
  end if;
  -- 20270227: each part must belong to this occasion's bundle (Family Fun only with Family Gathering). A validation error.
  if public._bundle_component_problem(bundle_occasion_param, v_bundle_components) is not null then
    raise exception '%', public._bundle_component_problem(bundle_occasion_param, v_bundle_components);
  end if;

  select latitude, longitude into v_lat, v_lng from brand_partners where id = v_partner_id;
  if v_lat is null or v_lng is null then
    raise exception 'Set your business address before posting availability.';
  end if;

  insert into business_availability (
    partner_id, category, title, description, offer_type, price,
    capacity, remaining_capacity, starts_at, ends_at, radius_miles,
    bundle_occasion, bundle_components, discount_pct
  ) values (
    v_partner_id, category_param, trim(title_param), description_param, offer_type_param, price_param,
    capacity_param, capacity_param, starts_at_param, ends_at_param, coalesce(radius_miles_param, 15),
    bundle_occasion_param, v_bundle_components, discount_pct_param
  ) returning id into v_availability_id;

  for v_req in
    select br.*
    from business_requests br
    where br.status = 'open'
    and br.expires_at > now()
    and (capacity_param is null or br.party_size is null or capacity_param >= br.party_size)
    and (category_param is null or br.category is null or br.category = category_param)
    and (
      br.date is null
      or br.date between starts_at_param::date and ends_at_param::date
    )
    and (
      br.date is null or br.time_window_start is null or br.time_window_end is null
      or (br.date + br.time_window_start, br.date + br.time_window_end) overlaps (starts_at_param, ends_at_param)
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(v_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_lng)) +
        sin(radians(v_lat)) * sin(radians(br.latitude))
      ))
    )) <= least(br.radius_miles, coalesce(radius_miles_param, 15))
    order by br.created_at desc
    limit 10
    for share of br  -- idea "394": a reschedule can't move a request between this match and its reply
  loop
    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (v_req.id, v_partner_id, offer_type_param, coalesce(description_param, title_param), price_param, v_availability_id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      v_matched_count := v_matched_count + 1;
      if not (v_req.requester_id = any(v_matched_people)) then v_matched_people := array_append(v_matched_people, v_req.requester_id); end if;

      if coalesce((select notify_business from profiles where id = v_req.requester_id), true) then
        select occasion_type, who_for_name into v_occ_type, v_occ_who from _occasion_context_for_business_request(v_req.id);

        if v_occ_type is not null then
          v_push_title := _occasion_emoji(v_occ_type) || ' New offer for your ' || _occasion_noun(v_occ_type) || '!';
          v_push_body := trim(title_param) || ' just became available for your ' || lower(_occasion_noun(v_occ_type)) || ' request'
            || case when v_occ_who is not null then ' for ' || v_occ_who else '' end || '.';
        else
          v_push_title := 'New offer for your request!';
          v_push_body := trim(title_param) || ' just became available for "' || left(v_req.raw_text, 60) || '"';
        end if;

        perform public._send_push(v_req.requester_id, v_push_title, v_push_body, jsonb_build_object('type', 'business_offer_received', 'request_id', v_req.id, 'collapse_key', 'offers:' || v_req.id));
      end if;
    end if;
  end loop;

  -- Privacy floor: how many requests matched is a demand figure about unconnected people, so it is returned only when
  -- >= demand_min_people() DISTINCT people are behind it (else null). The offers themselves are sent regardless.
  return jsonb_build_object(
    'availabilityId', v_availability_id,
    'matchedCount', case when coalesce(array_length(v_matched_people, 1), 0) >= public.demand_min_people() then v_matched_count end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_review_business_content_screening(screening_id_param uuid, approve_param boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_request_expires_at timestamptz;
  v_requester_id uuid;
  v_raw_text text;
  v_partner_name text;
  v_occ_type text;
  v_occ_who text;
  v_push_title text;
  v_push_body text;
  v_offer_title text;
  v_items text[];
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
    v_starts_at := coalesce(nullif(v_row.content_snapshot->>'startsAt', '')::timestamptz, now());
    v_ends_at := case
      when nullif(v_row.content_snapshot->>'endsAt', '') is not null then (v_row.content_snapshot->>'endsAt')::timestamptz
      when v_duration_hours is not null then v_starts_at + (v_duration_hours || ' hours')::interval
      else date_trunc('day', v_starts_at) + interval '1 day' - interval '1 second'
    end;
    if v_ends_at <= now() then
      raise exception 'This availability window has already passed -- it could not be published.';
    end if;

    insert into business_availability (
      partner_id, category, title, description, offer_type, price,
      capacity, remaining_capacity, starts_at, ends_at, radius_miles,
      bundle_occasion, bundle_components, discount_pct
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
      coalesce(nullif(v_row.content_snapshot->>'radiusMiles', '')::double precision, 15),
      nullif(v_row.content_snapshot->>'bundleOccasion', ''),
      coalesce(
        (select array_agg(value) from jsonb_array_elements_text(v_row.content_snapshot->'bundleComponents')),
        '{}'::text[]
      ),
      nullif(v_row.content_snapshot->>'discountPct', '')::numeric
    );
  end if;

  if approve_param and v_row.target_type = 'update' then
    insert into business_updates (partner_id, title, body)
    values (v_row.partner_id, v_row.content_snapshot->>'title', v_row.content_snapshot->>'body');
  end if;

  if approve_param and v_row.target_type = 'offer_response' then
    select status, requester_id, raw_text, expires_at into v_request_status, v_requester_id, v_raw_text, v_request_expires_at
    from business_requests where id = nullif(v_row.content_snapshot->>'requestId', '')::uuid
    for share;
    if v_request_status is distinct from 'open' then
      raise exception 'This request is no longer open -- the offer response could not be published.';
    end if;
    -- Idea "394": the deadline is authoritative the moment it passes, before the hourly sweep (as in submit_business_offer).
    if v_request_expires_at is not null and v_request_expires_at <= now() then
      raise exception 'This request has expired -- the offer response could not be published.';
    end if;

    -- Item 119: a held reply's second time must still be ahead when the team publishes it (never dropped silently).
    if nullif(v_row.content_snapshot->>'proposedTimeAlt', '')::timestamptz <= now() then
      raise exception 'This offer''s second time has already passed -- it could not be published.';
    end if;

    if nullif(v_row.content_snapshot->>'validUntil', '')::timestamptz <= now() then
      raise exception 'This offer''s end time has already passed -- it could not be published.';
    end if;
    v_offer_title := nullif(trim(coalesce(v_row.content_snapshot->>'offerTitle', '')), '');

    -- Same trim + blank-filter discipline as submit_business_offer/
    -- create_occasion_package -- never a second, laxer validation rule
    -- for the identical real shape just because it arrived via a
    -- different write path (found live via Test 4 below: an earlier
    -- draft of this branch skipped the filter and let a blank jsonb
    -- array entry survive as a literal empty-string item).
    select array_agg(trim(item)) into v_items
    from jsonb_array_elements_text(coalesce(v_row.content_snapshot->'includedItems', '[]'::jsonb)) as item
    where length(trim(item)) > 0;

    -- 20270289: the team is publishing THIS held item; the offer video gate accepts its (length-checked) media for this
    -- transaction only. Nothing a client can call sets this.
    perform set_config('app.reviewed_offer_media', coalesce(v_row.content_snapshot->>'mediaPath', ''), true);

    update business_request_offers
    set status = 'offered',
        offer_type = v_row.content_snapshot->>'offerType',
        offer_description = v_row.content_snapshot->>'offerDescription',
        offer_title = v_offer_title,
        included_items = coalesce(v_items, '{}'::text[]),
        offer_price = nullif(v_row.content_snapshot->>'offerPrice', '')::numeric,
        price_is_per_person = coalesce((v_row.content_snapshot->>'priceIsPerPerson')::boolean, false),
        discount_pct = nullif(v_row.content_snapshot->>'discountPct', '')::numeric,
        proposed_time = nullif(v_row.content_snapshot->>'proposedTime', '')::timestamptz,
        proposed_time_alt = nullif(v_row.content_snapshot->>'proposedTimeAlt', '')::timestamptz,
        proposed_party_size_alt = case when nullif(v_row.content_snapshot->>'proposedTimeAlt', '') is not null
          then nullif(v_row.content_snapshot->>'proposedPartySizeAlt', '')::smallint else null end,
        experience_id = nullif(v_row.content_snapshot->>'experienceId', '')::uuid,
        media_path = v_row.content_snapshot->>'mediaPath',
        media_type = v_row.content_snapshot->>'mediaType',
        media_poster_path = case when v_row.content_snapshot->>'mediaType' = 'video' then nullif(v_row.content_snapshot->>'posterPath', '') else null end,
        redemption_instructions = nullif(trim(coalesce(v_row.content_snapshot->>'redemptionInstructions', '')), ''),
        creative_id = nullif(v_row.content_snapshot->>'creativeId', '')::uuid,
        valid_until = nullif(v_row.content_snapshot->>'validUntil', '')::timestamptz,
        available_from = nullif(v_row.content_snapshot->>'availableFrom', '')::time,
        available_until = nullif(v_row.content_snapshot->>'availableUntil', '')::time,
        responded_at = now()
    where request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid
      and partner_id = v_row.partner_id
      and status = 'pending';

    perform set_config('app.reviewed_offer_media', '', true);

    if not found then
      raise exception 'This offer response could not be published -- it may have expired or already been responded to.';
    end if;

    -- Item 125: the same BUSINESS_OFFER_SENT event as a direct reply.
    perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', o.id, null,
      'admin_review_business_content_screening',
      jsonb_build_object('request_id', o.request_id, 'partner_id', o.partner_id, 'offer_id', o.id),
      'BUSINESS_OFFER_SENT:' || o.id)
    from business_request_offers o
    where o.request_id = nullif(v_row.content_snapshot->>'requestId', '')::uuid and o.partner_id = v_row.partner_id;
  end if;

  update business_content_screening_results
  set review_outcome = case when approve_param then 'approved' else 'denied' end,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = screening_id_param;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reopen_business_request(request_id_param uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req record;
  v_expiry timestamptz;
  v_date date;
  v_time time;
begin
  select * into v_req from business_requests where id = request_id_param for update;
  if not found or v_req.requester_id is distinct from auth.uid() then
    raise exception 'Request not found.';
  end if;
  if v_req.status = 'open' and v_req.expires_at > now() then
    return jsonb_build_object('reopened', false, 'reason', 'already_open');
  end if;
  if v_req.status not in ('expired', 'open') then
    raise exception 'This request can no longer be reopened.';
  end if;
  v_expiry := coalesce(
    public._business_request_expiry(v_req.requester_id, v_req.date, v_req.time_window_start, v_req.time_window_end),
    now() + interval '48 hours');
  v_date := v_req.date;
  v_time := v_req.time_window_start;
  if v_req.gathering_id is not null then
    select least(scheduled_at, now() + interval '30 days') into v_expiry from gatherings where id = v_req.gathering_id for share;
    -- Idea "394": the reopened ask is for the gathering as it is now (it may have moved while the request was closed).
    select w.local_date, w.local_time into v_date, v_time
    from gatherings g, public._gathering_local_when(g.scheduled_at, g.host_id) w where g.id = v_req.gathering_id;
  end if;
  if v_expiry is null or v_expiry <= now() then
    raise exception 'The time for this request has passed. Start a new one with a new time.';
  end if;

  update business_requests set status = 'open', expires_at = v_expiry, date = v_date, time_window_start = v_time where id = request_id_param;
  update business_request_offers set status = 'pending'
  where request_id = request_id_param and status = 'expired' and responded_at is null;
  return jsonb_build_object('reopened', true, 'expiresAt', v_expiry);
end;
$function$;
