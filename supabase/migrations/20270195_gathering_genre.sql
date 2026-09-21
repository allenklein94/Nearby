-- Item 39: host-declared music genre on a gathering (closed list, NULL = not said). Only meaningful for music gatherings; the
-- client offers it only for music tags, the CHECK only guards the vocabulary. Host writes through the existing RLS.
alter table public.gatherings add column if not exists genre text;
alter table public.gatherings drop constraint if exists gatherings_genre_check;
alter table public.gatherings
  add constraint gatherings_genre_check check (genre is null or genre in ('rock', 'pop', 'jazz', 'blues', 'country', 'hip_hop', 'electronic', 'classical', 'folk', 'latin', 'r_and_b', 'open_mic'));
