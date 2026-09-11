-- Relationship-state audit (external UX critique item 32, 2026-09-11):
-- block_and_unmatch() deleted the matches row and notice history on
-- block, but never touched friendships -- so blocking an accepted friend
-- left friendships.status stuck at 'accepted' forever. Real, live
-- consequence: FriendsScreen (getMyFriends) kept listing the blocked
-- person as a friend, and ProfileScreen's "Your Connections -> Friends"
-- count kept counting them, while ViewProfileScreen blanks the profile
-- entirely on block (is_blocked check) -- the exact "Friend in one place,
-- contradicted in another" failure the user described, just with Blocked
-- as the true state instead of Stranger. No trigger fires on a
-- friendships DELETE (confirmed live: only INSERT/UPDATE triggers exist
-- on this table), so a plain delete is safe here, same shape as the
-- existing matches/notices deletes right above it.
CREATE OR REPLACE FUNCTION public.block_and_unmatch(blocked_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_blocker_id uuid := auth.uid();
begin
  insert into blocks (blocker_id, blocked_id)
  values (v_blocker_id, blocked_user_id)
  on conflict do nothing;

  delete from matches
  where (user_a = v_blocker_id and user_b = blocked_user_id)
     or (user_a = blocked_user_id and user_b = v_blocker_id);

  delete from friendships
  where (user_a = v_blocker_id and user_b = blocked_user_id)
     or (user_a = blocked_user_id and user_b = v_blocker_id);

  -- Same reasoning as unmatch: clear notice history too, so stale
  -- mutual-notice records can't linger and cause confusing state if
  -- this person is ever unblocked later.
  delete from notices
  where (from_user = v_blocker_id and to_user = blocked_user_id)
     or (from_user = blocked_user_id and to_user = v_blocker_id);
end;
$function$
;
