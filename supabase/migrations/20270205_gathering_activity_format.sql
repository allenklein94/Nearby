-- Item 66: host-declared activity FORMAT on a gathering (how it runs, separate from its category: a pickleball tournament vs
-- pickleball open play). Closed list, NULL = not said, never inferred. Host writes through the existing RLS, like genre.
alter table public.gatherings add column if not exists format text;
alter table public.gatherings drop constraint if exists gatherings_format_check;
alter table public.gatherings
  add constraint gatherings_format_check check (format is null or format in (
    'drop_in', 'class', 'tournament', 'meetup', 'concert', 'show', 'festival', 'tour', 'workshop', 'appointment', 'reservation',
    'open_play', 'competition', 'exhibition', 'market', 'party'));
