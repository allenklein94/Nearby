-- Scorecard-to-10 initiative, Phase 1 item 1 (see CLAUDE.md): fixes for the
-- 3 real findings from PRODUCT_AUDIT/SECDEF_AUDIT_BATCH1.md, a systematic
-- read of 68 of this app's ~148 SECURITY DEFINER functions hunting for the
-- ownership-check-gap bug shape this codebase has already found and fixed
-- six times this month (admin self-escalation, matches/friendships identity
-- hijack, is_blocked()'s historical-visibility gap, business RPC ownership
-- checks, check_and_increment_ai_use's cross-user rate-limit burn).
--
-- Both function bodies below were pulled fresh from live production via
-- pg_get_functiondef before editing, matching this file's own established
-- "never reconstruct from a possibly-stale local copy" discipline.

-- Finding 1: get_mutual_friends(other_user_id) had no relationship/block
-- check at all -- callable against any user id in the app, including
-- someone who has blocked the caller or vice versa, returning that
-- stranger's real mutual-friend names/photos. Fixed with the unambiguous
-- half of the finding (an is_blocked() guard, matching every sibling RPC
-- that surfaces another person's data). Deliberately NOT also requiring an
-- existing friendship/match relationship -- get_mutual_friends is called
-- from ViewProfileScreen, which is reachable in dating-discovery contexts
-- where viewing a genuine stranger's profile (and their real mutual-friend
-- count) is the whole point of the surface, same as Hinge/Tinder-style
-- "N mutual friends" on a candidate card. The locked "no stranger
-- discovery, ever" principle elsewhere in this app is scoped to the intent
-- layer specifically (Home's ask box, Business Fulfillment, Friend
-- Discovery) -- dating discovery has always been kept a separate,
-- deliberately-not-restricted-the-same-way surface throughout this file's
-- history, so this fix matches existing precedent rather than picking a
-- new one.
create or replace function public.get_mutual_friends(other_user_id uuid)
returns table(id uuid, display_name text, photo_url text)
language sql
stable security definer
set search_path to 'public'
as $$
  with my_friends as (
    select case when f.user_a = auth.uid() then f.user_b else f.user_a end as friend_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = auth.uid() or f.user_b = auth.uid())
  ),
  their_friends as (
    select case when f.user_a = other_user_id then f.user_b else f.user_a end as friend_id
    from friendships f
    where f.status = 'accepted' and (f.user_a = other_user_id or f.user_b = other_user_id)
  )
  select p.id, p.display_name, p.photo_url
  from profiles p
  where p.id in (select friend_id from my_friends)
  and p.id in (select friend_id from their_friends)
  and not is_blocked(auth.uid(), other_user_id);
$$;

-- Finding 2: get_my_group_intent_signals() was missing the is_blocked()
-- check its own sibling get_connected_open_business_requests() already has
-- (same connected-set definition, built the same day) -- a real accepted
-- friend/match who has since been blocked (or who has blocked the caller)
-- could still surface in the "N people you know are looking for X" Home
-- nudge with their real name shown. One-line fix, direct precedent already
-- in the sibling function.
create or replace function public.get_my_group_intent_signals()
returns table(category text, request_count bigint, requester_names text[], soonest_date date)
language sql
stable security definer
set search_path to 'public'
as $$
  with connected as (
    select case when user_a = auth.uid() then user_b else user_a end as friend_id
    from friendships
    where status = 'accepted' and (user_a = auth.uid() or user_b = auth.uid())
    union
    select case when user_a = auth.uid() then user_b else user_a end as friend_id
    from matches
    where user_a = auth.uid() or user_b = auth.uid()
  ),
  open_reqs as (
    select br.category, br.date, p.display_name, br.requester_id
    from business_requests br
    join connected c on c.friend_id = br.requester_id
    join profiles p on p.id = br.requester_id
    where br.status = 'open'
    and br.expires_at > now()
    and br.category is not null
    and br.requester_id <> auth.uid()
    and p.intent_visibility = 'friends_and_matches'
    and not is_blocked(auth.uid(), br.requester_id)
  )
  select
    category,
    count(distinct requester_id) as request_count,
    (array_agg(display_name order by date nulls last))[1:5] as requester_names,
    min(date) as soonest_date
  from open_reqs
  group by category
  having count(distinct requester_id) >= 2
  order by count(distinct requester_id) desc, min(date) asc nulls last
  limit 5;
$$;

-- Finding 3 (low severity): check_is_admin(uid) is directly callable via
-- RPC with an arbitrary uid, letting any authenticated user learn whether
-- an arbitrary account is an admin -- no PII/capability leak on its own,
-- but a real, unnecessary information disclosure and inconsistent with
-- is_blocked()/is_community_visible_to()'s established "internal-guard"
-- posture. Every real caller in this codebase already invokes it only as
-- check_is_admin(auth.uid()), and always from *inside* another SECURITY
-- DEFINER function (confirmed via a grep of every client .js file -- zero
-- direct RPC callers) -- matching the already-established
-- "internal-helper, locked-down-from-direct-call" pattern this schema uses
-- for _business_request_fanout/_match_request_to_availability. Revoking
-- authenticated's execute grant doesn't affect any real caller: a nested
-- call from within another SECURITY DEFINER function owned by the same
-- role bypasses this lockdown, as already verified empirically elsewhere
-- in this file's history for the same pattern.
revoke execute on function public.check_is_admin(uuid) from authenticated;
