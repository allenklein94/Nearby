-- Effort level on a gathering (owner decision after item 67): how much physical/mental effort it takes. Host-declared, optional,
-- NULL = not said, never inferred. Intensity is NOT a new column: it reuses the existing host-declared energy_level (1-5).
alter table public.gatherings add column if not exists effort_level text;
alter table public.gatherings drop constraint if exists gatherings_effort_level_check;
alter table public.gatherings
  add constraint gatherings_effort_level_check check (effort_level is null or effort_level in ('light', 'moderate', 'challenging'));
