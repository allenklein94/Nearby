-- Item 39 (host-declared, per gathering): whether equipment is provided and how long it lasts. NULL = the host did not say
-- (nothing is shown, nothing is inferred). beginner_friendly already exists on gatherings. Hosts write their own row through
-- the existing RLS update/insert policy, like price_level; no new function.
alter table public.gatherings add column if not exists equipment_provided boolean;
alter table public.gatherings add column if not exists duration_minutes integer;
alter table public.gatherings drop constraint if exists gatherings_duration_minutes_check;
alter table public.gatherings
  add constraint gatherings_duration_minutes_check check (duration_minutes is null or duration_minutes between 15 and 720);
