-- People reads hide a blocked pair in BOTH directions, enforced where the rows are read (owner, 2026-10-02).
--
-- The client used to hide blocked people itself: it read `blocks` twice, "people I blocked" and "people who blocked
-- me". blocks RLS only shows a viewer the blocks they created, so the second read always returned nothing and every
-- such filter was one-way. These reads now carry the rule themselves, through the one shared helper
-- `viewer_blocked_either_way(other)` (20270138, SECURITY DEFINER, answers only about the CALLER and the given user).
-- The client no longer reads `blocks` on these paths; a hidden person is simply absent (no block record, no
-- direction, no distinct error).
--
--   1. community_members: another member's row is readable only when neither side blocked the other (the caller's own
--      row stays readable, so membership checks in other policies are unchanged). Covers the member list and every
--      member count read through RLS (a count can now be short by a hidden person, like attendee counts in 20270138).
--   2. friendships: a row between a blocked pair is neither readable nor creatable. Blocking through block_and_unmatch
--      already deletes the friendship, so this changes nothing for a normal block; it closes the gap where a person
--      the other side had blocked could still send a friend request (the client check could not see that block), and
--      a row created around block_and_unmatch. UPDATE stays on respond_to_friend_request (SECURITY DEFINER, which
--      re-checks blocks).
--   3. get_shared_gathering_partners (Crossed Paths' gathering half, dating and friends): had no block check at all.
--      Its sightings half already used is_blocked (two-way) in the sightings policy.
--   4. people_visible_to_me: a SECURITY INVOKER view over profiles (profiles RLS and column grants still apply) that
--      leaves out anyone in a block with the caller. Used for the reads that list or open a stranger by id: dating
--      Browse and the profile screen's availability check. profiles' own policy is NOT changed here (it is joined
--      everywhere; reported separately).

-- 1. community members
drop policy if exists "Members visible to other members and the public if community is" on public.community_members;
create policy "Members visible to other members and the public if community is"
  on public.community_members
  as permissive
  for select
  to public
  using (
    user_id = auth.uid()
    or (public.is_community_visible_to(community_id, auth.uid()) and not public.viewer_blocked_either_way(user_id))
  );

-- 2. friendships
drop policy if exists "Participants can view their own friendships" on public.friendships;
create policy "Participants can view their own friendships"
  on public.friendships
  as permissive
  for select
  to authenticated
  using (
    (auth.uid() = user_a or auth.uid() = user_b)
    and not public.viewer_blocked_either_way(case when user_a = auth.uid() then user_b else user_a end)
  );

drop policy if exists "Users can request friendships" on public.friendships;
create policy "Users can request friendships"
  on public.friendships
  as permissive
  for insert
  to authenticated
  with check (
    auth.uid() = requested_by
    and (auth.uid() = user_a or auth.uid() = user_b)
    and not public.viewer_blocked_either_way(case when user_a = auth.uid() then user_b else user_a end)
  );

-- 3. Crossed Paths' shared-gathering partners
create or replace function public.get_shared_gathering_partners()
 returns table(other_user_id uuid, gathering_id uuid, gathering_title text, scheduled_at timestamp with time zone)
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
    and not public.viewer_blocked_either_way(other.user_id)
  order by other.user_id, g.scheduled_at desc;
$function$;

-- 4. profiles as the caller may see them as people
create or replace view public.people_visible_to_me
  with (security_invoker = true)
as
  select p.*
    from public.profiles p
   where p.id = auth.uid() or not public.viewer_blocked_either_way(p.id);

revoke all on public.people_visible_to_me from public, anon;
grant select on public.people_visible_to_me to authenticated;
