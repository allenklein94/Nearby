-- Item 67: host-declared skill level on a gathering (NULL = not said, never inferred). The client asks it only where relevant
-- (classes: beginner/intermediate/advanced; sports: casual/competitive; other activities: + all levels); the CHECK guards the
-- vocabulary. Host writes through the existing RLS, like format and genre.
alter table public.gatherings add column if not exists skill_level text;
alter table public.gatherings drop constraint if exists gatherings_skill_level_check;
alter table public.gatherings
  add constraint gatherings_skill_level_check check (skill_level is null or skill_level in (
    'beginner', 'intermediate', 'advanced', 'all_levels', 'casual', 'competitive'));
