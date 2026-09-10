-- Unified Crossed Paths, step 1 (2026-09-10, direct user design after
-- pushback on a separate Friends-only Crossed Paths feature -- see
-- CLAUDE.md's Active section for the full locked design). ONE Crossed
-- Paths mechanism shared by Dating and Friends, signal priority:
--   1. Shared gathering attendance (this function) -- strongest, PREFERRED
--      explanation when it exists ("You were both at {title}").
--   2. Repeated proximity (the existing `sightings` table, today's live
--      Dating Crossed Paths mechanism) -- fallback only, unchanged.
--   Never: raw "N people near you" with no explained reason.
--
-- "Attended" uses this schema's own already-established bar --
-- gathering_interest.status = 'approved' on a gathering whose scheduled_at
-- has already passed -- the same convention get_business_member_gathering_
-- history()/get_business_top_members() already use for "attended," not the
-- much sparser checked_in_at column (optional, most attendees never
-- explicitly check in -- would make this signal fire far too rarely to be
-- useful).
--
-- One row per other user (their single most recent shared past gathering)
-- -- callers union this with their own sightings query and prefer this
-- explanation when both exist for the same pair (never blended into one
-- generic line). Real, symmetric information only: if I can see this row,
-- both of us genuinely attended the same real gathering together --
-- exactly as legitimate as the attendee roster either of us could already
-- see on that gathering itself.
create or replace function public.get_shared_gathering_partners()
returns table(other_user_id uuid, gathering_id uuid, gathering_title text, scheduled_at timestamptz)
language sql
stable security definer
set search_path to 'public'
as $function$
  select distinct on (other.user_id)
    other.user_id as other_user_id,
    g.id as gathering_id,
    g.title as gathering_title,
    g.scheduled_at
  from gathering_interest mine
  join gathering_interest other
    on other.gathering_id = mine.gathering_id
    and other.user_id <> mine.user_id
    and other.status = 'approved'
  join gatherings g on g.id = mine.gathering_id
  where mine.user_id = auth.uid()
    and mine.status = 'approved'
    and g.scheduled_at < now()
  order by other.user_id, g.scheduled_at desc;
$function$;

revoke all on function public.get_shared_gathering_partners() from public, anon;
grant execute on function public.get_shared_gathering_partners() to authenticated;
