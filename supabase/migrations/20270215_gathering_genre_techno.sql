-- Techno becomes its own host-selectable genre (owner, 2026-09-26). Widens the closed list from migration 20270195; every
-- existing genre stays valid (nothing renamed or removed, no stored row touched). Same column, same CHECK name, host writes
-- through the existing RLS.
alter table public.gatherings drop constraint if exists gatherings_genre_check;
alter table public.gatherings
  add constraint gatherings_genre_check check (genre is null or genre in ('rock', 'pop', 'jazz', 'blues', 'country', 'hip_hop', 'electronic', 'techno', 'classical', 'folk', 'latin', 'r_and_b', 'open_mic'));
