-- Item 96 (CLAUDE.md, direct user request): "Add surprise mode... Then:
-- Sarah isn't notified / organizers can coordinate / invitations can be
-- discreet / business knows it's a surprise if relevant. Eventually: Reveal
-- plan becomes an action."
--
-- Audited the real current state first: Item 65 (2026-09-12) already built
-- the core of this -- occasions.surprise_mode / occasion_group_plans.
-- surprise_mode, a structural guarantee the celebrated person is never
-- invited to vote (both a function-level early-skip AND a BEFORE INSERT
-- trigger backstop), and a real 🔒 banner for collaborators on
-- GroupOccasionPlanScreen. Two concrete pieces from this item's own list
-- were genuinely missing, found by tracing every real invite/organizer
-- path rather than assumed:
--
-- (1) "business knows it's a surprise if relevant" -- business_requests
--     had no surprise concept at all. Added `surprise_mode boolean`
--     (never who_for_friend_id -- Item 69's "businesses shouldn't need to
--     know the person's identity" boundary stays intact; the business
--     learns THAT it's a surprise, never WHO for).
--
-- (2) "invitations can be discreet" / "organizers can coordinate" stopped
--     being true the moment a decided group plan became a REAL
--     business_requests-backed plan: Item 36's invite_to_business_request
--     and Item 88's add_plan_organizer (both operate on the real resulting
--     plan, not occasion_group_plan_participants) had zero surprise
--     awareness -- a host could accidentally re-invite or even directly
--     co-organizer-promote the very person the whole plan is hidden from,
--     with no guardrail at all. Closed via a new internal helper,
--     _surprise_excluded_friend_id_for_business_request(), which walks the
--     real plans.resulting_business_request_id / occasion_group_plans.
--     resulting_plan_id / occasions.resulting_plan_id linkage ("Occasion
--     architecture should not be a silo") to find who (if anyone) must
--     stay excluded, with no new identity field duplicated onto
--     business_requests itself. Since plan_messages access
--     (is_plan_participant) is entirely derived from group_plan_participants
--     + plan_organizers, protecting these two real INSERT paths
--     transitively protects the group chat too -- no separate fix needed
--     there.
--
-- "Eventually: Reveal plan becomes an action" -- genuinely unbuilt, no
-- code anywhere. Two new RPCs, one per real surprise-mode source table:
-- reveal_occasion_group_plan() (host-only, mirroring decide/cancel
-- authority) and reveal_occasion() (owner-only). Both flip surprise_mode
-- off, propagate that onto any resulting business_requests row(s) so the
-- business-facing signal stays honest, and -- the part that makes this a
-- real action rather than an inert flag flip -- actually let the
-- previously-excluded person in: reveal_occasion_group_plan() inserts them
-- as a real 'invited' participant (same shape any other invite produces)
-- and sends them a real push; reveal_occasion() sets connected_user_id =
-- who_for_friend_id (now legal -- the CHECK constraint blocking that
-- combination only fires while surprise_mode is still true) and sends the
-- same kind of push, turning ON the exact sharing mechanism Items 62/63
-- already built rather than inventing a second one.

alter table public.business_requests
  add column if not exists surprise_mode boolean not null default false;

-- ---- create_business_request: new trailing surprise_mode_param ----
-- Explicit drop of the old live 18-arg signature (Item 95's own
-- experience_level addition) first.

drop function if exists public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision, uuid, uuid, text[], text, text, uuid, text);

create or replace function public.create_business_request(
  raw_text_param text,
  latitude_param double precision,
  longitude_param double precision,
  category_param text default null,
  party_size_param integer default null,
  budget_min_param integer default null,
  budget_max_param integer default null,
  date_param date default null,
  time_window_start_param time default null,
  time_window_end_param time default null,
  radius_miles_param double precision default 15,
  submission_id_param uuid default null,
  preferred_availability_id_param uuid default null,
  attributes_param text[] default null,
  cuisine_param text default null,
  occasion_param text default null,
  preferred_package_id_param uuid default null,
  experience_level_param text default null,
  surprise_mode_param boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  if experience_level_param is not null and experience_level_param not in ('simple', 'special', 'go_all_out') then
    raise exception 'Invalid experience level';
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
    experience_level, surprise_mode
  ) values (
    auth.uid(), trim(raw_text_param), category_param, party_size_param,
    budget_min_param, budget_max_param, date_param, time_window_start_param,
    time_window_end_param, latitude_param, longitude_param,
    coalesce(radius_miles_param, 15), v_expires_at,
    (select id from intent_submissions where id = submission_id_param and user_id = auth.uid()),
    coalesce(attributes_param, '{}'), cuisine_param, occasion_param,
    experience_level_param, coalesce(surprise_mode_param, false)
  ) returning id into v_request_id;

  select public._business_request_fanout(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15)) into v_notified_count;
  select public._match_request_to_availability(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, date_param, time_window_start_param, time_window_end_param, preferred_availability_id_param, party_size_param) into v_avail_new_count;
  select public._match_request_to_policy(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), party_size_param, time_window_start_param, time_window_end_param) into v_policy_new_count;
  select public._match_request_to_package(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), occasion_param, party_size_param, date_param, preferred_package_id_param) into v_package_new_count;
  select public._ai_auto_respond_to_business_requests(v_request_id, latitude_param, longitude_param, coalesce(radius_miles_param, 15), category_param, party_size_param, time_window_start_param, time_window_end_param) into v_ai_new_count;
  v_notified_count := v_notified_count + coalesce(v_avail_new_count, 0) + coalesce(v_policy_new_count, 0) + coalesce(v_package_new_count, 0) + coalesce(v_ai_new_count, 0);

  return jsonb_build_object('requestId', v_request_id, 'notifiedCount', v_notified_count);
end;
$function$;

revoke all on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision, uuid, uuid, text[], text, text, uuid, text, boolean) from public, anon;
grant execute on function public.create_business_request(text, double precision, double precision, text, integer, integer, integer, date, time, time, double precision, uuid, uuid, text[], text, text, uuid, text, boolean) to authenticated;

-- ---- get_business_opportunities: also return surprise_mode ----
-- Real context for the business ("if relevant") -- mirrors experience_
-- level/addon_type/plan_time's own additions to this same jsonb. Never
-- who_for_friend_id -- the business learns THAT it's a surprise, never
-- WHO for. RETURNS jsonb, unchanged signature -- plain CREATE OR REPLACE
-- is safe.

create or replace function public.get_business_opportunities(partner_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
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
$function$;

revoke all on function public.get_business_opportunities(uuid) from public, anon;
grant execute on function public.get_business_opportunities(uuid) to authenticated;

-- ---- Internal helper: who (if anyone) must stay excluded from being
-- invited/organizer-promoted on a real business_requests-backed plan,
-- because the plan traces back to a real surprise-mode occasion or group
-- plan. Read-only, but reveals a specific person's identity for a request
-- the caller might not have any real access to -- revoked from
-- authenticated too, same posture as other internal (_-prefixed) helpers
-- that must only ever be called from within another SECURITY DEFINER
-- function, never directly by a client (Item 90's own "a mutating helper
-- left grantable to authenticated is a real vulnerability" lesson, applied
-- here defensively even though this one is read-only).

create or replace function public._surprise_excluded_friend_id_for_business_request(request_id_param uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select who_for_friend_id from (
    select ogp.who_for_friend_id
    from business_requests br
    join plans p on p.resulting_business_request_id = coalesce(br.parent_request_id, br.id)
    join occasion_group_plans ogp on ogp.resulting_plan_id = p.id
    where br.id = request_id_param and ogp.surprise_mode and ogp.who_for_friend_id is not null
    union all
    select o.who_for_friend_id
    from business_requests br
    join plans p on p.resulting_business_request_id = coalesce(br.parent_request_id, br.id)
    join occasions o on o.resulting_plan_id = p.id
    where br.id = request_id_param and o.surprise_mode and o.who_for_friend_id is not null
  ) t
  limit 1;
$function$;

revoke all on function public._surprise_excluded_friend_id_for_business_request(uuid) from public, anon, authenticated;
grant execute on function public._surprise_excluded_friend_id_for_business_request(uuid) to postgres, service_role;

-- ---- invite_to_business_request: skip the surprise-excluded person ----
-- Unchanged signature -- plain CREATE OR REPLACE is safe. Same silent-skip
-- shape this function already uses for a blocked/unconnected invitee --
-- not a hard failure, since a batch invite with several real picks
-- shouldn't fail entirely over one that must stay excluded.

create or replace function public.invite_to_business_request(request_id_param uuid, invitee_ids_param uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request record;
  v_proposal_id uuid;
  v_invitee_id uuid;
  v_companion_request_id uuid;
  v_expires_at timestamptz;
  v_invited_count integer := 0;
  service_key text;
  v_initiator_name text;
  v_wants_notif boolean;
  v_excluded_friend_id uuid;
begin
  select * into v_request from business_requests where id = request_id_param for update;
  if v_request is null then
    raise exception 'Request not found.';
  end if;
  if not public._can_manage_business_request(v_request.id) then
    raise exception 'You do not have permission to invite for this request.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'This request is no longer open.';
  end if;
  if v_request.category is null then
    raise exception 'This request needs a category before you can invite someone.';
  end if;
  if invitee_ids_param is null or array_length(invitee_ids_param, 1) is null then
    raise exception 'Pick at least one person to invite.';
  end if;

  v_excluded_friend_id := public._surprise_excluded_friend_id_for_business_request(v_request.id);

  select proposal_id into v_proposal_id
  from group_plan_participants
  where source_request_id = request_id_param and user_id = auth.uid();

  if v_proposal_id is null then
    v_expires_at := now() + interval '48 hours';
    insert into group_plan_proposals (initiator_id, category, date, time_window_start, time_window_end, radius_miles, expires_at)
    values (auth.uid(), v_request.category, v_request.date, v_request.time_window_start, v_request.time_window_end, v_request.radius_miles, v_expires_at)
    returning id into v_proposal_id;

    insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status, responded_at)
    values (v_proposal_id, auth.uid(), request_id_param, coalesce(v_request.party_size, 1), 'accepted', now());
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select display_name into v_initiator_name from profiles where id = auth.uid();

  foreach v_invitee_id in array invitee_ids_param loop
    continue when v_invitee_id = auth.uid();
    continue when is_blocked(auth.uid(), v_invitee_id);
    -- Item 96: never re-invite the person this plan is a surprise for,
    -- even after it's become a real business_requests-backed plan.
    continue when v_excluded_friend_id is not null and v_invitee_id = v_excluded_friend_id;

    if not (
      exists (
        select 1 from friendships f
        where f.status = 'accepted'
        and ((f.user_a = auth.uid() and f.user_b = v_invitee_id) or (f.user_a = v_invitee_id and f.user_b = auth.uid()))
      )
      or exists (
        select 1 from matches m
        where (m.user_a = auth.uid() and m.user_b = v_invitee_id) or (m.user_a = v_invitee_id and m.user_b = auth.uid())
      )
    ) then
      continue;
    end if;

    insert into business_requests (
      requester_id, raw_text, category, date, time_window_start, time_window_end,
      latitude, longitude, radius_miles, expires_at
    ) values (
      v_invitee_id, v_request.raw_text, v_request.category, v_request.date, v_request.time_window_start, v_request.time_window_end,
      v_request.latitude, v_request.longitude, v_request.radius_miles, v_request.expires_at
    ) returning id into v_companion_request_id;

    begin
      insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status)
      values (v_proposal_id, v_invitee_id, v_companion_request_id, 1, 'invited');
      v_invited_count := v_invited_count + 1;
    exception when unique_violation then
      continue;
    end;

    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_invitee_id;
    if service_key is not null and v_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_invitee_id,
          'title', 'You''re invited to a plan',
          'body', coalesce(v_initiator_name, 'Someone you know') || ' invited you to their ' || v_request.category || ' plan.',
          'data', jsonb_build_object('type', 'group_plan_invite', 'proposal_id', v_proposal_id)
        )
      );
    end if;
  end loop;

  if v_invited_count = 0 then
    raise exception 'None of the people you picked could be invited -- they may no longer be connected.';
  end if;

  return jsonb_build_object('proposalId', v_proposal_id, 'invitedCount', v_invited_count);
end;
$function$;

revoke all on function public.invite_to_business_request(uuid, uuid[]) from public, anon;
grant execute on function public.invite_to_business_request(uuid, uuid[]) to authenticated;

-- ---- add_plan_organizer: reject the surprise-excluded person ----
-- Unchanged signature -- plain CREATE OR REPLACE is safe. Unlike the
-- invite loop above (several picks at once, silent skip), this takes one
-- friend at a time and already raises a clear exception for every other
-- rejection reason -- matches that existing style.

create or replace function public.add_plan_organizer(business_request_id_param uuid, friend_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_primary_id uuid;
  v_plan record;
  v_host_name text;
  v_wants_notif boolean;
  service_key text;
begin
  select coalesce(parent_request_id, id) into v_primary_id from business_requests where id = business_request_id_param;
  if v_primary_id is null then
    raise exception 'Request not found.';
  end if;

  select p.* into v_plan from plans p where p.resulting_business_request_id = v_primary_id order by created_at desc limit 1;
  if v_plan.id is null then
    raise exception 'This request has no plan yet.';
  end if;
  if v_plan.created_by <> auth.uid() then
    raise exception 'Only the plan''s host can add a co-organizer.';
  end if;
  if friend_user_id = auth.uid() then
    raise exception 'You''re already organizing this plan.';
  end if;
  if is_blocked(auth.uid(), friend_user_id) then
    raise exception 'You can''t add this person.';
  end if;
  if friend_user_id = public._surprise_excluded_friend_id_for_business_request(business_request_id_param) then
    raise exception 'This plan is a surprise for that person -- they can''t be added yet.';
  end if;
  if not (
    exists (
      select 1 from friendships f
      where f.status = 'accepted'
      and ((f.user_a = auth.uid() and f.user_b = friend_user_id) or (f.user_a = friend_user_id and f.user_b = auth.uid()))
    )
    or exists (
      select 1 from matches m
      where (m.user_a = auth.uid() and m.user_b = friend_user_id) or (m.user_a = friend_user_id and m.user_b = auth.uid())
    )
  ) then
    raise exception 'You can only add a real connected friend as a co-organizer.';
  end if;

  insert into plan_organizers (plan_id, user_id, added_by)
  values (v_plan.id, friend_user_id, auth.uid())
  on conflict (plan_id, user_id) do nothing;

  select display_name into v_host_name from profiles where id = auth.uid();
  select coalesce(notify_planning, true) into v_wants_notif from profiles where id = friend_user_id;
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  if service_key is not null and v_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', friend_user_id,
        'title', 'You''re a co-organizer',
        'body', coalesce(v_host_name, 'Someone you know') || ' added you as a co-organizer for ' || coalesce(v_plan.title, 'a plan') || '.',
        'data', jsonb_build_object('type', 'plan_organizer_added', 'request_id', v_primary_id)
      )
    );
  end if;

  return jsonb_build_object('planId', v_plan.id, 'addedUserId', friend_user_id);
end;
$function$;

revoke all on function public.add_plan_organizer(uuid, uuid) from public, anon;
grant execute on function public.add_plan_organizer(uuid, uuid) to authenticated;

-- ---- Internal helper: once a surprise is revealed, clear the
-- business-facing flag on every real business_requests row belonging to
-- that plan (the primary and any of its own add-ons), so a business never
-- keeps seeing "this is a surprise" once it no longer is. Mutating -- same
-- posture as _notify_other_plan_participants: revoked from authenticated
-- too, internal-only.

create or replace function public._clear_surprise_on_resulting_business_requests(plan_id_param uuid)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update business_requests br
  set surprise_mode = false
  from plans p
  where p.id = plan_id_param
    and p.resulting_business_request_id is not null
    and (br.id = p.resulting_business_request_id or br.parent_request_id = p.resulting_business_request_id)
    and br.surprise_mode;
$function$;

revoke all on function public._clear_surprise_on_resulting_business_requests(uuid) from public, anon, authenticated;
grant execute on function public._clear_surprise_on_resulting_business_requests(uuid) to postgres, service_role;

-- ---- reveal_occasion_group_plan: "Eventually: Reveal plan becomes an
-- action." Host-only (mirrors decide/cancel's own single-decider
-- authority, Item 66's locked guardrail). Flips surprise_mode off,
-- propagates that onto any resulting real business_requests row(s), and
-- actually lets the previously-excluded person in -- a real 'invited'
-- participant row (the same shape any other invite already produces) plus
-- a real push -- rather than just flipping an inert flag.

create or replace function public.reveal_occasion_group_plan(plan_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  service_key text;
  v_host_name text;
  v_wants_notif boolean;
  v_notified boolean := false;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if v_plan is null then
    raise exception 'You are not the host of this plan.';
  end if;
  if not v_plan.surprise_mode then
    raise exception 'This plan isn''t a surprise.';
  end if;

  update occasion_group_plans set surprise_mode = false where id = plan_id_param;

  if v_plan.resulting_plan_id is not null then
    perform public._clear_surprise_on_resulting_business_requests(v_plan.resulting_plan_id);
  end if;

  if v_plan.who_for_friend_id is not null then
    insert into occasion_group_plan_participants (group_plan_id, user_id, status)
    values (plan_id_param, v_plan.who_for_friend_id, 'invited')
    on conflict (group_plan_id, user_id) do nothing;

    select display_name into v_host_name from profiles where id = auth.uid();
    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_plan.who_for_friend_id;
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    if service_key is not null and v_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_plan.who_for_friend_id,
          'title', '🎉 Surprise!',
          'body', coalesce(v_host_name, 'Someone you know') || ' let you in on the surprise -- check out ' || v_plan.title || '.',
          'data', jsonb_build_object('type', 'occasion_group_plan_invite', 'plan_id', plan_id_param)
        )
      );
      v_notified := true;
    end if;
  end if;

  return jsonb_build_object('revealed', true, 'notified', v_notified);
end;
$function$;

revoke all on function public.reveal_occasion_group_plan(uuid) from public, anon;
grant execute on function public.reveal_occasion_group_plan(uuid) to authenticated;

-- ---- reveal_occasion: the solo (non-group-vote) equivalent. Owner-only.
-- Flips surprise_mode off and -- now legal, since the CHECK constraint
-- blocking connected_user_id + surprise_mode together only fires while
-- surprise_mode is still true -- turns ON sharing with the real connected
-- friend this occasion is for, the exact mechanism Items 62/63 already
-- built for "share this too," rather than inventing a second one. Sends
-- the same kind of real reveal push reveal_occasion_group_plan() does.

create or replace function public.reveal_occasion(occasion_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_occasion record;
  service_key text;
  v_host_name text;
  v_wants_notif boolean;
  v_notified boolean := false;
begin
  select * into v_occasion from occasions where id = occasion_id_param and user_id = auth.uid() for update;
  if v_occasion is null then
    raise exception 'Occasion not found.';
  end if;
  if not v_occasion.surprise_mode then
    raise exception 'This occasion isn''t a surprise.';
  end if;

  update occasions
  set surprise_mode = false,
      connected_user_id = who_for_friend_id
  where id = occasion_id_param;

  if v_occasion.resulting_plan_id is not null then
    perform public._clear_surprise_on_resulting_business_requests(v_occasion.resulting_plan_id);
  end if;

  if v_occasion.who_for_friend_id is not null then
    select display_name into v_host_name from profiles where id = auth.uid();
    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_occasion.who_for_friend_id;
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    if service_key is not null and v_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_occasion.who_for_friend_id,
          'title', '🎉 Surprise!',
          'body', coalesce(v_host_name, 'Someone you know') || ' let you in on the surprise -- check out ' || v_occasion.title || '.',
          'data', jsonb_build_object('type', 'occasion_surprise_revealed', 'occasion_id', occasion_id_param, 'owner_id', auth.uid())
        )
      );
      v_notified := true;
    end if;
  end if;

  return jsonb_build_object('revealed', true, 'notified', v_notified);
end;
$function$;

revoke all on function public.reveal_occasion(uuid) from public, anon;
grant execute on function public.reveal_occasion(uuid) to authenticated;
