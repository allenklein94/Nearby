-- Item 67 (CLAUDE.md, direct user request): "Let the group vote on
-- businesses." User's own example: Nearby finds real options (Restaurant A
-- 7:00 PM $65/person / Restaurant B 7:30 PM $52/person / Restaurant C 8:00
-- PM $70/person), everyone votes, Restaurant B wins -> request/offer ->
-- availability -> reservation -> plan confirmed. "A social commerce loop
-- without making it feel like commerce."
--
-- Before this migration, occasion_group_plans' own group vote only ever
-- covered WHAT TO DO (an activity_type -- dinner/party/etc., see
-- 20261020_occasion_group_plans.sql's own header comment: "everything
-- downstream of the group has decided is deliberately NOT rebuilt here").
-- Once decided, only the HOST personally browsed real business_availability
-- candidates (CelebrateSomethingScreen's 'options' step) and picked alone --
-- the actual business/place was never itself put to a group vote. This
-- migration adds a second, optional voting round on the SAME plan/options/
-- votes tables: once the group decides a business-destined activity type
-- (dinner/night_out/activity -- resolveCelebrationDestination's own real
-- mapping, celebrateSomething.js), the plan moves to a new
-- 'voting_business' status instead of 'decided', the host's device fetches
-- real live resolveIntent() candidates (the exact same resolver
-- CelebrateSomethingScreen's own 'options' step already calls) and proposes
-- the top few as new, votable, business-kind options -- real
-- business_availability rows, never fabricated. The whole group votes
-- again (cast_occasion_vote is already fully generic over any option id --
-- no change needed there beyond widening its status gate). The host then
-- decides the winner (decide_occasion_group_plan_business), which is
-- re-verified live for availability before finalizing, and the client
-- directly submits the real bound business_request via the existing
-- submitBusinessRequest(preferredAvailabilityId) primitive (Finding 5,
-- CLAUDE.md) -- which itself already auto-creates a real 'offered'
-- business_request_offers row the instant it's submitted
-- (_match_request_to_availability). Request -> offer is instant; offer ->
-- reservation/plan-confirmed is the existing accept-offer flow, unchanged.
--
-- Deliberately did NOT replicate resolveIntent()'s real scoring engine in
-- SQL (category/subcategory/attribute/cuisine/party-type/occasion bonuses,
-- weather, affinity signals) -- that's a large, already-correct, already-
-- tested client resolver; duplicating it here would be a second copy that
-- drifts. The DB layer's own job is just to store the real chosen
-- candidates as votable options and re-verify their live availability
-- before ever finalizing a decision -- never to trust client-supplied
-- display text (price/name/time are always read fresh from
-- business_availability/brand_partners at both propose- and decide-time,
-- never accepted as client-supplied strings).
--
-- A real, disclosed escape hatch: if Nearby finds zero genuine businesses
-- nearby for the decided activity type (or the host just wants to browse
-- personally), skip_occasion_group_plan_business_vote() falls back to
-- exactly the pre-Item-67 behavior -- finalizes on the original
-- activity-type choice and hands the host into CelebrateSomethingScreen's
-- own solo 'options' step, unchanged.
--
-- A real, disclosed pre-existing limitation this migration does NOT fix
-- (matches current shipped behavior for the 'voting' stage already): a
-- participant who is still 'invited' (never joined) when the activity
-- round closes has no way to join once status moves past 'voting' -- true
-- today for 'decided' and now also true for 'voting_business'. Not a
-- regression, just an existing gap this change doesn't widen or narrow.

alter table public.occasion_group_plans drop constraint if exists occasion_group_plans_status_check;
alter table public.occasion_group_plans
  add constraint occasion_group_plans_status_check
  check (status in ('voting', 'voting_business', 'decided', 'cancelled', 'fulfilled'));

alter table public.occasion_group_plan_options
  add column if not exists option_kind text not null default 'activity',
  add column if not exists business_availability_id uuid references public.business_availability(id) on delete cascade;

alter table public.occasion_group_plan_options drop constraint if exists occasion_group_plan_options_kind_check;
alter table public.occasion_group_plan_options
  add constraint occasion_group_plan_options_kind_check
  check (option_kind in ('activity', 'business'));

alter table public.occasion_group_plan_options drop constraint if exists occasion_group_plan_options_kind_shape_check;
alter table public.occasion_group_plan_options
  add constraint occasion_group_plan_options_kind_shape_check
  check (
    (option_kind = 'activity' and business_availability_id is null)
    or (option_kind = 'business' and business_availability_id is not null)
  );

create index if not exists occasion_group_plan_options_availability_idx
  on public.occasion_group_plan_options(business_availability_id)
  where business_availability_id is not null;

-- ---- decide_occasion_group_plan: branch into a business vote round ----
-- Unchanged 2-arg signature -- a plain CREATE OR REPLACE is safe. The real
-- live body from 20261026_occasion_group_plan_collaborative.sql, with one
-- new branch: a business-destined activity_type (dinner/night_out/activity
-- -- the exact same set resolveCelebrationDestination() maps to 'business',
-- celebrateSomething.js) moves the plan to 'voting_business' instead of
-- 'decided', leaving winning_option_id pointing at the activity option
-- until the business round itself decides (decide_occasion_group_plan_
-- business below) replaces it. Every other destination (gathering/custom)
-- is completely unchanged. A new `status` field is now always present on
-- the returned jsonb so the client can branch without guessing.

create or replace function public.decide_occasion_group_plan(plan_id_param uuid, option_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_option record;
  v_party_size integer;
  service_key text;
  v_participant record;
  v_wants_notif boolean;
  v_is_business boolean;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if v_plan is null then
    raise exception 'You are not the host of this plan.';
  end if;
  if v_plan.status <> 'voting' then
    raise exception 'This plan has already been decided or cancelled.';
  end if;

  select * into v_option from occasion_group_plan_options where id = option_id_param and group_plan_id = plan_id_param;
  if v_option is null then
    raise exception 'That option does not belong to this plan.';
  end if;

  select count(*) into v_party_size from occasion_group_plan_participants
  where group_plan_id = plan_id_param and status = 'joined';

  v_is_business := v_option.activity_type in ('dinner', 'night_out', 'activity');

  if v_is_business then
    update occasion_group_plans
    set status = 'voting_business', winning_option_id = option_id_param
    where id = plan_id_param;
  else
    update occasion_group_plans
    set status = 'decided', winning_option_id = option_id_param, decided_at = now()
    where id = plan_id_param;
  end if;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_participant in
    select user_id from occasion_group_plan_participants
    where group_plan_id = plan_id_param and status = 'joined' and user_id <> auth.uid()
  loop
    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_participant.user_id;
    if service_key is not null and v_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_participant.user_id,
          'title', case when v_is_business then '🍽️ Vote on where!' else '🎉 It''s decided!' end,
          'body', case when v_is_business
            then v_plan.title || ': ' || coalesce(v_option.label, v_option.activity_type) || ' won -- Nearby is finding real options for the group to vote on.'
            else v_plan.title || ': ' || coalesce(v_option.label, v_option.activity_type) || ' won the vote.'
          end,
          'data', jsonb_build_object(
            'type', case when v_is_business then 'occasion_group_plan_voting_business' else 'occasion_group_plan_decided' end,
            'plan_id', plan_id_param
          )
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'status', case when v_is_business then 'voting_business' else 'decided' end,
    'occasionType', v_plan.occasion_type,
    'title', v_plan.title,
    'whoForName', v_plan.who_for_name,
    'whoForFriendId', v_plan.who_for_friend_id,
    'whenPreset', v_plan.when_preset,
    'scheduledDate', v_plan.scheduled_date,
    'activityType', v_option.activity_type,
    'label', v_option.label,
    'partySize', greatest(v_party_size, 1),
    'surpriseMode', v_plan.surprise_mode,
    'budgetMin', v_plan.budget_min,
    'budgetMax', v_plan.budget_max
  );
end;
$function$;

revoke all on function public.decide_occasion_group_plan(uuid, uuid) from public, anon;
grant execute on function public.decide_occasion_group_plan(uuid, uuid) to authenticated;

-- ---- Nearby proposes real, live business options for the group to vote on ----
-- Host-only (mirrors decide authority -- this is a direct continuation of
-- the host's own decide action, not a new independent power). Takes real
-- business_availability ids the host's device already found via
-- resolveIntent() -- never trusted blindly: each is re-verified live
-- (active, not expired, has capacity, its own business still active)
-- before being stored as a votable option. Capped at 5 real business
-- options per plan -- these are Nearby's own curated picks, not an open
-- proposal free-for-all like the activity round.

create or replace function public.propose_occasion_business_options(plan_id_param uuid, availability_ids_param uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_activity_type text;
  v_existing_count integer;
  v_remaining_slots integer;
  v_avail_id uuid;
  v_proposed_count integer := 0;
  v_found_id uuid;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if v_plan is null then
    raise exception 'You are not the host of this plan.';
  end if;
  if v_plan.status <> 'voting_business' then
    raise exception 'This plan is not currently voting on businesses.';
  end if;

  select activity_type into v_activity_type from occasion_group_plan_options where id = v_plan.winning_option_id;

  select count(*) into v_existing_count from occasion_group_plan_options
  where group_plan_id = plan_id_param and option_kind = 'business';
  v_remaining_slots := greatest(0, 5 - v_existing_count);

  if availability_ids_param is not null then
    foreach v_avail_id in array availability_ids_param loop
      exit when v_remaining_slots <= 0;
      continue when exists (
        select 1 from occasion_group_plan_options
        where group_plan_id = plan_id_param and business_availability_id = v_avail_id
      );

      select ba.id into v_found_id
      from business_availability ba
      join brand_partners bp on bp.id = ba.partner_id and bp.active = true
      where ba.id = v_avail_id
      and ba.status = 'active'
      and ba.ends_at > now()
      and (ba.remaining_capacity is null or ba.remaining_capacity > 0);

      if v_found_id is null then
        continue;
      end if;

      insert into occasion_group_plan_options (group_plan_id, activity_type, option_kind, business_availability_id, proposed_by)
      values (plan_id_param, v_activity_type, 'business', v_avail_id, auth.uid());
      v_proposed_count := v_proposed_count + 1;
      v_remaining_slots := v_remaining_slots - 1;
    end loop;
  end if;

  return jsonb_build_object('proposedCount', v_proposed_count);
end;
$function$;

revoke all on function public.propose_occasion_business_options(uuid, uuid[]) from public, anon;
grant execute on function public.propose_occasion_business_options(uuid, uuid[]) to authenticated;

-- ---- decide_occasion_group_plan_business: finalize the winning business ----
-- Host-only, same authority boundary as decide_occasion_group_plan. Re-
-- verifies the chosen business_availability is still genuinely live right
-- before finalizing (a real posting can expire or fill up between being
-- proposed and being decided) -- a stale pick raises a clear error rather
-- than silently finalizing on a business that can no longer honor it.
-- Deliberately does NOT itself call create_business_request -- that needs
-- the caller's own real device location (submitBusinessRequest already
-- fetches it client-side); this RPC's only job is to record the group's
-- real decision. The client (GroupOccasionPlanScreen's "Book It" action)
-- calls the existing submitBusinessRequest(preferredAvailabilityId)
-- immediately after, which itself instantly creates a real 'offered'
-- business_request_offers row (_match_request_to_availability) -- request
-- -> offer, in one step, no waiting on the business.

create or replace function public.decide_occasion_group_plan_business(plan_id_param uuid, option_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_option record;
  v_partner_name text;
  v_posting_title text;
  v_still_live boolean;
  service_key text;
  v_participant record;
  v_wants_notif boolean;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if v_plan is null then
    raise exception 'You are not the host of this plan.';
  end if;
  if v_plan.status <> 'voting_business' then
    raise exception 'This plan is not currently voting on businesses.';
  end if;

  select * into v_option from occasion_group_plan_options
  where id = option_id_param and group_plan_id = plan_id_param and option_kind = 'business';
  if v_option is null then
    raise exception 'That option does not belong to this plan.';
  end if;

  select bp.name, ba.title, (
    ba.status = 'active' and ba.ends_at > now() and (ba.remaining_capacity is null or ba.remaining_capacity > 0) and bp.active
  ) into v_partner_name, v_posting_title, v_still_live
  from business_availability ba
  join brand_partners bp on bp.id = ba.partner_id
  where ba.id = v_option.business_availability_id;

  if v_still_live is not true then
    raise exception 'That option is no longer available -- please pick a different one or find new options.';
  end if;

  update occasion_group_plans
  set status = 'decided', winning_option_id = option_id_param, decided_at = now()
  where id = plan_id_param;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_participant in
    select user_id from occasion_group_plan_participants
    where group_plan_id = plan_id_param and status = 'joined' and user_id <> auth.uid()
  loop
    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_participant.user_id;
    if service_key is not null and v_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_participant.user_id,
          'title', '🎉 It''s decided!',
          'body', v_plan.title || ': ' || coalesce(v_partner_name, 'a business') || ' won the vote.',
          'data', jsonb_build_object('type', 'occasion_group_plan_decided', 'plan_id', plan_id_param)
        )
      );
    end if;
  end loop;

  return jsonb_build_object('partnerName', v_partner_name, 'postingTitle', v_posting_title);
end;
$function$;

revoke all on function public.decide_occasion_group_plan_business(uuid, uuid) from public, anon;
grant execute on function public.decide_occasion_group_plan_business(uuid, uuid) to authenticated;

-- ---- Escape hatch: skip the business vote entirely ----
-- Host-only. Falls back to exactly the pre-Item-67 behavior -- finalizes
-- on the ORIGINAL activity-type choice (winning_option_id still points to
-- it; the business round never replaced it) and returns the same payload
-- shape decide_occasion_group_plan already returns for a non-business
-- destination, so the client can navigate into CelebrateSomethingScreen's
-- own solo 'options' step exactly like before this feature existed. Used
-- when Nearby finds zero genuine businesses nearby, or the host simply
-- wants to browse personally instead of running a second group vote.

create or replace function public.skip_occasion_group_plan_business_vote(plan_id_param uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_option record;
  v_party_size integer;
  service_key text;
  v_participant record;
  v_wants_notif boolean;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if v_plan is null then
    raise exception 'You are not the host of this plan.';
  end if;
  if v_plan.status <> 'voting_business' then
    raise exception 'This plan is not currently voting on businesses.';
  end if;

  select * into v_option from occasion_group_plan_options where id = v_plan.winning_option_id;

  select count(*) into v_party_size from occasion_group_plan_participants
  where group_plan_id = plan_id_param and status = 'joined';

  update occasion_group_plans
  set status = 'decided', decided_at = now()
  where id = plan_id_param;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  for v_participant in
    select user_id from occasion_group_plan_participants
    where group_plan_id = plan_id_param and status = 'joined' and user_id <> auth.uid()
  loop
    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_participant.user_id;
    if service_key is not null and v_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', v_participant.user_id,
          'title', '🎉 It''s decided!',
          'body', v_plan.title || ': ' || coalesce(v_option.label, v_option.activity_type) || ' won the vote.',
          'data', jsonb_build_object('type', 'occasion_group_plan_decided', 'plan_id', plan_id_param)
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'occasionType', v_plan.occasion_type,
    'title', v_plan.title,
    'whoForName', v_plan.who_for_name,
    'whoForFriendId', v_plan.who_for_friend_id,
    'whenPreset', v_plan.when_preset,
    'scheduledDate', v_plan.scheduled_date,
    'activityType', v_option.activity_type,
    'label', v_option.label,
    'partySize', greatest(v_party_size, 1),
    'surpriseMode', v_plan.surprise_mode,
    'budgetMin', v_plan.budget_min,
    'budgetMax', v_plan.budget_max
  );
end;
$function$;

revoke all on function public.skip_occasion_group_plan_business_vote(uuid) from public, anon;
grant execute on function public.skip_occasion_group_plan_business_vote(uuid) to authenticated;

-- ---- cast_occasion_vote: also allow voting during the business round ----
-- Unchanged signature -- plain CREATE OR REPLACE. Already fully generic
-- over any option id (activity or business); only the plan-status gate
-- needed widening.

create or replace function public.cast_occasion_vote(option_id_param uuid, voting_param boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_option record;
  v_plan record;
  v_is_joined boolean;
begin
  select * into v_option from occasion_group_plan_options where id = option_id_param;
  if v_option is null then
    raise exception 'This option no longer exists.';
  end if;

  select * into v_plan from occasion_group_plans where id = v_option.group_plan_id;
  if v_plan.status not in ('voting', 'voting_business') then
    raise exception 'Voting is closed on this plan.';
  end if;

  select exists (
    select 1 from occasion_group_plan_participants
    where group_plan_id = v_option.group_plan_id and user_id = auth.uid() and status = 'joined'
  ) into v_is_joined;
  if not v_is_joined then
    raise exception 'Only people who joined this plan can vote.';
  end if;

  if voting_param then
    insert into occasion_group_plan_votes (option_id, voter_id)
    values (option_id_param, auth.uid())
    on conflict (option_id, voter_id) do nothing;
  else
    delete from occasion_group_plan_votes where option_id = option_id_param and voter_id = auth.uid();
  end if;
end;
$function$;

revoke all on function public.cast_occasion_vote(uuid, boolean) from public, anon;
grant execute on function public.cast_occasion_vote(uuid, boolean) to authenticated;

-- ---- get_occasion_group_plan_detail: surface business option fields ----
-- Unchanged 1-arg signature -- plain CREATE OR REPLACE. Options now carry
-- optionKind + (for a business option) a live-joined snapshot of the real
-- business_availability/brand_partners row -- always read fresh here,
-- never a stored/stale copy, so a posting that expires or fills up between
-- being proposed and being read shows that honestly (stillActive: false)
-- rather than showing whatever it looked like at propose-time.

create or replace function public.get_occasion_group_plan_detail(plan_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_result jsonb;
begin
  if not is_occasion_group_plan_participant(plan_id_param, auth.uid()) then
    raise exception 'You are not part of this plan.';
  end if;

  select * into v_plan from occasion_group_plans where id = plan_id_param;

  select jsonb_build_object(
    'id', v_plan.id,
    'hostId', v_plan.host_id,
    'isHost', v_plan.host_id = auth.uid(),
    'occasionType', v_plan.occasion_type,
    'title', v_plan.title,
    'whoForName', v_plan.who_for_name,
    'whoForFriendId', v_plan.who_for_friend_id,
    'whenPreset', v_plan.when_preset,
    'scheduledDate', v_plan.scheduled_date,
    'status', v_plan.status,
    'winningOptionId', v_plan.winning_option_id,
    'decidedAt', v_plan.decided_at,
    'expiresAt', v_plan.expires_at,
    'createdAt', v_plan.created_at,
    'surpriseMode', v_plan.surprise_mode,
    'budgetMin', v_plan.budget_min,
    'budgetMax', v_plan.budget_max,
    'myStatus', (
      select status from occasion_group_plan_participants
      where group_plan_id = plan_id_param and user_id = auth.uid()
    ),
    'myIsOrganizer', (
      v_plan.host_id = auth.uid() or exists (
        select 1 from occasion_group_plan_participants
        where group_plan_id = plan_id_param and user_id = auth.uid() and status = 'joined' and is_organizer
      )
    ),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', pp.user_id, 'displayName', pr.display_name, 'status', pp.status, 'isOrganizer', pp.is_organizer
      ) order by pp.invited_at)
      from occasion_group_plan_participants pp
      join profiles pr on pr.id = pp.user_id
      where pp.group_plan_id = plan_id_param
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'optionKind', o.option_kind,
        'activityType', o.activity_type,
        'label', o.label,
        'proposedBy', o.proposed_by,
        'businessAvailabilityId', o.business_availability_id,
        'partnerName', bp.name,
        'postingTitle', ba.title,
        'price', ba.price,
        'startsAt', ba.starts_at,
        'stillActive', case when o.option_kind = 'business' then coalesce(
          ba.status = 'active' and ba.ends_at > now() and (ba.remaining_capacity is null or ba.remaining_capacity > 0) and bp.active,
          false
        ) else null end,
        'voteCount', (select count(*) from occasion_group_plan_votes v where v.option_id = o.id),
        'myVote', exists (select 1 from occasion_group_plan_votes v where v.option_id = o.id and v.voter_id = auth.uid())
      ) order by o.created_at)
      from occasion_group_plan_options o
      left join business_availability ba on ba.id = o.business_availability_id
      left join brand_partners bp on bp.id = ba.partner_id
      where o.group_plan_id = plan_id_param
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_occasion_group_plan_detail(uuid) from public, anon;
grant execute on function public.get_occasion_group_plan_detail(uuid) to authenticated;
