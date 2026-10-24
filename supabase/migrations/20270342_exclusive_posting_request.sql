-- Idea "384" follow-up (owner approved 2026-10-24): a deliberately chosen business posting ("Book with {name}") reaches ONLY that
-- business and keeps the posting's terms. Before: create_business_request with a target returned before any matcher, so the posting
-- was never bound; without a target a chosen posting still fanned out to every eligible nearby business.
--   1. _bind_preferred_posting: the matcher's preferred-posting branch moved verbatim into ONE helper (same checks, same upsert, same
--      BUSINESS_OFFER_SENT event); _match_request_to_availability_core now calls it (broadcast behaviour unchanged).
--   2. create_business_request, targeted branch: the posting must belong to the target (else 'posting_mismatch', before any write);
--      after routing to the target, the posting is bound via the helper; if it can't be, the call raises 'posting_unavailable' and the
--      request is rolled back (never sent without its terms, never broadcast). notifiedCount stays 1.
-- Same signatures (no new overloads); existing grants kept by CREATE OR REPLACE. Booking unchanged: the customer still accepts the
-- posting's offer ("I'll take this one"); capacity is taken at acceptance by _take_availability_capacity (20270308).

create or replace function public._bind_preferred_posting(request_id_param uuid, preferred_availability_id_param uuid,
  latitude_param double precision, longitude_param double precision, radius_miles_param double precision, party_size_param integer)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
-- Binds the ONE posting a person chose to their request: that business's row becomes 'offered' with the posting's terms
-- (offer_type, description, price, availability_id), so accepting it takes the posting's capacity (_take_availability_capacity).
-- Checks unchanged from the matcher's preferred branch (moved here verbatim, idea "384"): business active, not declining, min
-- spend met, posting active and not ended, room for the party, within the radius. Returns -1 = not bound (ineligible, or the
-- business's row is no longer pending), 0 = bound onto an existing pending row (e.g. the directed row), 1 = bound as a new row.
declare
  v_preferred record;
  v_already_offered boolean;
  v_result integer := -1;
begin
  select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
  into v_preferred
  from business_availability ba
  join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
  where ba.id = preferred_availability_id_param
  and ba.status = 'active'
  and ba.ends_at > now()
  and (ba.remaining_capacity is null or party_size_param is null or ba.remaining_capacity >= party_size_param)
  and p.latitude is not null and p.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
      sin(radians(latitude_param)) * sin(radians(p.latitude))
    ))
  )) <= radius_miles_param;

  if found then
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_preferred.partner_id
    ) into v_already_offered;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (request_id_param, v_preferred.partner_id, v_preferred.offer_type, coalesce(v_preferred.description, v_preferred.title), v_preferred.price, v_preferred.id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      v_result := case when v_already_offered then 0 else 1 end;

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_preferred.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'match_availability',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_preferred.partner_id, 'availability_id', v_preferred.id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_preferred.partner_id));
    end if;
  end if;
  return v_result;
end;
$function$;
revoke all on function public._bind_preferred_posting(uuid, uuid, double precision, double precision, double precision, integer) from public, anon, authenticated;
grant execute on function public._bind_preferred_posting(uuid, uuid, double precision, double precision, double precision, integer) to service_role;

CREATE OR REPLACE FUNCTION public._match_request_to_availability_core(request_id_param uuid, latitude_param double precision, longitude_param double precision, radius_miles_param double precision, category_param text, date_param date, time_window_start_param time without time zone, time_window_end_param time without time zone, preferred_availability_id_param uuid DEFAULT NULL::uuid, party_size_param integer DEFAULT NULL::integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_new_count integer := 0;
  v_raw_text text;
  v_avail record;
  v_preferred record;
  v_already_offered boolean;
  v_managing_profiles uuid[];
  i integer;
  v_bound integer;
begin
  select raw_text into v_raw_text from business_requests where id = request_id_param;

  -- Idea "384" (2026-10-24): the chosen posting is bound by ONE helper, shared with the exclusive (targeted) path.
  if preferred_availability_id_param is not null then
    v_bound := public._bind_preferred_posting(request_id_param, preferred_availability_id_param, latitude_param, longitude_param, radius_miles_param, party_size_param);
    if v_bound > 0 then
      v_new_count := v_new_count + v_bound;
    end if;
  end if;

  for v_avail in
    with reputation as (
      select
        partner_id,
        count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers
      group by partner_id
    )
    select ba.*, p.latitude as partner_lat, p.longitude as partner_lng
    from business_availability ba
    join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
    left join reputation r on r.partner_id = ba.partner_id
    where ba.status = 'active'
    and ba.ends_at > now()
    and (ba.remaining_capacity is null or party_size_param is null or ba.remaining_capacity >= party_size_param)
    and (preferred_availability_id_param is null or ba.id != preferred_availability_id_param)
    and (category_param is null or ba.category is null or ba.category = category_param)
    and p.latitude is not null and p.longitude is not null
    and (
      date_param is null
      or date_param between ba.starts_at::date and ba.ends_at::date
    )
    and (
      date_param is null or time_window_start_param is null or time_window_end_param is null
      or (date_param + time_window_start_param, date_param + time_window_end_param)
         overlaps (ba.starts_at, ba.ends_at)
    )
    and (3958.8 * acos(
      least(1.0, greatest(-1.0,
        cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
        sin(radians(latitude_param)) * sin(radians(p.latitude))
      ))
    )) <= least(radius_miles_param, ba.radius_miles)
    order by
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      ba.created_at desc
    limit 5
  loop
    select exists(
      select 1 from business_request_offers
      where request_id = request_id_param and partner_id = v_avail.partner_id
    ) into v_already_offered;

    insert into business_request_offers (request_id, partner_id, offer_type, offer_description, offer_price, availability_id, status, responded_at)
    values (request_id_param, v_avail.partner_id, v_avail.offer_type, coalesce(v_avail.description, v_avail.title), v_avail.price, v_avail.id, 'offered', now())
    on conflict (request_id, partner_id) do update
      set status = 'offered', offer_type = excluded.offer_type, offer_description = excluded.offer_description,
          offer_price = excluded.offer_price, availability_id = excluded.availability_id, responded_at = now()
      where business_request_offers.status = 'pending';

    if found then
      if not v_already_offered then
        v_new_count := v_new_count + 1;
      end if;

      perform public._emit_event('BUSINESS_OFFER_SENT', 'business_request_offer', (select id from business_request_offers where request_id = request_id_param and partner_id = v_avail.partner_id),
        (select requester_id from business_requests where id = request_id_param), 'match_availability',
        jsonb_build_object('request_id', request_id_param, 'partner_id', v_avail.partner_id, 'availability_id', v_avail.id),
        'BUSINESS_OFFER_SENT:' || (select id from business_request_offers where request_id = request_id_param and partner_id = v_avail.partner_id));
    end if;
  end loop;

  -- Missed-match instrumentation (Phase 4). Priority order, now with the
  -- real party-size feasibility case inserted between the two existing
  -- capacity-adjacent reasons: an explicit category mismatch is still the
  -- most legible reason; then zero remaining capacity; then a real but
  -- insufficient remaining capacity for the requester's own party size;
  -- then, by elimination, a date/time overlap failure.
  insert into business_match_exclusions (request_id, partner_id, source, reason, availability_id)
  select
    request_id_param,
    ba.partner_id,
    'availability',
    case
      when category_param is not null and ba.category is not null and ba.category <> category_param then 'category_mismatch'
      when not (ba.remaining_capacity is null or ba.remaining_capacity > 0) then 'zero_capacity'
      when party_size_param is not null and ba.remaining_capacity is not null and ba.remaining_capacity < party_size_param then 'insufficient_capacity'
      else 'date_or_time_mismatch'
    end,
    ba.id
  from business_availability ba
  join brand_partners p on p.id = ba.partner_id and p.active = true and not public._business_declines_request(p.id, request_id_param) and not public._business_below_min_spend(p.id, request_id_param)
  where ba.status = 'active'
  and ba.ends_at > now()
  and (preferred_availability_id_param is null or ba.id != preferred_availability_id_param)
  and p.latitude is not null and p.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
      sin(radians(latitude_param)) * sin(radians(p.latitude))
    ))
  )) <= least(radius_miles_param, ba.radius_miles)
  and not (
    (ba.remaining_capacity is null or ba.remaining_capacity > 0)
    and (party_size_param is null or ba.remaining_capacity is null or ba.remaining_capacity >= party_size_param)
    and (category_param is null or ba.category is null or ba.category = category_param)
    and (date_param is null or date_param between ba.starts_at::date and ba.ends_at::date)
    and (
      date_param is null or time_window_start_param is null or time_window_end_param is null
      or (date_param + time_window_start_param, date_param + time_window_end_param)
         overlaps (ba.starts_at, ba.ends_at)
    )
  )
  on conflict (request_id, partner_id, availability_id) where source = 'availability' do nothing;

  return v_new_count;
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
