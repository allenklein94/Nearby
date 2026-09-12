-- "Group voting for Occasions" (CLAUDE.md, direct user follow-up to the
-- Occasion rename/simplify pass). User's example: "Sarah's 30th Birthday,"
-- invite 8 friends, everyone proposes/votes on what to do (Italian dinner /
-- Bowling / Concert), Nearby turns the winner into a real plan via the
-- existing business pipeline. User's own explicit guardrail: don't build a
-- giant event-management platform -- no RSVP complexity, no elaborate
-- invitations, no gift registries, no seating charts, no massive event
-- pages, no complicated calendars.
--
-- Confirmed before writing this (grepped the whole schema): there is no
-- existing voting/polling mechanism anywhere. group_plan_proposals/
-- group_plan_participants (20260815_v3_group_plans_phase_d.sql) is a
-- genuinely different thing -- it MERGES N people's own already-submitted,
-- already-specific business_requests rows (each participant needs a real
-- source_request_id) into one shared request. It has no concept of
-- proposing named alternatives and voting among them, so it isn't reused
-- here; this is a small, new, purpose-built data model instead.
--
-- Everything DOWNSTREAM of "the group has decided" is deliberately NOT
-- rebuilt here -- CelebrateSomethingScreen's own existing 'when' -> 'options'
-- tail (resolveIntent()/assembleExperience()/submitBusinessRequest) already
-- does the full find-businesses -> availability -> offer -> reservation
-- pipeline; the client hands off into it via ordinary route params (see
-- CelebrateSomethingScreen.js's own comment at initialStepFor()).
--
-- RLS posture: all four tables are RLS-enabled with ZERO client-facing
-- policies -- every read and write goes through a SECURITY DEFINER RPC
-- that self-checks authorization, same posture as recommendation_push_log.
-- This sidesteps the RLS-recursion class of bug this schema has hit before
-- (business_request_offers/business_requests' own SELECT policies needed a
-- SECURITY DEFINER helper for exactly this reason -- see that migration's
-- own comment) rather than risking a fifth variant of it here.

create table public.occasion_group_plans (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  -- The wizard's own CELEBRATE_OCCASION_KEYS vocabulary (businessAttributes.js)
  -- -- the exact subset its 'occasion' step actually offers, not the full
  -- OCCASION_OPTIONS list (which also has date_night/celebration/etc., never
  -- shown as a choice at that step).
  occasion_type text not null check (occasion_type in (
    'birthday', 'anniversary', 'graduation', 'baby_shower', 'engagement',
    'housewarming', 'promotion', 'farewell', 'milestone', 'other'
  )),
  title text not null,
  -- Same "only ever a real connected id when explicitly picked, never
  -- inferred from a typed name" discipline as occasions.connected_user_id.
  who_for_name text,
  who_for_friend_id uuid references public.profiles(id) on delete set null,
  when_preset text,
  scheduled_date date,
  status text not null default 'voting' check (status in ('voting', 'decided', 'cancelled')),
  -- FK added below, once occasion_group_plan_options exists.
  winning_option_id uuid,
  decided_at timestamptz,
  cancelled_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create index occasion_group_plans_host_id_idx on public.occasion_group_plans(host_id);

create table public.occasion_group_plan_participants (
  id uuid primary key default gen_random_uuid(),
  group_plan_id uuid not null references public.occasion_group_plans(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'joined', 'declined')),
  invited_at timestamptz not null default now(),
  responded_at timestamptz,
  unique(group_plan_id, user_id)
);

create index occasion_group_plan_participants_plan_idx on public.occasion_group_plan_participants(group_plan_id);
create index occasion_group_plan_participants_user_idx on public.occasion_group_plan_participants(user_id);

create table public.occasion_group_plan_options (
  id uuid primary key default gen_random_uuid(),
  group_plan_id uuid not null references public.occasion_group_plans(id) on delete cascade,
  -- The wizard's own 7 ACTIVITY_OPTIONS keys (CelebrateSomethingScreen.js)
  -- -- so a winning option deterministically maps onto the wizard's own
  -- resolveCelebrationDestination(), never a free-floating label with no
  -- real downstream routing.
  activity_type text not null check (activity_type in (
    'dinner', 'party', 'surprise', 'activity', 'night_out', 'weekend_trip', 'custom'
  )),
  label text,
  proposed_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index occasion_group_plan_options_plan_idx on public.occasion_group_plan_options(group_plan_id);

alter table public.occasion_group_plans
  add constraint occasion_group_plans_winning_option_fkey
  foreign key (winning_option_id) references public.occasion_group_plan_options(id);

create table public.occasion_group_plan_votes (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.occasion_group_plan_options(id) on delete cascade,
  voter_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(option_id, voter_id)
);

create index occasion_group_plan_votes_option_idx on public.occasion_group_plan_votes(option_id);
create index occasion_group_plan_votes_voter_idx on public.occasion_group_plan_votes(voter_id);

alter table public.occasion_group_plans enable row level security;
alter table public.occasion_group_plan_participants enable row level security;
alter table public.occasion_group_plan_options enable row level security;
alter table public.occasion_group_plan_votes enable row level security;

-- ---- Helper ----

create or replace function public.is_occasion_group_plan_participant(plan_id_param uuid, uid uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.occasion_group_plans p
    where p.id = plan_id_param and p.host_id = uid
  ) or exists (
    select 1 from public.occasion_group_plan_participants pp
    where pp.group_plan_id = plan_id_param and pp.user_id = uid
  );
$$;

revoke all on function public.is_occasion_group_plan_participant(uuid, uuid) from public, anon;
grant execute on function public.is_occasion_group_plan_participant(uuid, uuid) to authenticated;

-- ---- RPCs ----

create or replace function public.create_occasion_group_plan(
  occasion_type_param text,
  title_param text,
  who_for_name_param text,
  who_for_friend_id_param uuid,
  when_preset_param text,
  scheduled_date_param date,
  invitee_ids_param uuid[]
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
    host_id, occasion_type, title, who_for_name, who_for_friend_id, when_preset, scheduled_date
  ) values (
    auth.uid(), occasion_type_param, trim(title_param), who_for_name_param, who_for_friend_id_param,
    when_preset_param, scheduled_date_param
  ) returning id into v_plan_id;

  insert into occasion_group_plan_participants (group_plan_id, user_id, status, responded_at)
  values (v_plan_id, auth.uid(), 'joined', now());

  if invitee_ids_param is not null and array_length(invitee_ids_param, 1) > 0 then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select display_name into v_host_name from profiles where id = auth.uid();

    foreach v_invitee_id in array invitee_ids_param loop
      continue when v_invitee_id = auth.uid();
      continue when is_blocked(auth.uid(), v_invitee_id);

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

revoke all on function public.create_occasion_group_plan(text, text, text, uuid, text, date, uuid[]) from public, anon;
grant execute on function public.create_occasion_group_plan(text, text, text, uuid, text, date, uuid[]) to authenticated;

create or replace function public.respond_to_occasion_group_plan(plan_id_param uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update occasion_group_plan_participants
  set status = case when accept then 'joined' else 'declined' end, responded_at = now()
  where group_plan_id = plan_id_param and user_id = auth.uid() and status = 'invited';

  if not found then
    raise exception 'No pending invite found for this plan.';
  end if;
end;
$function$;

revoke all on function public.respond_to_occasion_group_plan(uuid, boolean) from public, anon;
grant execute on function public.respond_to_occasion_group_plan(uuid, boolean) to authenticated;

create or replace function public.propose_occasion_option(plan_id_param uuid, activity_type_param text, label_param text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_is_joined boolean;
  v_option_count integer;
  v_option_id uuid;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param;
  if v_plan is null then
    raise exception 'This plan no longer exists.';
  end if;
  if v_plan.status <> 'voting' then
    raise exception 'Voting is closed on this plan.';
  end if;

  select exists (
    select 1 from occasion_group_plan_participants
    where group_plan_id = plan_id_param and user_id = auth.uid() and status = 'joined'
  ) into v_is_joined;
  if not v_is_joined then
    raise exception 'Only people who joined this plan can add options.';
  end if;

  select count(*) into v_option_count from occasion_group_plan_options where group_plan_id = plan_id_param;
  if v_option_count >= 8 then
    raise exception 'This plan already has the maximum number of options.';
  end if;

  insert into occasion_group_plan_options (group_plan_id, activity_type, label, proposed_by)
  values (plan_id_param, activity_type_param, nullif(trim(coalesce(label_param, '')), ''), auth.uid())
  returning id into v_option_id;

  return v_option_id;
end;
$function$;

revoke all on function public.propose_occasion_option(uuid, text, text) from public, anon;
grant execute on function public.propose_occasion_option(uuid, text, text) to authenticated;

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
  if v_plan.status <> 'voting' then
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
    'partySize', greatest(v_party_size, 1)
  );
end;
$function$;

revoke all on function public.decide_occasion_group_plan(uuid, uuid) from public, anon;
grant execute on function public.decide_occasion_group_plan(uuid, uuid) to authenticated;

create or replace function public.cancel_occasion_group_plan(plan_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update occasion_group_plans
  set status = 'cancelled', cancelled_at = now()
  where id = plan_id_param and host_id = auth.uid() and status = 'voting';

  if not found then
    raise exception 'This plan cannot be cancelled.';
  end if;
end;
$function$;

revoke all on function public.cancel_occasion_group_plan(uuid) from public, anon;
grant execute on function public.cancel_occasion_group_plan(uuid) to authenticated;

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
