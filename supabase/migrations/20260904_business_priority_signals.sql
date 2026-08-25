-- Business Intelligence & Opportunity Engine, Phase 1 -- the "Business
-- Priority Engine" (spec item 25): a real, time-bounded "want more of X
-- right now, until a real deadline" layer, additive to (never replacing)
-- the existing *permanent* priority_attributes/priority_time_windows
-- columns on brand_partners (Business Story Phase 2 /
-- 20260903_business_dna_goals_pulse.sql) -- those answer "what do we
-- generally want," this answers "what do we want more of this week"
-- without permanently rewriting the business's own stated identity for a
-- one-week goal.
--
-- category reuses business_requests' own real, current 26-tag category
-- vocabulary (INTEREST_OPTIONS -- widened to include Faith & Spirituality/
-- Dating by 20260902_widen_business_category_checks.sql; not the 8-tag
-- attribute vocabulary priority_attributes uses), since this is meant to
-- eventually be matched against real business_requests rows by the
-- Opportunity Engine (Phase 2) -- the same real signal that table already
-- carries. Checked the live constraint before writing this, not assumed
-- from the table's own original migration, which is now stale relative to
-- the later widening.

create table if not exists public.business_priority_signals (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.brand_partners(id) on delete cascade,
  category text not null,
  strength numeric(3,2) not null default 1.0,
  active boolean not null default true,
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint business_priority_signals_category_check check (category in (
    'Travel', 'Coffee', 'Hiking', 'Music', 'Movies', 'Foodie', 'Fitness',
    'Reading', 'Art', 'Gaming', 'Photography', 'Yoga', 'Dancing', 'Cooking',
    'Wine', 'Dogs', 'Cats', 'Outdoors', 'Sports', 'Concerts', 'Museums',
    'Volunteering', 'Meditation', 'Running', 'Faith & Spirituality', 'Dating'
  )),
  constraint business_priority_signals_strength_check check (strength > 0 and strength <= 1),
  constraint business_priority_signals_expiry_check check (expires_at > starts_at)
);

-- Only one *active* signal per (partner, category) -- re-setting the same
-- category refreshes it (see set_business_priority_signal's own upsert),
-- never accumulates duplicate live rows.
create unique index if not exists business_priority_signals_active_idx
  on public.business_priority_signals (partner_id, category)
  where active;

create index if not exists business_priority_signals_partner_idx
  on public.business_priority_signals (partner_id) where active;

alter table public.business_priority_signals enable row level security;

create policy "Business owners can view their own priority signals"
  on public.business_priority_signals for select
  using (exists (
    select 1 from public.profiles
    where profiles.id = auth.uid() and profiles.managed_partner_id = business_priority_signals.partner_id
  ));

create or replace function public.set_business_priority_signal(
  partner_id_param uuid,
  category_param text,
  strength_param numeric,
  expires_at_param timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'You do not manage this business.';
  end if;

  if expires_at_param <= now() then
    raise exception 'Expiry must be in the future.';
  end if;

  insert into business_priority_signals (partner_id, category, strength, expires_at)
  values (partner_id_param, category_param, coalesce(strength_param, 1.0), expires_at_param)
  on conflict (partner_id, category) where active
  do update set strength = excluded.strength, expires_at = excluded.expires_at, starts_at = now(), active = true
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.set_business_priority_signal(uuid, text, numeric, timestamptz) from public, anon;
grant execute on function public.set_business_priority_signal(uuid, text, numeric, timestamptz) to authenticated;

create or replace function public.clear_business_priority_signal(signal_id_param uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_partner_id uuid;
begin
  select partner_id into v_partner_id from business_priority_signals where id = signal_id_param;

  if not found then
    raise exception 'Priority signal not found.';
  end if;

  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = v_partner_id
  ) then
    raise exception 'You do not manage this business.';
  end if;

  update business_priority_signals set active = false where id = signal_id_param;
end;
$$;

revoke all on function public.clear_business_priority_signal(uuid) from public, anon;
grant execute on function public.clear_business_priority_signal(uuid) to authenticated;

-- Fold the expiry sweep into the existing hourly cron job rather than a
-- new one -- matches this schema's own established "one cron job, several
-- expiry checks" convention (expire_stale_business_requests already
-- expires business_requests/business_availability/group_plan rows in one
-- pass). Live body pulled fresh via the Management API before this edit
-- and reproduced byte-for-byte below, plus one new statement appended --
-- every other line is unchanged from what's actually live in production.
create or replace function public.expire_stale_business_requests()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update business_request_offers
  set status = 'expired'
  where status in ('pending', 'offered')
  and request_id in (
    select id from business_requests where status = 'open' and expires_at < now()
  );

  update business_requests
  set status = 'expired'
  where status = 'open' and expires_at < now();

  update business_request_offers
  set status = 'expired'
  where status in ('pending', 'offered')
  and availability_id in (
    select id from business_availability where status = 'active' and ends_at < now()
  );

  update business_availability
  set status = 'expired'
  where status = 'active' and ends_at < now();

  -- Finding C3's other real half, same reasoning as cancel_group_plan
  -- above: free a stale, never-decided proposal's own participants
  -- (this migration's new partial unique index) in the same sweep that
  -- expires the proposal itself, not a separate pass.
  update group_plan_participants
  set status = 'left'
  where status in ('invited', 'accepted')
  and proposal_id in (
    select id from group_plan_proposals where status = 'pending' and expires_at < now()
  );

  update group_plan_proposals
  set status = 'expired'
  where status = 'pending' and expires_at < now();

  -- New this migration: a business priority signal is a real, honest
  -- "temporary" claim -- once its own stated deadline passes it must stop
  -- being active, the same way an expired business_availability posting
  -- stops being matchable, rather than silently staying "active" forever.
  update business_priority_signals
  set active = false
  where active and expires_at < now();
end;
$$;

-- Cron-only function -- matches the Aug 16 hygiene fix already applied to
-- this function live (revoked from authenticated too, since it only ever
-- runs via pg_cron as postgres, never a direct client call).
revoke all on function public.expire_stale_business_requests() from public, anon, authenticated;
