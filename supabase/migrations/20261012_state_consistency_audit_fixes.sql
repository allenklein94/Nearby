-- Item 50 (CLAUDE.md, "state consistency audit"): fixes 1, 2, 3, 6 from
-- PRODUCT_AUDIT/STATE_CONSISTENCY_AUDIT_2026-09-11.md's fix list. (Fix 4 --
-- missing 'withdrawn' copy -- is client-only, no migration needed. Fix 5,
-- the "cancel a confirmed reservation" feature gap, is its own separate
-- migration since it's new capability, not a state-consistency repair.)

-- ==================== Fix 1: friend-request response needs a real guard ====================
-- respondToFriendRequest() (src/services/friends.js) used to be a raw
-- .update() with no "already resolved" transition guard anywhere -- not in
-- the RLS with_check (which only ever validated auth.uid() <> requested_by,
-- never status = 'pending'), not in the client. A re-decline after accept
-- left a stale live match/chat (create_match_on_friendship_accepted only
-- fires old.status='pending' -> new.status='accepted', so it never cleans
-- up on a later decline); a re-accept after decline showed "✓ Friends" with
-- no matches row to message through (the trigger's old.status='pending'
-- guard means it silently never re-fires). This RPC replaces the raw write
-- with the same "lock, check current status, then transition" shape
-- approve_gathering_interest() already established, plus validates blocks
-- at response time (sendFriendRequest already checks this at request time,
-- but nothing previously re-checked it if a block happened in between).
create or replace function public.respond_to_friend_request(friendship_id_param uuid, accept_param boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row record;
  v_caller uuid := auth.uid();
begin
  select * into v_row from friendships where id = friendship_id_param for update;

  if v_row is null then
    raise exception 'Friend request not found.';
  end if;
  if v_caller <> v_row.user_a and v_caller <> v_row.user_b then
    raise exception 'You are not part of this friend request.';
  end if;
  if v_caller = v_row.requested_by then
    raise exception 'You cannot respond to your own friend request.';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'This request has already been responded to.';
  end if;
  if is_blocked(v_row.user_a, v_row.user_b) then
    raise exception 'You cannot respond to this friend request.';
  end if;

  update friendships
  set status = case when accept_param then 'accepted' else 'declined' end
  where id = friendship_id_param;

  return jsonb_build_object('success', true, 'status', case when accept_param then 'accepted' else 'declined' end);
end;
$function$;

revoke all on function public.respond_to_friend_request(uuid, boolean) from public, anon;
grant execute on function public.respond_to_friend_request(uuid, boolean) to authenticated;

-- ==================== Fix 2: unmatch() must also clear a real friendship ====================
-- Same bug block_and_unmatch() was fixed for (2026-09-11, item 32) --
-- unfixed for its sibling. ChatScreen's plain "Unmatch" action works on ANY
-- open chat, including an accepted friend's (matches.source_friendship_id
-- set) -- it deleted the matches row but left friendships.status='accepted'
-- untouched, so FriendsScreen/ViewProfileScreen kept showing "✓ Friends"
-- with no way to actually message them. Mirrors block_and_unmatch's own
-- delete-both-directions shape exactly.
create or replace function public.unmatch(target_match_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_user_a uuid;
  v_user_b uuid;
begin
  select user_a, user_b into v_user_a, v_user_b
  from matches
  where id = target_match_id
    and (user_a = v_user_id or user_b = v_user_id);

  if v_user_a is null then
    return;
  end if;

  delete from matches where id = target_match_id;

  delete from friendships
  where (user_a = v_user_a and user_b = v_user_b)
     or (user_a = v_user_b and user_b = v_user_a);

  -- Also clear the notice history between these two people, so
  -- unmatching genuinely lets them start fresh if they cross paths
  -- again — otherwise old notices silently block new ones and can
  -- leave a stale entry in Notices even after unmatching.
  delete from notices
  where (from_user = v_user_a and to_user = v_user_b)
     or (from_user = v_user_b and to_user = v_user_a);
end;
$function$;

-- ==================== Fix 3: paused/cancelled communities must be un-joinable server-side ====================
-- Direct user decision (AskUserQuestion, 2026-09-11): active = discoverable
-- + joinable; paused/cancelled = neither, for NEW participation -- but
-- existing members keep whatever access they already have (this policy
-- only governs INSERT, so it never touches an existing member's row).
-- Applies uniformly across every join path this policy already covers
-- (public join, creator's own initial row, accepted community invite) so a
-- cancelled/paused community can't be joined by any route, not just the
-- browse/search UI (which gets its own matching fix in communities.js).
drop policy if exists "Users can join public communities, invited communities, or thei" on public.community_members;
create policy "Users can join public communities, invited communities, or thei"
on public.community_members for insert
with check (
  (user_id = auth.uid())
  and exists (select 1 from communities c where c.id = community_members.community_id and c.status = 'active')
  and (
    exists (select 1 from communities c where c.id = community_members.community_id and (c.is_public = true or c.creator_id = auth.uid()))
    or exists (
      select 1 from social_invites si
      where si.invite_type = 'community' and si.target_id = community_members.community_id
        and si.invitee_id = auth.uid() and si.status = 'accepted'
    )
  )
  and (
    ((role = 'creator') and exists (select 1 from communities c where c.id = community_members.community_id and c.creator_id = auth.uid()))
    or (role = 'member')
  )
);

-- ==================== Fix 6: gathering_interest.status defense-in-depth ====================
-- Pure freeform text before this -- enforced only by RPC discipline
-- (join_gathering/approve_gathering_interest/leave_gathering, confirmed the
-- only writers; there is zero UPDATE policy on this table and the INSERT
-- policy's own with_check already hardcodes status='pending', so this was
-- never actually exploitable). 'denied' is a fully dead legacy value (no
-- live RPC sets it, no client checks for it) -- deliberately excluded from
-- the allowed list rather than kept around for a state nothing produces.
alter table public.gathering_interest
  add constraint gathering_interest_status_check
  check (status in ('pending', 'approved', 'waitlisted'));
