-- Sep 14 2026 (CLAUDE.md, "global onboarding -> product wiring" master
-- plan, Phase G) -- the unified Plan object, built exactly to the plan's
-- own locked schema sketch: a thin wrapper/pointer row over the *existing*
-- separate transactions (gatherings, business_requests, date_proposals),
-- never a replacement for any of them. Every already-verified screen/RPC
-- for those three keeps working completely unchanged -- this table is
-- populated additively, by triggers on those three tables, and read by
-- nothing else in this app yet (no client change in this migration).
--
-- Real, disclosed scope limits, not oversights:
--   * gatherings has no status/cancellation column at all (confirmed live
--     before writing this) -- a gathering-sourced plan is created
--     'confirmed' at insert time and never transitions again. A
--     gathering's own real cancellation event still doesn't feed back
--     into anything derived from it, matching the standing, already-
--     disclosed gap named elsewhere in this file for the recommendation
--     engine's own positiveHostIds signal.
--   * plan_type 'birthday'/'anniversary' have no real source table to
--     trigger from yet (birthdays are a live Home nudge computed from
--     profiles.birthdate, never their own row; anniversary is Phase H,
--     not yet built at the time this migration was written) -- both stay
--     real, valid CHECK values with nothing populating them yet, same
--     "ship the column ahead of a live reason to use it" precedent this
--     schema already uses elsewhere (e.g. notify_things_to_do).
--   * business_requests.status = 'merged' (a request absorbed into a
--     Group Plan) is not synced to any plans.status transition -- the
--     plans row stays wherever it was, a real, small, disclosed gap.
--   * a business_requests row already linked to a gathering (gathering_id
--     set) or a match (match_id set) still gets its own plans row --
--     deliberate, not a bug: "find a venue for this gathering" is a real,
--     separate stage from the gathering itself existing, and the wrapper
--     is explicitly thin/additive, never deduplicating.

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  plan_type text not null check (plan_type in (
    'dating_date', 'friend_hangout', 'gathering', 'birthday', 'anniversary', 'business_request'
  )),
  created_by uuid not null references public.profiles(id) on delete cascade,
  title text,
  scheduled_at timestamptz,
  location_lat numeric,
  location_lng numeric,
  location_label text,
  party_size integer,
  budget_max numeric,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'completed', 'cancelled')),
  resulting_gathering_id uuid references public.gatherings(id) on delete cascade,
  resulting_business_request_id uuid references public.business_requests(id) on delete cascade,
  resulting_date_proposal_id uuid references public.date_proposals(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists plans_created_by_idx on public.plans(created_by);
create index if not exists plans_resulting_gathering_idx on public.plans(resulting_gathering_id) where resulting_gathering_id is not null;
create index if not exists plans_resulting_business_request_idx on public.plans(resulting_business_request_id) where resulting_business_request_id is not null;
create index if not exists plans_resulting_date_proposal_idx on public.plans(resulting_date_proposal_id) where resulting_date_proposal_id is not null;

alter table public.plans enable row level security;

drop policy if exists "Users can view their own plans" on public.plans;
create policy "Users can view their own plans"
  on public.plans for select
  using (auth.uid() = created_by);

revoke all on public.plans from public, anon, authenticated;
grant select on public.plans to authenticated;

-- Trigger functions are SECURITY DEFINER so the real client insert (into
-- gatherings/business_requests/date_proposals, by an ordinary authenticated
-- user who has no direct write grant on plans) can still populate the
-- wrapper row without needing a broader grant on plans itself.

create or replace function public.create_plan_from_gathering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_type text;
begin
  v_plan_type := case when new.party_type = 'friends' then 'friend_hangout' else 'gathering' end;

  insert into public.plans (
    plan_type, created_by, title, scheduled_at, location_lat, location_lng,
    party_size, status, resulting_gathering_id
  ) values (
    v_plan_type, new.host_id, new.title, new.scheduled_at, new.precise_lat, new.precise_lng,
    new.capacity, 'confirmed', new.id
  );
  return new;
end;
$$;

drop trigger if exists on_gathering_created_make_plan on public.gatherings;
create trigger on_gathering_created_make_plan
  after insert on public.gatherings
  for each row execute function public.create_plan_from_gathering();

create or replace function public.create_plan_from_business_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.plans (
    plan_type, created_by, title, scheduled_at, location_lat, location_lng,
    party_size, budget_max, status, resulting_business_request_id
  ) values (
    'business_request', new.requester_id, coalesce(new.raw_text, new.category),
    new.date::timestamptz, new.latitude, new.longitude,
    new.party_size, new.budget_max, 'draft', new.id
  );
  return new;
end;
$$;

drop trigger if exists on_business_request_created_make_plan on public.business_requests;
create trigger on_business_request_created_make_plan
  after insert on public.business_requests
  for each row execute function public.create_plan_from_business_request();

create or replace function public.sync_plan_status_from_business_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'fulfilled' then
    update public.plans set status = 'confirmed' where resulting_business_request_id = new.id and status <> 'confirmed';
  elsif new.status in ('cancelled', 'expired') then
    update public.plans set status = 'cancelled' where resulting_business_request_id = new.id and status not in ('cancelled', 'confirmed');
  end if;
  return new;
end;
$$;

drop trigger if exists on_business_request_status_sync_plan on public.business_requests;
create trigger on_business_request_status_sync_plan
  after update of status on public.business_requests
  for each row execute function public.sync_plan_status_from_business_request();

create or replace function public.create_plan_from_date_proposal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.plans (
    plan_type, created_by, title, status, resulting_date_proposal_id
  ) values (
    'dating_date', new.proposed_by, new.plan_text, 'draft', new.id
  );
  return new;
end;
$$;

drop trigger if exists on_date_proposal_created_make_plan on public.date_proposals;
create trigger on_date_proposal_created_make_plan
  after insert on public.date_proposals
  for each row execute function public.create_plan_from_date_proposal();

create or replace function public.sync_plan_status_from_date_proposal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'accepted' then
    update public.plans set status = 'confirmed' where resulting_date_proposal_id = new.id and status <> 'confirmed';
  elsif new.status in ('declined', 'withdrawn') then
    update public.plans set status = 'cancelled' where resulting_date_proposal_id = new.id and status not in ('cancelled', 'confirmed');
  end if;
  return new;
end;
$$;

drop trigger if exists on_date_proposal_status_sync_plan on public.date_proposals;
create trigger on_date_proposal_status_sync_plan
  after update of status on public.date_proposals
  for each row execute function public.sync_plan_status_from_date_proposal();

revoke all on function public.create_plan_from_gathering() from public, anon, authenticated;
revoke all on function public.create_plan_from_business_request() from public, anon, authenticated;
revoke all on function public.sync_plan_status_from_business_request() from public, anon, authenticated;
revoke all on function public.create_plan_from_date_proposal() from public, anon, authenticated;
revoke all on function public.sync_plan_status_from_date_proposal() from public, anon, authenticated;
