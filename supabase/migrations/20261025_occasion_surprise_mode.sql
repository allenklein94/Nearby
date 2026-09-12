-- Item 65 (CLAUDE.md, direct user request): "Let the organizer keep the
-- occasion private... Maybe I'm planning a surprise birthday. The birthday
-- person should not automatically see: Allen is planning your birthday."
-- User's own spec: a "Surprise mode 🔒" toggle -- keep this occasion hidden
-- from the person being celebrated, while invited organizers can still
-- collaborate without exposing the plan.
--
-- Real leak audit before writing this (checked every path that could tell
-- the celebrated person something is being planned about them):
--   1. occasions.connected_user_id (Items 62's "share this too" checkbox,
--      default OFF but opt-in-able) grants the named person real read
--      access via get_upcoming_occasions() -- if the celebrated person IS
--      the connected friend (the normal case: who_for_friend_id and
--      connected_user_id are always the same real id in this app), turning
--      that share on would show them their own surprise on their own
--      Occasions screen. This is the literal "Allen is planning your
--      birthday" example.
--   2. occasion_group_plans' own invitee list (create_occasion_group_plan)
--      has nothing today stopping an organizer from accidentally selecting
--      the celebrated person themselves as one of the "friends to invite
--      to vote" -- they're a real connected friend of the host like anyone
--      else on that chip list.
--   3. The eventual resulting Gathering's visibility -- checked and found
--      ALREADY SAFE: resolveCelebrationVisibility() (celebrateSomething.js)
--      already resolves every group-planning-reachable path to
--      'invite_only' (the narrowest level; only 'existing_group' maps to
--      'community', a deliberate organizer choice to loop in a whole
--      community, out of scope here) -- so the interest-matched discovery
--      pushes (notify_matching_things_to_do etc.), which only ever fire
--      for visibility = 'everyone', can never reach the celebrated person
--      through this path. No change needed for this one.
--
-- This migration closes gaps 1 and 2, with real database-level guarantees,
-- not just client-side hiding:
--   - occasions.surprise_mode (default false) + a CHECK constraint that
--     makes it structurally impossible for a surprise occasion to also
--     have connected_user_id set, regardless of what the client sends.
--   - occasion_group_plans.surprise_mode (default false), carried from the
--     occasion's own flag at creation time.
--   - create_occasion_group_plan's own invite loop now skips who_for_
--     friend_id when surprise_mode is on (a clean early-skip, so creating
--     the rest of the plan still succeeds even if the organizer's invite
--     list accidentally included the celebrated person).
--   - A BEFORE INSERT trigger on occasion_group_plan_participants is a
--     second, structural backstop against the same thing -- covers any
--     future insert path into that table, not just this one RPC, same
--     defense-in-depth discipline this schema already applies elsewhere
--     (e.g. get_upcoming_occasions() re-checking friendship at read time
--     rather than trusting who was connected at creation time).
-- get_occasion_group_plan_detail / get_my_occasion_group_plans both now
-- also return surpriseMode so the client can show a real "🔒 Surprise
-- Mode" indicator to invited collaborators.

alter table public.occasions
  add column if not exists surprise_mode boolean not null default false;

alter table public.occasions drop constraint if exists occasions_surprise_no_share_check;
alter table public.occasions
  add constraint occasions_surprise_no_share_check
  check (not surprise_mode or connected_user_id is null);

alter table public.occasion_group_plans
  add column if not exists surprise_mode boolean not null default false;

-- ---- Defense-in-depth trigger ----

create or replace function public.prevent_surprise_group_plan_leak()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
begin
  select surprise_mode, who_for_friend_id into v_plan
  from occasion_group_plans where id = new.group_plan_id;

  if v_plan.surprise_mode and v_plan.who_for_friend_id is not null and new.user_id = v_plan.who_for_friend_id then
    raise exception 'This occasion is in surprise mode -- the person it''s for can''t be added as a participant.';
  end if;

  return new;
end;
$function$;

drop trigger if exists prevent_surprise_group_plan_leak_trigger on public.occasion_group_plan_participants;
create trigger prevent_surprise_group_plan_leak_trigger
before insert on public.occasion_group_plan_participants
for each row execute function public.prevent_surprise_group_plan_leak();

-- ---- create_occasion_group_plan: new trailing surprise_mode_param ----
-- Per this repo's own standing convention, a changed parameter list -- even
-- a new trailing default -- creates a second overload rather than replacing
-- the original; explicit drop of the old 7-arg signature first.

drop function if exists public.create_occasion_group_plan(text, text, text, uuid, text, date, uuid[]);

create or replace function public.create_occasion_group_plan(
  occasion_type_param text,
  title_param text,
  who_for_name_param text,
  who_for_friend_id_param uuid,
  when_preset_param text,
  scheduled_date_param date,
  invitee_ids_param uuid[],
  surprise_mode_param boolean default false
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

  insert into occasion_group_plans (
    host_id, occasion_type, title, who_for_name, who_for_friend_id, when_preset, scheduled_date, surprise_mode
  ) values (
    auth.uid(), occasion_type_param, trim(title_param), who_for_name_param, who_for_friend_id_param,
    when_preset_param, scheduled_date_param, coalesce(surprise_mode_param, false)
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

revoke all on function public.create_occasion_group_plan(text, text, text, uuid, text, date, uuid[], boolean) from public, anon;
grant execute on function public.create_occasion_group_plan(text, text, text, uuid, text, date, uuid[], boolean) to authenticated;

-- ---- Read paths: surface surpriseMode to the client ----

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
    'myStatus', (
      select status from occasion_group_plan_participants
      where group_plan_id = plan_id_param and user_id = auth.uid()
    ),
    'participants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', pp.user_id, 'displayName', pr.display_name, 'status', pp.status
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

create or replace function public.get_my_occasion_group_plans()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'occasionType', p.occasion_type,
    'status', p.status,
    'isHost', p.host_id = auth.uid(),
    'surpriseMode', p.surprise_mode,
    'createdAt', p.created_at
  ) order by p.created_at desc), '[]'::jsonb)
  from occasion_group_plans p
  where p.host_id = auth.uid()
  or exists (
    select 1 from occasion_group_plan_participants pp
    where pp.group_plan_id = p.id and pp.user_id = auth.uid()
  );
$$;

revoke all on function public.get_my_occasion_group_plans() from public, anon;
grant execute on function public.get_my_occasion_group_plans() to authenticated;

-- ---- decide_occasion_group_plan: also return surpriseMode ----
-- Unchanged signature (still 2 args) -- a plain CREATE OR REPLACE is safe
-- here, no overload risk. Without this, resolveDecidedGroupPlanParams()
-- (celebrateSomething.js) can't carry surprise_mode forward into the
-- wizard's post-decide "find options nearby" step, which would silently
-- re-show a "share with friend" checkbox as if nothing had ever been
-- hidden -- still opt-in/default-off, but loses the surprise context.

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
    'surpriseMode', v_plan.surprise_mode
  );
end;
$function$;

revoke all on function public.decide_occasion_group_plan(uuid, uuid) from public, anon;
grant execute on function public.decide_occasion_group_plan(uuid, uuid) to authenticated;
