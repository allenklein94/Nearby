-- Opt-in interest sharing on business requests (design: PRODUCT_AUDIT/BUSINESS_REQUEST_INTEREST_SHARING_DESIGN_2026-09-18.md).
-- A consumer may attach a snapshot of their own declared interest tags to ONE personal business request so a
-- business can tailor its offer. Tags only, subset of the caller's own profile interests, sensitive tags
-- excluded, max 8, never on surprise-mode requests. Businesses read it through get_business_opportunities()
-- (jsonb -- adding a key changes no signature); they never get a requester id.
--
-- create_business_request gains a trailing parameter, which would leave the OLD signature live as a second
-- overload -- drop it explicitly first (see CLAUDE.md convention).
alter table public.business_requests
  add column if not exists shared_interests text[]
  check (shared_interests is null or cardinality(shared_interests) <= 8);

drop function if exists public.create_business_request(raw_text_param text, latitude_param double precision, longitude_param double precision, category_param text, party_size_param integer, budget_min_param integer, budget_max_param integer, date_param date, time_window_start_param time without time zone, time_window_end_param time without time zone, radius_miles_param double precision, submission_id_param uuid, preferred_availability_id_param uuid, attributes_param text[], cuisine_param text, occasion_param text, preferred_package_id_param uuid, experience_level_param text, surprise_mode_param boolean);

CREATE OR REPLACE FUNCTION public.create_business_request(raw_text_param text, latitude_param double precision, longitude_param double precision, category_param text DEFAULT NULL::text, party_size_param integer DEFAULT NULL::integer, budget_min_param integer DEFAULT NULL::integer, budget_max_param integer DEFAULT NULL::integer, date_param date DEFAULT NULL::date, time_window_start_param time without time zone DEFAULT NULL::time without time zone, time_window_end_param time without time zone DEFAULT NULL::time without time zone, radius_miles_param double precision DEFAULT 15, submission_id_param uuid DEFAULT NULL::uuid, preferred_availability_id_param uuid DEFAULT NULL::uuid, attributes_param text[] DEFAULT NULL::text[], cuisine_param text DEFAULT NULL::text, occasion_param text DEFAULT NULL::text, preferred_package_id_param uuid DEFAULT NULL::uuid, experience_level_param text DEFAULT NULL::text, surprise_mode_param boolean DEFAULT false, shared_interests_param text[] DEFAULT NULL::text[])
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
    radius_miles, expires_at, submission_id, attributes, cuisine, occasion,
    experience_level, surprise_mode, shared_interests
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param,
    budget_min_param, budget_max_param, date_param, time_window_start_param,
    time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at,
    (select id from intent_submissions where id = submission_id_param and user_id = auth.uid()),
    coalesce(attributes_param, '{}'), cuisine_param, occasion_param,
    experience_level_param, coalesce(surprise_mode_param, false), v_shared_interests
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

revoke all on function public.create_business_request(raw_text_param text, latitude_param double precision, longitude_param double precision, category_param text, party_size_param integer, budget_min_param integer, budget_max_param integer, date_param date, time_window_start_param time without time zone, time_window_end_param time without time zone, radius_miles_param double precision, submission_id_param uuid, preferred_availability_id_param uuid, attributes_param text[], cuisine_param text, occasion_param text, preferred_package_id_param uuid, experience_level_param text, surprise_mode_param boolean, text[]) from public, anon;
grant execute on function public.create_business_request(raw_text_param text, latitude_param double precision, longitude_param double precision, category_param text, party_size_param integer, budget_min_param integer, budget_max_param integer, date_param date, time_window_start_param time without time zone, time_window_end_param time without time zone, radius_miles_param double precision, submission_id_param uuid, preferred_availability_id_param uuid, attributes_param text[], cuisine_param text, occasion_param text, preferred_package_id_param uuid, experience_level_param text, surprise_mode_param boolean, text[]) to authenticated;

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
        'experience_level', br.experience_level,
        'surprise_mode', br.surprise_mode,
        'shared_interests', br.shared_interests,
        'addon_type', br.addon_type,
        'is_addon', br.parent_request_id is not null,
        'plan_time', br.plan_time,
        'plan_label', br.plan_label,
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
$function$
;
