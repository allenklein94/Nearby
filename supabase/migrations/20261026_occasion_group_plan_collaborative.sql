-- Item 66 (CLAUDE.md, direct user request): "Add collaborative planning."
-- User's own mock for "Sarah's 30th Birthday": Organizers (Allen, John,
-- Emily) distinct from Guests (8 invited), Ideas with vote counts (already
-- shipped by the original occasion_group_plans work), and a Budget
-- ($50-$100/person) feeding "Nearby is finding options...". This migration
-- closes the two real, concrete gaps that work didn't cover: co-organizers
-- (today only the single host can do anything beyond propose/vote/join)
-- and a real per-person budget range on the plan.
--
-- Co-organizers: occasion_group_plan_participants.is_organizer (default
-- false). The host can promote any joined participant to organizer
-- (set_occasion_group_plan_organizer, host-only); an organizer gains
-- exactly one real new power -- inviting more guests
-- (invite_more_to_occasion_group_plan) -- reusing the same eligibility/
-- surprise-mode-skip logic create_occasion_group_plan's own invite loop
-- already established. Deliberately NOT given decide/cancel power: keeping
-- a single decider avoids a conflicting-authority problem this repo's own
-- backlog guardrail ("no complex RSVP systems... don't build a giant
-- event-management platform") warns against; a co-organizer's role here is
-- "help run the guest list," not "co-own the final decision."
--
-- Budget: occasion_group_plans.budget_min/budget_max (nullable integers,
-- USD per person) -- a real, explicit, chip-picked organizer input (never
-- AI-inferred, per this repo's own standing "AI never infers a specific
-- value without confirmation" discipline, run here in a fully non-AI,
-- deterministic context). Threaded through to whichever real
-- business_requests row the decided plan ultimately creates
-- (create_business_request already has budget_min_param/budget_max_param
-- -- no DB change needed there, pure client wiring).

alter table public.occasion_group_plan_participants
  add column if not exists is_organizer boolean not null default false;

alter table public.occasion_group_plans
  add column if not exists budget_min integer,
  add column if not exists budget_max integer;

alter table public.occasion_group_plans drop constraint if exists occasion_group_plans_budget_check;
alter table public.occasion_group_plans
  add constraint occasion_group_plans_budget_check
  check (
    (budget_min is null or budget_min >= 0)
    and (budget_max is null or budget_max >= 0)
    and (budget_min is null or budget_max is null or budget_min <= budget_max)
  );

-- ---- create_occasion_group_plan: new trailing budget params ----
-- Per this repo's own standing convention, a changed parameter list creates
-- a second overload rather than replacing the original; explicit drop of
-- the old 8-arg signature (Item 65's own surprise_mode addition) first.

drop function if exists public.create_occasion_group_plan(text, text, text, uuid, text, date, uuid[], boolean);

create or replace function public.create_occasion_group_plan(
  occasion_type_param text,
  title_param text,
  who_for_name_param text,
  who_for_friend_id_param uuid,
  when_preset_param text,
  scheduled_date_param date,
  invitee_ids_param uuid[],
  surprise_mode_param boolean default false,
  budget_min_param integer default null,
  budget_max_param integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan_id uuid;
  v_invitee_id uuid;
  v_invited_count integer := 0;
  service_key text;
  v_host_name text;
  v_wants_notif boolean;
begin
  if title_param is null or trim(title_param) = '' then
    raise exception 'This occasion needs a title.';
  end if;
  if budget_min_param is not null and budget_max_param is not null and budget_min_param > budget_max_param then
    raise exception 'Budget minimum can''t be more than the maximum.';
  end if;

  insert into occasion_group_plans (
    host_id, occasion_type, title, who_for_name, who_for_friend_id, when_preset, scheduled_date,
    surprise_mode, budget_min, budget_max
  ) values (
    auth.uid(), occasion_type_param, trim(title_param), who_for_name_param, who_for_friend_id_param,
    when_preset_param, scheduled_date_param, coalesce(surprise_mode_param, false), budget_min_param, budget_max_param
  ) returning id into v_plan_id;

  insert into occasion_group_plan_participants (group_plan_id, user_id, status, responded_at)
  values (v_plan_id, auth.uid(), 'joined', now());

  if invitee_ids_param is not null and array_length(invitee_ids_param, 1) > 0 then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select display_name into v_host_name from profiles where id = auth.uid();

    foreach v_invitee_id in array invitee_ids_param loop
      continue when v_invitee_id = auth.uid();
      continue when is_blocked(auth.uid(), v_invitee_id);
      -- Item 65: never invite the person this occasion is for when
      -- surprise mode is on -- a clean early-skip so the rest of the
      -- invite list (and the plan itself) still succeeds. The trigger
      -- above is a structural backstop, not the primary mechanism.
      continue when coalesce(surprise_mode_param, false) and who_for_friend_id_param is not null and v_invitee_id = who_for_friend_id_param;

      -- Real connections only -- accepted friend or active match. Same
      -- eligibility check invite_to_business_request already established;
      -- standing "no stranger discovery via intent" rule.
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

      begin
        insert into occasion_group_plan_participants (group_plan_id, user_id, status)
        values (v_plan_id, v_invitee_id, 'invited');
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
            'title', '🗳️ You''re invited to plan together',
            'body', coalesce(v_host_name, 'Someone you know') || ' wants your vote on ' || trim(title_param) || '.',
            'data', jsonb_build_object('type', 'occasion_group_plan_invite', 'plan_id', v_plan_id)
          )
        );
      end if;
    end loop;
  end if;

  return jsonb_build_object('planId', v_plan_id, 'invitedCount', v_invited_count);
end;
$function$;

revoke all on function public.create_occasion_group_plan(text, text, text, uuid, text, date, uuid[], boolean, integer, integer) from public, anon;
grant execute on function public.create_occasion_group_plan(text, text, text, uuid, text, date, uuid[], boolean, integer, integer) to authenticated;

-- ---- Co-organizers ----

create or replace function public.set_occasion_group_plan_organizer(plan_id_param uuid, user_id_param uuid, is_organizer_param boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_host boolean;
  v_target_status text;
  service_key text;
  v_host_name text;
  v_title text;
  v_wants_notif boolean;
begin
  select (host_id = auth.uid()), title into v_is_host, v_title from occasion_group_plans where id = plan_id_param;
  if v_is_host is null then
    raise exception 'This plan does not exist.';
  end if;
  if not v_is_host then
    raise exception 'Only the host can set organizers.';
  end if;
  if user_id_param = auth.uid() then
    raise exception 'The host is already an organizer.';
  end if;

  select status into v_target_status from occasion_group_plan_participants
  where group_plan_id = plan_id_param and user_id = user_id_param;
  if v_target_status is null then
    raise exception 'That person is not part of this plan.';
  end if;
  if v_target_status <> 'joined' then
    raise exception 'Only someone who has joined the plan can be made an organizer.';
  end if;

  update occasion_group_plan_participants
  set is_organizer = is_organizer_param
  where group_plan_id = plan_id_param and user_id = user_id_param;

  if is_organizer_param then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select display_name into v_host_name from profiles where id = auth.uid();
    select coalesce(notify_planning, true) into v_wants_notif from profiles where id = user_id_param;
    if service_key is not null and v_wants_notif then
      perform net.http_post(
        url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
        body := jsonb_build_object(
          'recipient_id', user_id_param,
          'title', '🎗️ You''re now a co-organizer',
          'body', coalesce(v_host_name, 'Someone you know') || ' made you a co-organizer of ' || coalesce(v_title, 'their occasion') || '.',
          'data', jsonb_build_object('type', 'occasion_group_plan_decided', 'plan_id', plan_id_param)
        )
      );
    end if;
  end if;
end;
$function$;

revoke all on function public.set_occasion_group_plan_organizer(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_occasion_group_plan_organizer(uuid, uuid, boolean) to authenticated;

-- ---- Organizers can invite more guests ----
-- Mirrors create_occasion_group_plan's own invite loop exactly (surprise-
-- mode skip, block check, real-connection-only eligibility) rather than
-- extracting a shared helper -- keeps the already-verified create function
-- completely untouched, at the cost of some duplication.

create or replace function public.invite_more_to_occasion_group_plan(plan_id_param uuid, invitee_ids_param uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_can_invite boolean;
  v_invitee_id uuid;
  v_invited_count integer := 0;
  service_key text;
  v_host_name text;
  v_wants_notif boolean;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param;
  if v_plan is null then
    raise exception 'This plan does not exist.';
  end if;
  if v_plan.status <> 'voting' then
    raise exception 'This plan is no longer open for new invites.';
  end if;

  select (v_plan.host_id = auth.uid()) or exists (
    select 1 from occasion_group_plan_participants
    where group_plan_id = plan_id_param and user_id = auth.uid() and status = 'joined' and is_organizer
  ) into v_can_invite;
  if not v_can_invite then
    raise exception 'Only the host or an organizer can invite more people.';
  end if;

  if invitee_ids_param is not null and array_length(invitee_ids_param, 1) > 0 then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select display_name into v_host_name from profiles where id = auth.uid();

    foreach v_invitee_id in array invitee_ids_param loop
      continue when v_invitee_id = v_plan.host_id;
      continue when is_blocked(auth.uid(), v_invitee_id);
      continue when v_plan.surprise_mode and v_plan.who_for_friend_id is not null and v_invitee_id = v_plan.who_for_friend_id;

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

      begin
        insert into occasion_group_plan_participants (group_plan_id, user_id, status)
        values (plan_id_param, v_invitee_id, 'invited');
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
            'title', '🗳️ You''re invited to plan together',
            'body', coalesce(v_host_name, 'Someone you know') || ' wants your vote on ' || v_plan.title || '.',
            'data', jsonb_build_object('type', 'occasion_group_plan_invite', 'plan_id', plan_id_param)
          )
        );
      end if;
    end loop;
  end if;

  return jsonb_build_object('invitedCount', v_invited_count);
end;
$function$;

revoke all on function public.invite_more_to_occasion_group_plan(uuid, uuid[]) from public, anon;
grant execute on function public.invite_more_to_occasion_group_plan(uuid, uuid[]) to authenticated;

-- ---- Read paths: surface budget/organizer fields to the client ----

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
        'activityType', o.activity_type,
        'label', o.label,
        'proposedBy', o.proposed_by,
        'voteCount', (select count(*) from occasion_group_plan_votes v where v.option_id = o.id),
        'myVote', exists (select 1 from occasion_group_plan_votes v where v.option_id = o.id and v.voter_id = auth.uid())
      ) order by o.created_at)
      from occasion_group_plan_options o
      where o.group_plan_id = plan_id_param
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_occasion_group_plan_detail(uuid) from public, anon;
grant execute on function public.get_occasion_group_plan_detail(uuid) to authenticated;

-- ---- decide_occasion_group_plan: also return budgetMin/budgetMax ----
-- Unchanged signature -- a plain CREATE OR REPLACE is safe. Lets
-- resolveDecidedGroupPlanParams() carry the plan's own real budget forward
-- into the wizard's post-decide "find options nearby" step and the
-- resulting business_requests row (create_business_request already has
-- budget_min_param/budget_max_param -- pure client wiring from here).

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

revoke all on function public.decide_occasion_group_plan(uuid, uuid) from public, anon;
grant execute on function public.decide_occasion_group_plan(uuid, uuid) to authenticated;
