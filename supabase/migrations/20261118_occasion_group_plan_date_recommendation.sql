-- Item 99 (CLAUDE.md, "Let Nearby recommend when to celebrate"). User's own
-- example: "If the birthday is Wednesday but most invited people are
-- unavailable: Saturday has the most availability among your guests. Then:
-- Plan for Saturday?" -- calendar availability, social planning, and
-- recommendation intelligence starting to come together. Originally logged
-- to the Backlog as an explicit "future, not now" item; the user then said
-- "no build it now" in direct follow-up, overriding that.
--
-- What "calendar availability" can honestly mean here: Item 75's device
-- calendar read access is permission-scoped to the CALLER's own device and
-- is never uploaded to Nearby's servers (Item 76's own locked "Calendar =
-- when, Nearby = what+who+where+how" boundary) -- there is no mechanism
-- anywhere in this schema for a host to read an INVITEE's calendar, and
-- building one would be a much bigger, separate privacy decision than this
-- item asks for. So this is built as a real, lightweight AVAILABILITY POLL
-- among the plan's own already-real, already-connected guest roster
-- (occasion_group_plan_participants) instead -- honest, non-fabricated
-- data (a person explicitly marks which candidate day(s) work for them),
-- not an inferred guess from any calendar. "Recommendation intelligence"
-- here is the plainest possible honest thing: whichever candidate date has
-- the most real "I'm free" marks, computed server-side, never AI-guessed --
-- consistent with this app's own standing "no fabricated signals" rule.
--
-- Deliberately its OWN pair of tables rather than reusing
-- occasion_group_plan_options/_votes (the existing WHAT-to-do voting
-- mechanism, 20261020_occasion_group_plans.sql): those feed
-- decide_occasion_group_plan's activity-type branching logic directly
-- (v_is_business := v_option.activity_type in (...)), and a "vote" there
-- means "I prefer this," not "I am free this day" -- conflating the two
-- would mean either teaching that function to skip date-kind options (easy
-- to get wrong later) or accepting that a date option silently becomes
-- eligible to be "decided" as if it were an activity choice. A separate,
-- narrower pair of tables makes the wrong states structurally
-- unrepresentable instead.
--
-- Design: occasion_group_plan_date_options holds real candidate dates
-- (auto-seeded from the occasion's own already-known scheduled_date, if
-- any, plus whatever the host explicitly proposes afterward --
-- deterministic, never AI-inferred, matching this app's own standing "AI
-- never infers or assigns a specific date/time" rule). Any joined
-- participant marks themselves available for as many of those candidate
-- dates as genuinely apply (occasion_group_plan_date_availability, a
-- simple insert-or-delete toggle -- the exact same shape
-- occasion_group_plan_votes already uses for "vote"/"un-vote"). The date
-- option with the most real marks is surfaced back as `isTopRecommendation`
-- -- but ONLY once at least one real mark exists anywhere, so an
-- unanswered poll never fabricates a "recommendation" out of a 0-0 tie.
-- The host applying it (set_occasion_group_plan_date) is a real, separate,
-- explicit action -- "Plan for Saturday?" is a question Nearby asks, never
-- something it silently decides on the group's behalf.

create table public.occasion_group_plan_date_options (
  id uuid primary key default gen_random_uuid(),
  group_plan_id uuid not null references public.occasion_group_plans(id) on delete cascade,
  option_date date not null,
  proposed_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(group_plan_id, option_date)
);

create index occasion_group_plan_date_options_plan_idx on public.occasion_group_plan_date_options(group_plan_id);

create table public.occasion_group_plan_date_availability (
  id uuid primary key default gen_random_uuid(),
  date_option_id uuid not null references public.occasion_group_plan_date_options(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(date_option_id, user_id)
);

create index occasion_group_plan_date_availability_option_idx on public.occasion_group_plan_date_availability(date_option_id);
create index occasion_group_plan_date_availability_user_idx on public.occasion_group_plan_date_availability(user_id);

-- RLS enabled, zero client-facing policies -- every read/write goes
-- through a SECURITY DEFINER RPC below, same posture as every other table
-- in this occasion_group_plan_* family.
alter table public.occasion_group_plan_date_options enable row level security;
alter table public.occasion_group_plan_date_availability enable row level security;

-- ---- create_occasion_group_plan: auto-seed the occasion's own known
-- target date as candidate #1, when one was already given. Matches the
-- item's own literal example ("If the birthday is Wednesday...") -- the
-- known date is always the natural first candidate, not something the
-- host has to re-type as a "proposed" date. Unchanged signature (an
-- 11-arg CREATE OR REPLACE is safe) -- reproduced in full from its current
-- live body (confirmed via pg_get_functiondef before writing this) with
-- exactly one addition at the end of the plan-insert block.

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
  budget_max_param integer default null,
  experience_level_param text default null
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
  if experience_level_param is not null and experience_level_param not in ('simple', 'special', 'go_all_out') then
    raise exception 'Invalid experience level';
  end if;

  insert into occasion_group_plans (
    host_id, occasion_type, title, who_for_name, who_for_friend_id, when_preset, scheduled_date,
    surprise_mode, budget_min, budget_max, experience_level
  ) values (
    auth.uid(), occasion_type_param, trim(title_param), who_for_name_param, who_for_friend_id_param,
    when_preset_param, scheduled_date_param, coalesce(surprise_mode_param, false), budget_min_param, budget_max_param,
    experience_level_param
  ) returning id into v_plan_id;

  insert into occasion_group_plan_participants (group_plan_id, user_id, status, responded_at)
  values (v_plan_id, auth.uid(), 'joined', now());

  -- Item 99: the occasion's own already-known date is the natural first
  -- real candidate -- never fabricated, it's exactly what the host already
  -- typed into this same call.
  if scheduled_date_param is not null then
    insert into occasion_group_plan_date_options (group_plan_id, option_date, proposed_by)
    values (v_plan_id, scheduled_date_param, auth.uid())
    on conflict (group_plan_id, option_date) do nothing;
  end if;

  if invitee_ids_param is not null and array_length(invitee_ids_param, 1) > 0 then
    select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
    select display_name into v_host_name from profiles where id = auth.uid();

    foreach v_invitee_id in array invitee_ids_param loop
      continue when v_invitee_id = auth.uid();
      continue when is_blocked(auth.uid(), v_invitee_id);
      continue when coalesce(surprise_mode_param, false) and who_for_friend_id_param is not null and v_invitee_id = who_for_friend_id_param;

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

-- ---- propose_occasion_group_plan_dates: host-only, adds up to 6 total
-- real candidate dates. Mirrors propose_occasion_business_options' own
-- host-only, capped-slot shape.

create or replace function public.propose_occasion_group_plan_dates(plan_id_param uuid, dates_param date[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_existing_count integer;
  v_remaining_slots integer;
  v_date date;
  v_proposed_count integer := 0;
begin
  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if v_plan is null then
    raise exception 'You are not the host of this plan.';
  end if;
  if v_plan.status in ('cancelled', 'fulfilled') then
    raise exception 'This plan is no longer open for scheduling.';
  end if;

  select count(*) into v_existing_count from occasion_group_plan_date_options where group_plan_id = plan_id_param;
  v_remaining_slots := greatest(0, 6 - v_existing_count);

  if dates_param is not null then
    foreach v_date in array dates_param loop
      exit when v_remaining_slots <= 0;
      continue when v_date is null;
      begin
        insert into occasion_group_plan_date_options (group_plan_id, option_date, proposed_by)
        values (plan_id_param, v_date, auth.uid());
        v_proposed_count := v_proposed_count + 1;
        v_remaining_slots := v_remaining_slots - 1;
      exception when unique_violation then
        continue;
      end;
    end loop;
  end if;

  return jsonb_build_object('proposedCount', v_proposed_count);
end;
$function$;

revoke all on function public.propose_occasion_group_plan_dates(uuid, date[]) from public, anon;
grant execute on function public.propose_occasion_group_plan_dates(uuid, date[]) to authenticated;

-- ---- mark_occasion_date_availability: any joined participant, toggles
-- their own "I'm free this day" mark. Same insert-on-conflict-do-nothing /
-- delete toggle shape as cast_occasion_vote.

create or replace function public.mark_occasion_date_availability(date_option_id_param uuid, available_param boolean)
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
  select * into v_option from occasion_group_plan_date_options where id = date_option_id_param;
  if v_option is null then
    raise exception 'This date option no longer exists.';
  end if;

  select * into v_plan from occasion_group_plans where id = v_option.group_plan_id;
  if v_plan.status in ('cancelled', 'fulfilled') then
    raise exception 'This plan is no longer open for scheduling.';
  end if;

  select exists (
    select 1 from occasion_group_plan_participants
    where group_plan_id = v_option.group_plan_id and user_id = auth.uid() and status = 'joined'
  ) into v_is_joined;
  if not v_is_joined then
    raise exception 'Only people who joined this plan can mark availability.';
  end if;

  if available_param then
    insert into occasion_group_plan_date_availability (date_option_id, user_id)
    values (date_option_id_param, auth.uid())
    on conflict (date_option_id, user_id) do nothing;
  else
    delete from occasion_group_plan_date_availability where date_option_id = date_option_id_param and user_id = auth.uid();
  end if;
end;
$function$;

revoke all on function public.mark_occasion_date_availability(uuid, boolean) from public, anon;
grant execute on function public.mark_occasion_date_availability(uuid, boolean) to authenticated;

-- ---- set_occasion_group_plan_date: host-only, the real "Plan for
-- Saturday?" action -- sets the plan's own real scheduled_date and
-- notifies every other joined participant, same notify shape
-- decide_occasion_group_plan already uses.

create or replace function public.set_occasion_group_plan_date(plan_id_param uuid, scheduled_date_param date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan record;
  service_key text;
  v_participant record;
  v_wants_notif boolean;
  v_date_text text;
begin
  if scheduled_date_param is null then
    raise exception 'A real date is required.';
  end if;

  select * into v_plan from occasion_group_plans where id = plan_id_param and host_id = auth.uid() for update;
  if v_plan is null then
    raise exception 'You are not the host of this plan.';
  end if;
  if v_plan.status in ('cancelled', 'fulfilled') then
    raise exception 'This plan is no longer open for scheduling.';
  end if;

  update occasion_group_plans
  set scheduled_date = scheduled_date_param, when_preset = 'custom'
  where id = plan_id_param;

  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';
  v_date_text := to_char(scheduled_date_param, 'FMDay, FMMonth FMDD');

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
          'title', '📅 The date is set!',
          'body', v_plan.title || ' is now planned for ' || v_date_text || '.',
          'data', jsonb_build_object('type', 'occasion_group_plan_date_set', 'plan_id', plan_id_param)
        )
      );
    end if;
  end loop;
end;
$function$;

revoke all on function public.set_occasion_group_plan_date(uuid, date) from public, anon;
grant execute on function public.set_occasion_group_plan_date(uuid, date) to authenticated;

-- ---- get_occasion_group_plan_detail: also return dateOptions (each with
-- a real availableCount/myAvailable) and flag whichever one currently has
-- the most real marks as isTopRecommendation -- but only once at least one
-- real mark exists anywhere, so an unanswered poll never fabricates a
-- "recommendation." Unchanged signature -- safe CREATE OR REPLACE,
-- reproduced in full from its current live body (confirmed via
-- pg_get_functiondef) with the new declare + top-pick lookup + one new
-- jsonb_build_object key.

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
  v_top_date_option_id uuid;
begin
  if not is_occasion_group_plan_participant(plan_id_param, auth.uid()) then
    raise exception 'You are not part of this plan.';
  end if;

  select * into v_plan from occasion_group_plans where id = plan_id_param;

  select d.id into v_top_date_option_id
  from occasion_group_plan_date_options d
  where d.group_plan_id = plan_id_param
  order by (select count(*) from occasion_group_plan_date_availability a where a.date_option_id = d.id) desc, d.option_date asc
  limit 1;

  if v_top_date_option_id is not null then
    if (select count(*) from occasion_group_plan_date_availability a where a.date_option_id = v_top_date_option_id) = 0 then
      v_top_date_option_id := null;
    end if;
  end if;

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
    'experienceLevel', v_plan.experience_level,
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
    ), '[]'::jsonb),
    'dateOptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'optionDate', d.option_date,
        'proposedBy', d.proposed_by,
        'availableCount', (select count(*) from occasion_group_plan_date_availability a where a.date_option_id = d.id),
        'myAvailable', exists (select 1 from occasion_group_plan_date_availability a where a.date_option_id = d.id and a.user_id = auth.uid()),
        'isTopRecommendation', d.id = v_top_date_option_id
      ) order by d.option_date)
      from occasion_group_plan_date_options d
      where d.group_plan_id = plan_id_param
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_occasion_group_plan_detail(uuid) from public, anon;
grant execute on function public.get_occasion_group_plan_detail(uuid) to authenticated;
