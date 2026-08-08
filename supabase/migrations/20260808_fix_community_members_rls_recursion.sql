-- Found while live-verifying the Create 2.0 visibility filter (which reads
-- getMyCommunities(), a plain `select * from community_members where
-- user_id = auth.uid()`): that query fails with "infinite recursion
-- detected in policy for relation community_members" for every real
-- authenticated user, every time, in production. Root cause:
-- community_members' own SELECT policy queries `communities` (to check
-- is_public/creator_id), and communities' SELECT policy queries
-- `community_members` right back (to check membership) -- a genuine
-- circular RLS dependency, not a false alarm from the test harness (
-- reproduced in total isolation: `select 1 from community_members where
-- user_id = '<real id>'` alone, no other statements, fresh session).
-- Same root-cause shape as the is_blocked() SECURITY DEFINER fix earlier
-- this session (a helper needs to see another RLS-protected table without
-- re-triggering its policy), same fix: move the cross-table check into a
-- SECURITY DEFINER function so it bypasses RLS instead of re-entering it.
-- Only one side of the cycle needs breaking to fix both directions.
create or replace function public.is_community_visible_to(community_id_param uuid, user_id_param uuid)
returns boolean
language sql
security definer
stable
set search_path to 'public'
as $function$
  select case when auth.uid() = user_id_param then exists (
    select 1 from communities c
    where c.id = community_id_param
      and (c.is_public = true or c.creator_id = user_id_param)
  ) else false end;
$function$;

revoke all on function public.is_community_visible_to(uuid, uuid) from public, anon;
grant execute on function public.is_community_visible_to(uuid, uuid) to authenticated;

drop policy if exists "Members visible to other members and the public if community is" on community_members;
create policy "Members visible to other members and the public if community is"
  on community_members for select
  using (is_community_visible_to(community_id, auth.uid()) or user_id = auth.uid());
