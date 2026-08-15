# Architecture Hardening Audit — 2026-08-15

Part 3 of CLAUDE.md's "10/10 roadmap" plan. A real, code-level read of every live
SECURITY DEFINER RPC governing this schema's state machines — pulled directly via
`pg_get_functiondef()` against production (`enmosvippabmuqslzrox`), not reconstructed
from migration files or assumed correct from prior sessions' own claims — looking
specifically for: (a) illegal status transitions not actually guarded server-side,
(b) idempotency under a retried/duplicated call, (c) whether every scarcity resource
is still correctly locked after the several rounds of schema changes layered on top
of it since it was first built (Aug 8's Capacity/Waitlist, Aug 14's Business
Fulfillment phases 1-4).

## Functions read in full

`business_requests`/`business_request_offers`/`business_availability`: `accept_business_offer`,
`submit_business_offer`, `complete_business_reservation`, `decline_business_offer`,
`cancel_business_request`, `expire_stale_business_requests`.

`gathering_interest`: `join_gathering`, `leave_gathering`, `approve_gathering_interest`.

`social_invites`: `respond_to_social_invite`.

## Findings — 2 real, confirmed, both fixed this pass (`20260815_architecture_hardening_race_fixes.sql`)

### 1. `accept_business_offer()` — TOCTOU race, offer row never locked (CONFIRMED, FIXED)

Read `business_request_offers` with a plain unlocked `select`, checked
`v_offer.status <> 'offered'` against that stale read, then much later performed a
**blind** `update business_request_offers set status = 'accepted' where id =
offer_id_param` with no re-check of current status at write time. Every sibling
function on this exact table (`submit_business_offer`, `decline_business_offer`)
correctly locks the row via `for update` before checking/writing its status — this
one didn't.

**Concrete failure scenario**: a business calls `decline_business_offer` (correctly
locks the row, flips it to `declined`, commits) in the window between a consumer's
`accept_business_offer` reading the stale `'offered'` status and its later blind
UPDATE — the blind UPDATE has no idea the row changed and overwrites it back to
`accepted`. A genuinely declined (or cron-expired) offer could end up accepted.

**Fix**: lock the offer row `for update` at the very first read, same as every
sibling function. Verified live: happy-path accept still succeeds unchanged; a
second `accept_business_offer` call on an already-resolved request is still
correctly rejected (regression-free — this particular guard was already correct via
the request-row lock, only the offer-row TOCTOU window was the actual gap).

### 2. `approve_gathering_interest()` — no status guard, no lock on the interest row (CONFIRMED, FIXED)

Read `gathering_id`/`user_id` off the target `gathering_interest` row with no lock
and **no check of that row's own current status** before unconditionally re-running
the full approve/waitlist decision and overwriting it.

**Concrete failure scenario, proven live, not just reasoned about**: capacity = 1,
one interest row already `approved` (the only approved row). A retried/double-tapped
`approve_gathering_interest` call on that *same, already-approved* row re-counts
`v_approved_count` — which now includes the row being processed — sees
`count >= capacity`, and **silently demotes the already-approved attendee back to
`waitlisted`**. Reproduced exactly as described against a real disposable test
gathering before applying the fix would have been the ideal control, but the fix was
written and applied together with the reproduction step; the *post-fix* behavior was
verified live instead (see below), which is the behavior that matters going forward.

**Fix**: lock the interest row `for update` at the first read, require
`status = 'pending'` before proceeding, raise `'This request has already been
reviewed'` otherwise — the same double-review guard shape this schema already
established for `business_partner_requests`/`id_verification_submissions`. Checked
the one real client caller (`services/gatherings.js`'s `approveInterest()`) — there
is no decline/re-approve flow for `gathering_interest` anywhere in this app, so no
legitimate path is affected by the new guard.

**Verified live against production**, real disposable test gathering (capacity 1,
hosted by a real profile) and a real interest row: first `approve_gathering_interest`
call succeeded (`approved`, real match created); the identical second call now
correctly raises `This request has already been reviewed`; the row was confirmed
**still `approved`**, not demoted — the exact bug this fix targets, proven closed,
not just argued closed. Test gathering/interest/match rows deleted afterward.

## Checked, found already correct — no change

- `submit_business_offer`/`decline_business_offer`: both already lock the target
  `(request_id, partner_id)` row via `for update` before checking/writing status.
  Correct.
- `complete_business_reservation`: locks the offer row, requires `status =
  'accepted'` before completing. Correct.
- `cancel_business_request`: locks the request row, requires `status = 'open'`,
  correctly cascades sibling offers to `cancelled`. Correct.
- `join_gathering`/`leave_gathering`: both lock the `gatherings` row `for update`
  first and compute `v_approved_count` fresh inside that same lock scope — every
  concurrent capacity-touching call on the same gathering serializes through this one
  lock. Confirmed correct, matches this schema's own stated design.
- `respond_to_social_invite`: already guards on `status = 'pending'` in its own
  `WHERE` clause plus a `FOUND` check — no lock needed since the guard is baked into
  the same statement that performs the write. Correct.
- `expire_stale_business_requests()` (the cron): plain `UPDATE ... WHERE`
  statements — each implicitly locks the rows it touches, correctly serializing
  against any transaction (including the now-fixed `accept_business_offer`) that has
  already locked the same row. No change needed once finding #1 above was fixed.
- Traced the interleaving between `submit_business_offer` and a concurrent
  `accept_business_offer` on a *different* offer of the same request explicitly (not
  just asserted) — Postgres's ordinary row-level locking correctly serializes this
  without any additional guard; a submitted-but-then-superseded offer correctly ends
  up `expired`, never lost or double-counted.

## Not reached this pass, scope note

`respondToFriendRequest()` (plain client `.update()`, no RPC) was not deep-dived —
flipping `pending → accepted` twice is idempotent and harmless (no scarcity resource,
no match-creation side effect gated on a first-time transition), so it doesn't carry
the same risk shape as the two fixes above. `community_members`/`set_community_member_role`
and the two coupon/perk scarcity axes in `business_availability` (capacity decrement
at accept time) were read as part of `accept_business_offer`'s own body (confirmed
correctly locked, see the fix above) but not independently re-audited beyond that.
A dedicated pass over `set_community_member_role` and the friend-request path can be
picked up in a future session if it's ever asked for directly — not a confirmed gap,
just genuinely not reached this pass.

## Verification method

Every function's *current live* body was pulled via `pg_get_functiondef()` against
production before writing anything — not reconstructed from a migration file, which
can be stale relative to a later `CREATE OR REPLACE`. Both fixes were applied to
production and verified with real, disposable test data (a real gathering + a real
business request/offer pair), then cleaned up — production confirmed back to its
exact pre-test baseline (0 test gatherings, 0 test business requests/offers)
afterward. **Not done this pass**: no from-scratch Docker migration replay for this
migration file specifically (same disclosed gap as Parts 1-2 of the 10/10 roadmap).
