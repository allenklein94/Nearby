-- Items 105 & 106 (CLAUDE.md, direct user request via AskUserQuestion:
-- "build it now"): "Make invitations frictionless" (Item 72) already gave
-- Gatherings a real, anon-viewable invite-preview page
-- (get_public_gathering_invite_preview / docs/invite.html) -- but that
-- migration explicitly scoped Occasion group plans OUT, calling genuine
-- anonymous-guest access "a materially bigger, separate feature (guest
-- identity, spam/abuse risk)." The user's own example (Sarah's 30th
-- Birthday, 8 invited, 3 aren't Nearby users, each should get a real "You're
-- invited to Sarah's 30th Birthday -- View Plan" link that works with zero
-- install, then an "RSVP"/"Join Nearby" upgrade path) is exactly that
-- bigger feature -- built now, deliberately still bounded:
--
-- * A non-Nearby person is invited BY NAME, not by a shared/generic link --
--   each guest gets their OWN unique, unguessable bearer token
--   (occasion_group_plan_participants.guest_token), so "who RSVP'd" is
--   always a specific named person the host actually typed in, never
--   spoofable by anyone else holding a different guest's link.
-- * A guest can VIEW the plan and RSVP (accept/decline) -- exactly the
--   item's own "view / RSVP / see details" list. Proposing ideas or voting
--   is deliberately NOT extended to guests: that's real collaborative
--   decision-making among people Nearby can already hold accountable
--   (real accounts), and this repo's own backlog guardrail already warns
--   against building "a giant event-management platform." A guest who
--   wants to vote can tap "Join Nearby."
-- * Exactly like the gathering preview, only minimal, non-sensitive fields
--   cross the anon boundary -- no participant list, no budget, no exact
--   business/location detail (that's part of "the full experience," per
--   Item 72's own precedent).

alter table public.occasion_group_plan_participants
  alter column user_id drop not null;

alter table public.occasion_group_plan_participants
  add column if not exists guest_name text,
  add column if not exists guest_token uuid unique default gen_random_uuid();

alter table public.occasion_group_plan_participants
  drop constraint if exists occasion_group_plan_participants_identity_check;
alter table public.occasion_group_plan_participants
  add constraint occasion_group_plan_participants_identity_check
  check (user_id is not null or guest_name is not null);

-- ---- Host/organizer invites a non-Nearby guest by name ----
-- Mirrors invite_more_to_occasion_group_plan's own host-or-organizer
-- authorization check exactly. Capped at 20 guest invites per plan -- a
-- plain, disclosed abuse guard on the one write path that hands out a
-- fresh anon-usable token per call, same spirit as propose_occasion_
-- option's own 8-option cap.

create or replace function public.invite_guest_to_occasion_group_plan(plan_id_param uuid, guest_name_param text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_can_invite boolean;
  v_guest_name text;
  v_guest_count integer;
  v_participant_id uuid;
  v_guest_token uuid;
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

  v_guest_name := nullif(trim(coalesce(guest_name_param, '')), '');
  if v_guest_name is null then
    raise exception 'This guest needs a name.';
  end if;

  select count(*) into v_guest_count from occasion_group_plan_participants
  where group_plan_id = plan_id_param and user_id is null;
  if v_guest_count >= 20 then
    raise exception 'This plan already has the maximum number of guest invites.';
  end if;

  insert into occasion_group_plan_participants (group_plan_id, guest_name, status)
  values (plan_id_param, v_guest_name, 'invited')
  returning id, guest_token into v_participant_id, v_guest_token;

  return jsonb_build_object('participantId', v_participant_id, 'guestToken', v_guest_token, 'guestName', v_guest_name);
end;
$function$;

revoke all on function public.invite_guest_to_occasion_group_plan(uuid, text) from public, anon;
grant execute on function public.invite_guest_to_occasion_group_plan(uuid, text) to authenticated;

-- ---- Public, anon-callable guest view ----
-- Same "fixed return column list, no select *, no requester/participant
-- identity beyond what this one guest already needs" discipline as
-- get_public_gathering_invite_preview. A guest's own token only ever
-- resolves THEIR OWN participant row -- never anyone else's.

create or replace function public.get_public_occasion_group_plan_guest_view(token_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'planId', p.id,
    'occasionType', p.occasion_type,
    'title', p.title,
    'whoForName', p.who_for_name,
    'hostDisplayName', h.display_name,
    'whenPreset', p.when_preset,
    'scheduledDate', p.scheduled_date,
    'planStatus', p.status,
    'guestName', pp.guest_name,
    'guestStatus', pp.status,
    'decidedActivityType', case when p.status in ('decided', 'fulfilled') then o.activity_type else null end,
    'decidedLabel', case when p.status in ('decided', 'fulfilled') then o.label else null end
  )
  into v_result
  from occasion_group_plan_participants pp
  join occasion_group_plans p on p.id = pp.group_plan_id
  join profiles h on h.id = p.host_id
  left join occasion_group_plan_options o on o.id = p.winning_option_id
  where pp.guest_token = token_param and pp.user_id is null;

  return v_result;
end;
$function$;

revoke all on function public.get_public_occasion_group_plan_guest_view(uuid) from public;
grant execute on function public.get_public_occasion_group_plan_guest_view(uuid) to anon, authenticated;

-- ---- Public, anon-callable guest RSVP ----
-- Same "invited -> joined/declined" transition respond_to_occasion_group_
-- plan already applies for a real account, gated by token possession
-- instead of auth.uid(). Notifies the host either way -- a guest RSVP is
-- exactly the kind of update a host would otherwise never learn about.

create or replace function public.respond_to_occasion_group_plan_guest_invite(token_param uuid, accept_param boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_participant record;
  v_plan record;
  v_new_status text;
  service_key text;
  v_wants_notif boolean;
begin
  select * into v_participant from occasion_group_plan_participants
  where guest_token = token_param and user_id is null;
  if v_participant is null then
    raise exception 'This invite link is no longer valid.';
  end if;

  select * into v_plan from occasion_group_plans where id = v_participant.group_plan_id;
  if v_plan is null or v_plan.status = 'cancelled' then
    raise exception 'This plan is no longer available.';
  end if;
  if v_participant.status <> 'invited' then
    raise exception 'This invite has already been responded to.';
  end if;

  v_new_status := case when accept_param then 'joined' else 'declined' end;

  update occasion_group_plan_participants
  set status = v_new_status, responded_at = now()
  where id = v_participant.id;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  select coalesce(notify_planning, true) into v_wants_notif from profiles where id = v_plan.host_id;
  if service_key is not null and v_wants_notif then
    perform net.http_post(
      url := 'https://enmosvippabmuqslzrox.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
      body := jsonb_build_object(
        'recipient_id', v_plan.host_id,
        'title', case when accept_param then '🎉 ' || v_participant.guest_name || ' is in!' else '🙈 ' || v_participant.guest_name || ' can''t make it' end,
        'body', v_participant.guest_name || (case when accept_param then ' is coming to ' else ' can''t make it to ' end) || v_plan.title || '.',
        'data', jsonb_build_object('type', 'occasion_group_plan_guest_rsvp', 'plan_id', v_plan.id)
      )
    );
  end if;

  return jsonb_build_object('guestStatus', v_new_status);
end;
$function$;

revoke all on function public.respond_to_occasion_group_plan_guest_invite(uuid, boolean) from public;
grant execute on function public.respond_to_occasion_group_plan_guest_invite(uuid, boolean) to anon, authenticated;

-- ---- get_occasion_group_plan_detail: surface guest rows to the host/organizers ----
-- Unchanged signature (uuid) -- a plain CREATE OR REPLACE is safe. Every
-- participant now needs a LEFT JOIN (a guest row's user_id is null), and
-- guestToken -- the actual shareable secret -- is only ever included for
-- the host or an organizer (the only people who could have created the
-- invite in the first place), never leaked to a plain fellow guest.

create or replace function public.get_occasion_group_plan_detail(plan_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_can_manage boolean;
  v_result jsonb;
begin
  if not is_occasion_group_plan_participant(plan_id_param, auth.uid()) then
    raise exception 'You are not part of this plan.';
  end if;

  select * into v_plan from occasion_group_plans where id = plan_id_param;

  select (v_plan.host_id = auth.uid()) or exists (
    select 1 from occasion_group_plan_participants
    where group_plan_id = plan_id_param and user_id = auth.uid() and status = 'joined' and is_organizer
  ) into v_can_manage;

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
    'myIsOrganizer', v_can_manage,
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pp.id,
        'userId', pp.user_id,
        'displayName', coalesce(pr.display_name, pp.guest_name),
        'status', pp.status,
        'isOrganizer', pp.is_organizer,
        'isGuest', pp.user_id is null,
        'guestToken', case when v_can_manage and pp.user_id is null then pp.guest_token else null end
      ) order by pp.invited_at)
      from occasion_group_plan_participants pp
      left join profiles pr on pr.id = pp.user_id
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
