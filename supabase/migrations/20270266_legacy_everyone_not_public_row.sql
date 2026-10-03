-- Owner item 145 follow-up (2026-10-03): one legacy production gathering was saved as visible to everyone
-- (visibility = 'everyone') but not public (is_public = false), from before the visibility column existed. That state
-- made join_gathering treat it as needing review although the host never chose Require approval, an exception the
-- current model does not have (the app saves is_public = false only for invite-only).
--
-- Fix ONLY that known row, matched on its id AND its old values (idempotent: a second run, or a fresh replay where the
-- row does not exist, changes nothing). Its visibility stays 'everyone' (the canonical field every list and push already
-- reads); is_public becomes true; requires_approval stays false (never chosen). Result: public + approval off = one tap,
-- capacity still waitlists independently. No other gathering is touched.
update public.gatherings
   set is_public = true
 where id = '7b152168-d981-4b9a-a947-d168ec9b05c1'
   and visibility = 'everyone'
   and is_public is not true;

-- The ambiguous state can never come back: an Everyone gathering is always public. Friends / Community / Invite-only are
-- not constrained here (out of scope; the app saves Friends/Community public and Invite-only not public).
alter table public.gatherings drop constraint if exists gatherings_everyone_is_public;
alter table public.gatherings
  add constraint gatherings_everyone_is_public check (visibility <> 'everyone' or is_public is true);
