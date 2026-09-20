-- Item 75: friends see different signals than strangers. A gathering can be discoverable without its attendee list
-- becoming a people-discovery surface. "Anyone can see approved attendees" let any signed-in user read every approved
-- gathering_interest row (user_id, and through profiles the name/photo) of any gathering. Now an approved row is readable
-- only by: its own person, the host (existing policy), a fellow APPROVED attendee of that gathering, or an ACCEPTED
-- FRIEND of that person (matches and strangers are not enough). Everyone else gets counts from the existing
-- get_gathering_approved_counts (no identities). Blocks either way still hide the person.
-- The two helpers are SECURITY DEFINER so the policy never recurses into its own table.

create or replace function public.viewer_is_friend_of(other_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and other_user is not null and other_user <> auth.uid()
    and exists (
      select 1 from friendships f
      where f.status = 'accepted'
        and ((f.user_a = auth.uid() and f.user_b = other_user) or (f.user_a = other_user and f.user_b = auth.uid()))
    );
$$;

create or replace function public.viewer_is_gathering_member(gathering_id_param uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    exists (select 1 from gatherings g where g.id = gathering_id_param and g.host_id = auth.uid())
    or exists (select 1 from gathering_interest gi where gi.gathering_id = gathering_id_param and gi.user_id = auth.uid() and gi.status = 'approved')
  );
$$;

revoke all on function public.viewer_is_friend_of(uuid) from public, anon;
revoke all on function public.viewer_is_gathering_member(uuid) from public, anon;
grant execute on function public.viewer_is_friend_of(uuid) to authenticated;
grant execute on function public.viewer_is_gathering_member(uuid) to authenticated;

drop policy if exists "Anyone can see approved attendees" on public.gathering_interest;
create policy "Approved attendees visible to members and friends"
  on public.gathering_interest
  for select
  to authenticated
  using (
    status = 'approved'
    and not public.viewer_blocked_either_way(user_id)
    and (
      user_id = auth.uid()
      or public.viewer_is_gathering_member(gathering_id)
      or public.viewer_is_friend_of(user_id)
    )
  );

-- "New here" used to read other people's PAST attendance straight from gathering_interest, which this policy now hides
-- from non-members (everyone would have read as a first-timer). Two narrow replacements:
--  * ids: member-only (host or approved attendee) -- the Hub's per-person marker.
--  * count: any signed-in viewer -- an aggregate for the "Why this fits" line, no identities.
create or replace function public.get_gathering_first_timer_ids(gathering_id_param uuid)
returns table(user_id uuid) language sql stable security definer set search_path = public as $$
  select gi.user_id
  from gathering_interest gi
  where gi.gathering_id = gathering_id_param and gi.status = 'approved'
    and public.viewer_is_gathering_member(gathering_id_param)
    and not public.viewer_blocked_either_way(gi.user_id)
    and not exists (
      select 1 from gathering_interest o join gatherings og on og.id = o.gathering_id
      where o.user_id = gi.user_id and o.status = 'approved' and o.gathering_id <> gathering_id_param and og.scheduled_at < now()
    );
$$;

create or replace function public.get_gathering_first_timer_count(gathering_id_param uuid)
returns integer language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then 0 else (
    select count(*)::int from gathering_interest gi
    where gi.gathering_id = gathering_id_param and gi.status = 'approved'
      and not public.viewer_blocked_either_way(gi.user_id)
      and not exists (
        select 1 from gathering_interest o join gatherings og on og.id = o.gathering_id
        where o.user_id = gi.user_id and o.status = 'approved' and o.gathering_id <> gathering_id_param and og.scheduled_at < now()
      )
  ) end;
$$;

revoke all on function public.get_gathering_first_timer_ids(uuid) from public, anon;
revoke all on function public.get_gathering_first_timer_count(uuid) from public, anon;
grant execute on function public.get_gathering_first_timer_ids(uuid) to authenticated;
grant execute on function public.get_gathering_first_timer_count(uuid) to authenticated;
