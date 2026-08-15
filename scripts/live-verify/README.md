# Live-verify scripts

10/10 roadmap Part 8 (see `CLAUDE.md`'s "10/10 roadmap" plan): real,
repeatable scripts for the critical-path failure modes this codebase's own
history has repeatedly verified by hand, one-off, in a manual session —
double-accept race, expiry, decline, duplicate submission. These turn
that manual process into something the next schema change can re-run
instead of re-deriving.

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

## What's not covered

Everything else this file's own history has verified live, one-off, over
many sessions — these four scripts are a starting set matching the
specific failure modes named in the 10/10 roadmap's Part 8 plan, not a
full regression suite. Extend this directory the same way (one script per
real, previously-manual verification) as more schema changes land.
