-- Follow-up to 20260816_secdef_audit_batch1_fixes.sql, same session: that
-- migration's original fix for Finding 3 (check_is_admin(uid) directly
-- RPC-callable with an arbitrary uid, a low-severity info-disclosure) was
-- `revoke execute ... from authenticated`, matching this codebase's
-- established "internal-helper, locked-down-from-direct-call" pattern
-- (_business_request_fanout et al). That broke a real, legitimate internal
-- caller live in production -- confirmed empirically, not assumed:
-- get_intent_funnel_stats() (SECURITY DEFINER, owned by the same `postgres`
-- role as check_is_admin) started failing with `permission denied for
-- function check_is_admin` the moment the grant was revoked, even though
-- CLAUDE.md's own history documents the identical revoke-and-nest pattern
-- working for _business_request_fanout. Whatever the precise mechanism
-- (this wasn't re-derived from Postgres internals, just observed), the
-- revoke approach is unsafe here and was already reverted live
-- (re-granted execute back to authenticated) before this migration.
--
-- Using the fork's own alternative proposed fix instead: the same internal
-- `auth.uid() = uid` guard is_blocked()/is_community_visible_to() already
-- use -- only ever returns a real answer when the caller is asking about
-- themselves, false otherwise. Every real caller in this codebase already
-- invokes this as check_is_admin(auth.uid()), so this is a no-op for every
-- legitimate call and closes the "learn whether an arbitrary account is an
-- admin" disclosure for a caller who passes someone else's id -- with zero
-- grant changes, so it can't recreate the internal-caller breakage above.
create or replace function public.check_is_admin(uid uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select case
    when uid = auth.uid() then coalesce((select is_admin from profiles where id = uid), false)
    else false
  end;
$$;
