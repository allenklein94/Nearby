-- A host's read of attendance rows respects blocks in BOTH directions (owner, 2026-11-11; staged, after 20270410).
--
-- The gap: the host branch of "Users see own interest or gatherings they host" (baseline, kept on purpose by 20270138)
-- let a host read EVERY gathering_interest row on their own gathering through the API, including the row of someone who
-- blocked them or whom they blocked: who it is, their status, when they asked, on-my-way and check-in times. The app's host
-- list already hid those people client-side (getGatheringRequestsForHost), but a client filter can't stop a direct
-- PostgREST read, realtime, or the host's Activity "wants to join" read (getAllPendingRequests, no client filter at all).
--
-- This migration (the smallest server-side fix):
--  1. Host SELECT branch: a host reads rows on their own gathering only when NOT viewer_blocked_either_way(user_id). The
--     person's own row stays readable to themselves. Realtime postgres_changes follows the same policy.
--  2. A business that hosts gatherings: get_business_top_members (names + counts) and get_business_member_gathering_history
--     (one member's attendance at that business's gatherings) leave out anyone blocked either way with the business account
--     reading them (the same "host" reading attendance, through a SECURITY DEFINER function).
--
-- Deliberately unchanged (records are never altered; only who may READ them):
--  - No row is deleted or changed by a block, before or after this migration; historical attendance stays as it was.
--  - SECURITY DEFINER logic that needs every row keeps every row: capacity and the waitlist (join_gathering,
--    approve_gathering_interest, _promote_from_waitlist, set_gathering_capacity), approved counts
--    (get_gathering_approved_counts), aggregate insights with their floors, check-in, reports and admin case capture
--    (_capture_report_object), host_remove_gathering_attendee, get_my_familiar_hosts (already block-filtered).
--  - Service role and admin/moderation paths bypass RLS and see every row.
--  - Inserting a row is unchanged: a blocked pair is already refused both ways, whatever the path (join_gathering's own
--    check; a direct insert by item 147's trigger own_join_needs_visibility, since the gathering isn't visible to them),
--    so no "{Name} asked to join" push can reach the host from someone blocked either way.
--  - The approved-attendee policy for members and friends (20270138/20270172) already respects blocks.
-- Trade-offs (reported to the owner): the host cannot see, decline or remove a blocked person's request or attendance from
-- the app (already true in the app today: its host list hid them); that person's seat still counts toward capacity; a
-- host's client-side waitlist count (getGatheringDetail) leaves out a blocked waitlisted person.

alter policy "Users see own interest or gatherings they host" on public.gathering_interest
  using (
    auth.uid() = user_id
    or (
      auth.uid() = (select gatherings.host_id from public.gatherings where gatherings.id = gathering_interest.gathering_id)
      and not public.viewer_blocked_either_way(user_id)
    )
  );

create or replace function public.get_business_top_members(partner_id_param uuid)
 returns table(user_id uuid, display_name text, gatherings_attended bigint)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return;
  end if;

  return query
  select p.id, p.display_name, count(*) as gatherings_attended
  from gathering_interest gi
  join gatherings g on g.id = gi.gathering_id
  join profiles p on p.id = gi.user_id
  where g.hosting_partner_id = partner_id_param
  and gi.status = 'approved'
  and not public.viewer_blocked_either_way(gi.user_id)
  group by p.id, p.display_name
  order by gatherings_attended desc
  limit 5;
end;
$function$;

create or replace function public.get_business_member_gathering_history(partner_id_param uuid, member_id_param uuid)
 returns table(gathering_id uuid, title text, scheduled_at timestamp with time zone)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param) then
    return;
  end if;
  if public.viewer_blocked_either_way(member_id_param) then
    return;
  end if;

  return query
  select g.id, g.title, g.scheduled_at
  from gathering_interest gi
  join gatherings g on g.id = gi.gathering_id
  where g.hosting_partner_id = partner_id_param
  and gi.status = 'approved'
  and gi.user_id = member_id_param
  order by g.scheduled_at desc;
end;
$function$;
