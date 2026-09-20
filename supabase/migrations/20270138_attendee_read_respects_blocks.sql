-- Attendee reads respect blocks in BOTH directions.
--
-- "Anyone can see approved attendees" only checked status = 'approved', and the blocks table's own RLS lets a
-- user read only blocks THEY created, so a client could never hide the people who blocked them. This adds a
-- SECURITY DEFINER helper (reads blocks as owner) and uses it in the policy, so a blocked pair cannot see each
-- other as attendees, whoever blocked whom.
--
-- Deliberately unchanged: the host policy ("Users see own interest or gatherings they host") -- a host must
-- keep seeing every request/attendee to manage the gathering -- and the caller's own row. SECURITY DEFINER
-- RPCs (join_gathering, capacity checks, counts) bypass RLS and are unaffected. Visible consequence: a
-- client-side attendee count for a blocked pair can be short by the hidden person.

create or replace function public.viewer_blocked_either_way(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and other_user is not null
     and exists (
       select 1 from blocks b
       where (b.blocker_id = auth.uid() and b.blocked_id = other_user)
          or (b.blocker_id = other_user and b.blocked_id = auth.uid())
     );
$$;

-- Callable by anon only so the policy never errors for an unauthenticated read; it returns false there and
-- only ever reveals whether a block exists between the CALLER and the given user (same as is_blocked()).
revoke all on function public.viewer_blocked_either_way(uuid) from public;
grant execute on function public.viewer_blocked_either_way(uuid) to anon, authenticated;

drop policy if exists "Anyone can see approved attendees" on public.gathering_interest;
create policy "Anyone can see approved attendees"
  on public.gathering_interest
  for select
  using (status = 'approved' and not public.viewer_blocked_either_way(user_id));
