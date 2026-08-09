-- New audience/discovery-scope axis, separate from is_public (which has
-- always meant auto-join vs. host-approval, not who can discover the
-- gathering in the first place). Backfills to 'everyone' for every existing
-- row, matching today's actual behavior exactly -- getNearbyGatherings()
-- currently has no visibility filtering at all, so every gathering already
-- behaves as 'everyone' today.
alter table public.gatherings
  add column visibility text not null default 'everyone'
  check (visibility in ('everyone', 'friends', 'community', 'invite_only'));

-- Not a new index on its own -- visibility filtering happens client-side
-- against an already-fetched list (getNearbyGatherings), same pattern as
-- the existing women_only/blocks filtering in that function. No RLS change:
-- "Anyone can view gatherings" (using (true)) already lets a direct
-- fetch-by-id through regardless of visibility, matching how a "private"
-- (is_public = false) gathering already works today -- privacy in this
-- schema has always meant "excluded from browse/discovery queries," never
-- an RLS-level restriction.
