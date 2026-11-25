-- Rollback of 20270433: back to deny-by-default (Crossed Paths stops excluding swiped people again). No data touched.
drop policy if exists "Read your own friend swipes" on public.friend_discovery_swipes;
revoke select (from_user, to_user) on public.friend_discovery_swipes from authenticated;
