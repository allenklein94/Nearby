# Live-verify scripts

10/10 roadmap Part 8, then extended by "Scorecard to 10" Phase 1 items 2-3
(see `CLAUDE.md`): real, repeatable scripts for the critical-path failure
modes this codebase's own history has repeatedly verified by hand,
one-off, in a manual session — double-accept race, expiry, decline,
duplicate submission, mutual-swipe race, block enforcement. These turn
that manual process into something the next schema change can re-run
instead of re-deriving.

## A real concurrency harness (`lib/concurrency.js`)

Every race-fix verification in this codebase's own history before Phase 1
item 2 was proven only via *sequential* replay (call, await, call again) —
this sandbox had never been able to force two genuinely overlapping DB
transactions. `lib/concurrency.js` closes that gap using a technique
confirmed empirically before relying on it: the Supabase Management API's
`database/query` endpoint opens a real, separate Postgres backend
connection per HTTP request and holds it open for that request's full
query string (confirmed via two distinct `pg_backend_pid()` values
completing in ~one `pg_sleep()` duration, not two sequential ones, and via
a `pg_advisory_lock()` test showing a second connection's own lock
attempt genuinely blocks at the Postgres level while a first connection
holds the same lock).

`runOverlapping({ holderQuery, racerQuery, racerDelayMs })` fires a
"holder" query that explicitly locks a real row (`... FOR UPDATE`) and
then `pg_sleep()`s while still holding it, then — without ever awaiting
the holder first — fires a "racer" query after a fixed delay (default
900ms, long enough for the holder to have already acquired its lock and
entered the sleep). The racer's own attempt to touch the same locked row
(often via the real RPC under test, which does its own internal
`FOR UPDATE`) is then genuinely blocked at the Postgres level until the
holder commits — proving the racer's post-block behavior was actually
forced to wait for the holder's real commit, not racing a stale
pre-commit read.

**A real, previously-undocumented quirk of the Management API endpoint
was found and is now documented in `lib/db.js`**: when the true last
statement in a multi-statement batch returns zero rows, the endpoint
silently falls back to reporting the last statement that *did* have a
non-empty result, instead of `[]` — confirmed directly
(`select 111 as a; select 222 as b where false;` returns `[{"a":111}]`,
not `[]`). Any assertion that expects a genuinely empty final result
(e.g. "RLS correctly filtered this out") must wrap it in
`select count(*) as c from (...) x` instead and assert on the count,
never rely on an empty array from the raw last statement.

**A second real gotcha, already known from this codebase's own history
but worth restating here**: `runSqlAs()` sets the `request.jwt.claims`
GUC but the Management API's own connection runs as the table-owner role
(`postgres`), which bypasses RLS entirely regardless of that GUC. That's
fine for proving an app-level `auth.uid()` check *inside* a SECURITY
DEFINER function body (every existing script's use of `runSqlAs`), but
proving RLS itself needs a genuine `SET ROLE authenticated` in the same
session — `runSqlAsRls()` does exactly that (confirmed empirically:
`current_user` really flips from `postgres` to `authenticated`).

**These run real SQL against the real production database**, using
disposable, clearly-tagged test data (`raw_text`/`title` fields all start
with `live-verify:`) that each script creates and deletes itself in a
`finally` block, restoring any pre-existing state it had to read first
(see `gathering-approve-double-review.js`'s own comment on why a blind
"delete anything matching my test id" cleanup is not safe by itself).

## Setup

```bash
export SUPABASE_ACCESS_TOKEN=<a real Supabase Management API access token>
# Optional, defaults to this app's own project:
export SUPABASE_PROJECT_REF=enmosvippabmuqslzrox
```

## Running

```bash
# One check:
node scripts/live-verify/business-offer-double-accept.js

# Everything, in sequence:
node scripts/live-verify/run-all.js
```

Each script exits non-zero if any of its own assertions fail, so it's
CI-runnable as-is (just supply the token as a secret).

## What's covered

- `business-offer-double-accept.js` — a second `accept_business_offer()`
  call on an offer already accepted (and its parent request already
  fulfilled) must be rejected, never silently re-processed.
- `gathering-approve-double-review.js` — a second `approve_gathering_interest()`
  call on an interest row already approved must be rejected, never
  re-counted against capacity a second time.
- `business-request-expiry-and-decline.js` — the hourly
  `expire_stale_business_requests()` cron function actually expires a
  genuinely stale open request and its pending/offered offspring;
  `decline_business_offer()` correctly transitions to `declined` and
  rejects a second decline on the same offer.
- `business-request-duplicate-submission.js` — `create_business_request()`'s
  own spam guard returns the same request id for an identical repeat ask
  instead of creating a second row and re-running the fan-out.
- `business-offer-double-accept-concurrent.js` — the concurrent
  counterpart to `business-offer-double-accept.js`, using the real
  concurrency harness: two genuinely overlapping `accept_business_offer()`
  calls on the same offer, proving the row lock actually serializes them.
- `gathering-approve-double-review-concurrent.js` — same idea for
  `approve_gathering_interest()`.
- `friend-discovery-swipe-race-concurrent.js` — the one race this whole
  codebase's history had explicitly flagged as "not independently
  reproduced under true concurrency" (Aug 16 2026 Friend Discovery
  acceptance-audit entry). Forces two genuinely overlapping,
  opposite-direction "like" swipes on the same pair and proves
  `record_friend_discovery_swipe()`'s row lock closes the
  lost-mutual-match race, not just that the lock clause is present.
- `is-blocked-hides-blocker-from-blocked-party.js` — the single
  most-repeated security invariant in this codebase's history: after a
  real block, the *blocked* party's own session (genuine RLS, via
  `runSqlAsRls`) must lose visibility into the match/messages and be
  rejected from sending a new message — the exact bug the SECURITY
  DEFINER fix on `is_blocked()` closed.
- `group-plan-confirm-offer-quorum-race-concurrent.js` — Finding C2,
  closed. `confirm_group_plan_offer()`'s own first row lock (on
  `group_plan_proposals`, not the offer row) genuinely serializes two
  overlapping quorum-completing confirmations on a real 2-participant
  group plan: the holder's own call correctly reads a pre-race count
  (`allConfirmed: false`), the racer's call — genuinely blocked at the
  Postgres level until the holder commits — correctly sees the fresh
  count and triggers the real accept exactly once (the offer flips to
  `accepted` and the request to `fulfilled` exactly once, never raced
  into an inconsistent or double-executed state).
- `group-plan-cross-proposal-exclusivity-concurrent.js` — Finding C3,
  closed. `propose_group_plan()`'s own `for update of br` lock on the
  shared invitee's `business_requests` row, plus the partial unique index
  on `group_plan_participants(source_request_id)`, genuinely prevent the
  same open request from landing as an active participant in two
  different, concurrently-proposed group plans: the holder's proposal
  succeeds; the racer — genuinely blocked until the holder commits — hits
  the now-committed unique index, is silently skipped by the function's
  own "world changed between fetch and submit" handler, and since that
  was its only invitee, the whole racer proposal correctly rolls back.

## What's not covered

Everything else this file's own history has verified live, one-off, over
many sessions — this is a growing set matching the highest-value failure
modes and races named across the 10/10 roadmap's Part 8 plan and the
"Scorecard to 10" Phase 1 plan, not a full regression suite. Extend this
directory the same way (one script per real, previously-manual
verification) as more schema changes land.
