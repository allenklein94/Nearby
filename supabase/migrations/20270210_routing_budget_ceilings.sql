-- Travel-time routing budget ceilings (owner item 70 gate 3, 2026-09-26). NO provider, key, billing or routing exists; this is
-- only the ledger a future server-side `travel-times` function must claim from BEFORE any paid call. Every ceiling ships at 0,
-- so every claim is refused and ranking stays on miles. Only the owner sets the ceilings (a deliberate SQL update after they
-- approve the budget); no client can read or write any of this.
--   monthly_element_ceiling  hard cap on billed elements (origins x destinations) per UTC calendar month
--   daily_element_ceiling    hard cap per UTC day
--   per_user_daily_asks      routed asks one person may make per UTC day
-- Nothing about the ask is stored: no mode, no location, no results. Per-person rows hold only (user, day, count) and are deleted
-- the next day; day rows hold only totals.

create table if not exists public.routing_budget_settings (
  id boolean primary key default true check (id),
  monthly_element_ceiling integer not null default 0 check (monthly_element_ceiling >= 0),
  daily_element_ceiling integer not null default 0 check (daily_element_ceiling >= 0),
  per_user_daily_asks integer not null default 0 check (per_user_daily_asks >= 0),
  updated_at timestamptz not null default now()
);
insert into public.routing_budget_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.routing_usage_days (
  day date primary key,
  elements integer not null default 0 check (elements >= 0),
  asks integer not null default 0 check (asks >= 0)
);

create table if not exists public.routing_usage_user_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  asks integer not null default 0 check (asks >= 0),
  primary key (user_id, day)
);

alter table public.routing_budget_settings enable row level security;
alter table public.routing_usage_days enable row level security;
alter table public.routing_usage_user_days enable row level security;
revoke all on public.routing_budget_settings, public.routing_usage_days, public.routing_usage_user_days from public, anon, authenticated;

-- Claims budget for ONE routed ask of p_elements elements (1..20, the code's MAX_ROUTED_CANDIDATES). Returns true only when every
-- ceiling has room, and then records the usage atomically; otherwise records nothing and returns false (caller ranks on miles).
create or replace function public.routing_claim_budget(p_user uuid, p_elements integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.routing_budget_settings%rowtype;
  today date := (now() at time zone 'utc')::date;
  month_used bigint;
  day_used integer;
  user_used integer;
begin
  if p_user is null or p_elements is null or p_elements < 1 or p_elements > 20 then
    return false;
  end if;
  -- serializes all claims, so concurrent asks can never overshoot a ceiling
  select * into s from public.routing_budget_settings where id for update;
  if not found or s.monthly_element_ceiling = 0 or s.daily_element_ceiling = 0 or s.per_user_daily_asks = 0 then
    return false;
  end if;

  select coalesce(sum(elements), 0) into month_used from public.routing_usage_days
   where day >= date_trunc('month', today)::date and day <= today;
  select coalesce((select elements from public.routing_usage_days where day = today), 0) into day_used;
  select coalesce((select asks from public.routing_usage_user_days where user_id = p_user and day = today), 0) into user_used;

  if month_used + p_elements > s.monthly_element_ceiling
     or day_used + p_elements > s.daily_element_ceiling
     or user_used + 1 > s.per_user_daily_asks then
    return false;
  end if;

  insert into public.routing_usage_days (day, elements, asks) values (today, p_elements, 1)
  on conflict (day) do update set elements = routing_usage_days.elements + excluded.elements, asks = routing_usage_days.asks + 1;
  insert into public.routing_usage_user_days (user_id, day, asks) values (p_user, today, 1)
  on conflict (user_id, day) do update set asks = routing_usage_user_days.asks + 1;
  -- per-person counts never outlive their day; totals kept ~13 months for the monthly figure and billing reconciliation
  delete from public.routing_usage_user_days where day < today;
  delete from public.routing_usage_days where day < today - 400;
  return true;
end;
$$;

revoke all on function public.routing_claim_budget(uuid, integer) from public, anon, authenticated;
grant execute on function public.routing_claim_budget(uuid, integer) to service_role;
