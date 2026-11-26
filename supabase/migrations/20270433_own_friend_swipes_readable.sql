-- Friends Crossed Paths stops showing people you already swiped on (found 2026-11-25 by the build 87 call check; live on
-- production since the Crossed Paths pool shipped, 2026-09-10).
--
-- Before: friend_discovery_swipes is deny-by-default (20260816_friend_discovery: no grants, no policies), deliberately, so
-- the RECIPIENT of an unreciprocated like can never learn it. But getFriendCrossedPaths (services/friendDiscovery.js, in
-- build 87 and every earlier build) reads the caller's OWN swipes directly:
--   from('friend_discovery_swipes').select('to_user').eq('from_user', myId)
-- That read is refused (42501), the app ignores the error, and the exclusion silently never happens: people you passed on or
-- connected with reappear in Friends > Crossed Paths. The main deck (get_friend_discovery_candidates) already excludes them.
--
-- After: an authenticated person may read exactly two columns (from_user, to_user) of rows they wrote themselves
-- (from_user = auth.uid()). Server-only fix: build 87 starts excluding correctly with no new app build.
-- Kept: nobody can read a row where they are the target (to_user), so a like stays invisible to its recipient; `direction`
-- and every other column stay unreadable (whether you liked or passed is not needed to exclude); no insert / update /
-- delete for clients (writes stay in record_friend_discovery_swipe); anon gets nothing.
grant select (from_user, to_user) on public.friend_discovery_swipes to authenticated;

drop policy if exists "Read your own friend swipes" on public.friend_discovery_swipes;
create policy "Read your own friend swipes" on public.friend_discovery_swipes
  for select to authenticated using (from_user = (select auth.uid()));
