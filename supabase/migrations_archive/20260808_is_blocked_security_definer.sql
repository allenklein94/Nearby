-- is_blocked(user_1, user_2) is referenced by ~10 RLS policies across
-- matches, messages, notices, sightings, shared_playlist_items, and (as of
-- this same session) business_messages -- every one of them the app's core
-- anti-harassment enforcement ("a blocked pair can't message/see each
-- other"). It was a plain (non-SECURITY DEFINER) function, so it ran under
-- the CALLING role's own RLS when it read the blocks table. blocks' own
-- SELECT policy is `auth.uid() = blocker_id` only -- the blocked party can
-- never see that they were the one blocked (an intentional privacy
-- property elsewhere, e.g. getMyBlockedUsers() only ever lists blocks the
-- caller created). The unintended side effect: when the BLOCKED party is
-- the one performing an action (e.g. sending a message to the person who
-- blocked them), is_blocked() silently returned false, because from their
-- own RLS-scoped point of view the block row doesn't exist. Verified live
-- against production: a real block row (A blocked B) existed, but
-- is_blocked(A, B) queried AS B's own session returned false, and B's
-- business_messages INSERT (a blocked reply) actually went through.
--
-- Fixed by making is_blocked SECURITY DEFINER so it sees the real blocks
-- table regardless of which side of the block the caller is on. To avoid
-- turning this into a new leak (an authenticated user probing arbitrary
-- pairs, e.g. "does stranger X block stranger Y" or even "does X block
-- me" as a way to detect being blocked), it only ever answers for pairs
-- where auth.uid() is one of the two ids -- true for every real call site
-- in this schema (confirmed: every qual/with_check referencing is_blocked
-- already independently requires auth.uid() = one of the same two ids via
-- an AND clause), so nothing already working changes.
create or replace function public.is_blocked(user_1 uuid, user_2 uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is distinct from user_1 and auth.uid() is distinct from user_2 then
    return false;
  end if;

  return exists (
    select 1 from blocks
    where (blocker_id = user_1 and blocked_id = user_2)
       or (blocker_id = user_2 and blocked_id = user_1)
  );
end;
$function$;

revoke all on function public.is_blocked(uuid, uuid) from public, anon;
grant execute on function public.is_blocked(uuid, uuid) to authenticated;
