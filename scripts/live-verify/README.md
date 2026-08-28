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
- `business-acquisition-funnel-e2e.js` — the Business Partner acquisition
  funnel's own "still open" item (see CLAUDE.md's Milestone 6): a real
  disposable test business run all the way through the complete funnel,
  not just its individual event-firing pieces proven in isolation —
  apply (4 client-fired events) → a real pending
  `business_partner_requests` row → the real admin
  `approve_business_partner_request()` RPC (fires `apply_approved` +
  `published` atomically, creates the real `brand_partners` row, sets the
  owner's `managed_partner_id`) → `dashboard_viewed` on mount →
  `update_business_profile()` + `profile_completed` → a real first offer
  + `first_offer_created` → a real consumer's first-ever profile view,
  which fires `first_consumer_interaction` via the `business_profile_views`
  AFTER INSERT trigger exactly once (and confirms a second view from a
  different consumer does NOT re-fire it) → a real admin call to
  `get_business_acquisition_funnel_stats()` confirming every one of those
  steps' counts, and a real owner call to `get_business_discovery_stats()`
  confirming the real view counts (plus that a non-owner gets zeroed, not
  leaked, stats). Also documents a real, disclosed gap found along the
  way: the funnel-stats RPC never rolls up `profile_completed`/
  `dashboard_viewed` at all, even though both are real, valid event
  values this run genuinely fired — confirmed directly, not fixed (out of
  this script's own scope; a future pass extending that RPC should read
  this script's own assertion for why it's known-missing, not assume it
  was overlooked).
- `business-acquisition-unauthorized-access.js` — the funnel's own third
  adversarial review pass: a real attacker (an uninvolved profile)
  attempting unauthorized apply/edit/publish access against another
  real business's data (the real Coastal Coffee partner) -- spoofing
  another `requester_id` on a new application, editing/publishing an
  offer for a business they don't manage, self-approving or denying
  their own pending application (admin-only), reading another
  business's private CRM notes, spoofing another user's id on the
  newest event-logging tables (`business_profile_views`/
  `business_acquisition_events`), and pulling another business's real
  discovery/funnel stats -- every one correctly rejected, and the real
  owner's own equivalent legitimate action is proven to still work
  (a fix that rejects everyone isn't a real fix). Captures and restores
  every one of the real partner's editable fields before/after, not a
  subset -- the first draft of this exact script found and fixed its
  own real mistake here (see the script's own comment): a partial
  before/after capture silently wiped the real Coastal Coffee's
  `category` from `food_drink` to `null`, caught by this script's own
  final "back to exact pre-test state" assertion and restored by hand
  before the fix landed.
- `offer-reservation-payment-seam.js` — "The Offer System" Phase 1 (see
  CLAUDE.md's own plan): the new Reservation + Payment seams and the
  three Offer-lifecycle refinements. Proves `accept_business_offer()`
  now creates a real, immediately-`confirmed` `business_reservations`
  row (`provider = 'nearby'`) and a real, permanently-`not_required`
  `business_payments` row alongside the offer's own `accepted` status —
  the two objects are checked independently, not just the offer's own
  status, so "Accepted" and "Confirmed" can never silently collapse
  back into one fact. Proves `withdraw_business_offer()` is a real,
  distinct state (only valid from `offered`, rejected from any other
  status including `accepted`, rejected for a non-owner), that
  `mark_business_offer_viewed()` is a real, idempotent, ownership-scoped
  read-receipt (a stranger's call is a silent no-op, the real requester's
  call sets it exactly once even across repeat calls), and that
  `complete_business_reservation()` now genuinely requires a confirmed
  Reservation to exist, not just an `accepted` Offer. Fixing this script
  also surfaced and fixed a real, disclosed bug in
  `business-offer-double-accept-concurrent.js` itself (see that script's
  own comment) — it had been locking the wrong row first, a latent
  deadlock risk that Phase 1's slightly longer transaction was enough to
  actually trigger.
- `business-fulfillment-policy-auto-accept.js` — "The Offer System" Phase
  2 (see CLAUDE.md's own plan, Gap 2). Proves `business_fulfillment_
  policies` and the new `_match_request_to_policy()` matching pass wired
  into `create_business_request()`: a real owner-set standing policy
  (party size 2-8, 5-10 PM, auto-accept parties of 4 or fewer) genuinely
  auto-offers a real 4-person request with no manual business step, a
  real 6-person request (over the auto-accept bound but still within the
  policy's own party-size range) correctly stays `pending` for manual
  review, and a genuinely inactive (`active=false`) policy never
  auto-accepts anything. Also proves the upsert RPC's own real ownership
  check, its discount-percent bound, and that a repeat upsert for the
  same partner updates the same row rather than creating a second one.
- `social-offer-group-plan.js` — "The Offer System" Phase 4 (see
  CLAUDE.md's own plan, Decision 3). Proves the real, general
  `social_offers` primitive end-to-end through a real confirmed group
  plan, the plan's own first shipped surface: eligibility is genuinely
  re-validated server-side (a real stranger is rejected submitting an
  offer; the request's own requester can't offer on their own request; a
  repeat submit while still `offered` is rejected); real RLS (`SET ROLE
  authenticated`, not just a JWT claim) genuinely scopes visibility to the
  offerer, the request's requester, and the rest of the confirmed
  group-plan roster — a stranger sees nothing; only the request's own
  requester can accept/decline, not just any confirmed participant; and
  `mark_social_offer_viewed()` is a genuine, requester-scoped, idempotent
  read receipt. Found and fixed two real cleanup-ordering bugs while
  verifying (`group_plan_participants.source_request_id` and
  `confirm_group_plan()`'s own `superseded_by_group_plan_id` stamp both
  reference the original per-participant requests, which must be deleted
  before the group plan proposal itself) — not a throttling flake,
  confirmed by getting the real `23503` FK-violation error instead of
  trusting a swallowed `.catch()`.
- `date-proposal-business-request.js` — "The Offer System" Phase 5 (see
  CLAUDE.md's own plan, Decision 4), the dating-match bridge into the
  Request/Offer system. Proves the locked `Match → Proposal → Other
  person accepts → Dating Experience → Business Request` shape holds for
  real, through a real existing match: a non-participant can neither
  propose nor respond, and sees zero rows under real RLS; only one
  genuinely pending proposal can exist per match at a time; the real
  "Match ≠ Date" gate — the proposer cannot accept/decline their own
  proposal, only the other person can; `create_business_request_for_match()`
  is rejected with no accepted proposal at all, and stays rejected after a
  real decline — a bare match, or a declined proposal, never authorizes
  the fan-out; withdrawing a still-pending proposal frees the match up
  for a genuine new one; once truly accepted, the fan-out succeeds with a
  real `party_size=2` (never user-typed) and the resulting request is
  correctly `match_id`-attributed; a repeat fan-out call on the same
  still-open request returns the same real id with `duplicate: true`, not
  a second row; and real RLS (`SET ROLE authenticated`) makes the
  resulting request visible to BOTH match participants, not just
  whichever one submitted it, and invisible to a genuine stranger.
- `offer-system-prove-the-loop.js` — "The Offer System" Phase 6 (see
  CLAUDE.md's own plan), the whole initiative's own prove-the-loop
  checkpoint: one real disposable request walked through Request →
  Offer → Commitment → Reservation → Payment → completed Experience,
  with a real commercial offer AND a real social offer coexisting on the
  SAME request the entire time. Proves `accept_business_offer()`'s own
  one-winner exclusivity sweep only ever touches `business_request_
  offers`, never `social_offers` — the two primitives genuinely coexist,
  neither corrupting the other, a real different scarcity model rather
  than an oversight; that `business_reservations` is genuinely
  `confirmed`, distinct from the Offer's own `accepted` status, not
  conflated by coincidence; that `business_payments` is honestly
  `not_required` with a real, correctly-attributed amount/payer,
  permanently inert per Decision 5; that `complete_business_reservation()`
  is rejected for a genuine stranger and rejected a second time once
  already completed; and that the social offer is still sitting exactly
  where it started — `offered`, untouched — after the entire commercial
  loop closed out end-to-end. This is the clean pass the user's own
  explicit instruction was gated on: once it holds, the initiative's own
  conceptual architecture stops expanding — hardening/polish on these
  primitives is the only work that follows, not another new object.

- **`intent-match-business-discovery.js`** — the C2 fix (CLAUDE.md's "connect
  existing consumer-intent + business systems" Section D) and its own
  follow-up Finding 5 fix, both applied via ad hoc verification and never
  given a permanent script until now. Proves a real `intent_match`
  `business_profile_views` row inserts cleanly, a bogus `source` value is
  still rejected by the widened CHECK, the real owner sees
  `intent_match_views` reflect it while a genuine non-owner still gets
  zeroed stats. Also proves the `matchedAvailability` banner's own
  `preferred_availability_id_param` binding: a mismatched-category request
  still binds the exact posting the consumer already reviewed when it's
  genuinely live and in range, the same case with no preferred id still
  correctly excludes it (no regression to the general matching pass), a
  preferred id pointing at a now-cancelled posting falls through cleanly
  with no fabricated offer, and a preferred id genuinely outside the
  request's own radius is still rejected by distance.
- **`match-contacts-rate-limit.js`** — `match_contacts_to_users()`'s rate
  limit, closing a real gap named (not fixed) in the Aug 15 2026 SECDEF
  audit. Proves the per-call 3000-number array cap, the 10-call daily
  limit, and — the actual point of putting the counter behind
  `prevent_self_premium_edit()`'s guard — that a direct client-side attempt
  to reset the counter is silently reverted, not honored.
- **`group-plan-remove-participant.js`** — `remove_group_plan_participant()`,
  closing the disclosed "no kick action before confirm time" gap named
  repeatedly in CLAUDE.md's Group Plans (Phase D) sections. Proves a
  genuine stranger and a genuine non-initiator participant are both
  rejected trying to remove anyone, the initiator can't remove themselves,
  the initiator genuinely can remove a still-invited or an already-
  accepted participant right now without the proposal itself leaving
  `pending`, a repeat removal of an already-left participant is rejected,
  and removal is rejected once the proposal is no longer pending.
- **`weather-dependent-fulfillment-policy.js`** — the Business Intelligence
  plan's Phase 7 (see CLAUDE.md), and the real bug found and fixed while
  building it: a first-draft single function that both submitted a
  `net.http_get()` call and polled `net._http_response` for the result in
  its own transaction can never actually resolve, since pg_net's
  background worker only sees a queued request once the enqueuing
  transaction commits — proven directly (a disposable `DO` block still
  showed an unresolved response after 8 real seconds *inside* its own
  transaction, then resolved the instant a separate call checked it
  again). Fixed with a real two-phase submit/apply split, mirroring
  `submit_weather_request()`/`get_weather_result()`'s own established
  shape. This script proves the full real lifecycle: `_match_request_to_
  policy()` auto-accepts normally with no cached signal yet, a fresh
  cached HIGH rain-risk reading genuinely blocks auto-accept and logs a
  real `weather_unfavorable` exclusion (idempotently, no duplicate row on
  a repeat call), a LOW reading lets it auto-accept again, a >3h-stale
  HIGH reading is correctly ignored rather than blocking on stale data,
  turning `weather_dependent` off clears the cached signal, a non-owner
  is rejected setting the policy, and the real two-phase sweep itself —
  submit queues a real request and doesn't re-queue a still-pending one,
  the real pg_net worker genuinely resolves it once its own transaction
  commits, apply writes the real result and clears the queue row, a
  repeat apply with nothing pending is a no-op, and a genuinely timed-out
  pending row is discarded after 10 minutes without ever touching the
  cached signal.
- **`business-entitlements.js`** — Business Intelligence Phase 8 (see
  CLAUDE.md), real server-enforced feature entitlements over the
  existing `brand_partners.tier`. Proves the config-driven `plan_
  entitlements` matrix end to end: a non-owner is rejected reading a
  business's own entitlements; `create_business_experience()` genuinely
  caps a basic-tier business at 3 (the real reconciled "Signature
  Experiences == Offer Templates" cap) and rejects a 4th with a real,
  client-recognizable error; `get_aggregated_demand_for_partner()`
  genuinely *redacts* `is_demand_gap`/`unmet_intent_count` to false/0 for
  a basic-tier business even when the real underlying data would
  otherwise show them true/nonzero, and the identical row shows the real
  values the instant the tier is upgraded (proving real redaction, not a
  coincidence); `get_missed_match_summary()`/`get_partner_category_
  outcomes()` both reject a basic-tier call with a real `ENTITLEMENT_
  REQUIRED:` error and succeed the moment the tier is upgraded; the new
  `stories.partner_id` INSERT trigger rejects a basic-tier business
  moment and accepts the identical insert once upgraded, while a plain
  personal story (no `partner_id`) is completely unaffected; and the
  admin-only dev tier switch rejects a non-admin and an invalid tier
  value.
- **`ai-trust-engine.js`** — Business Intelligence Phase 6 (see CLAUDE.md,
  Steps 2-3), the real AI Trust Engine sitting on top of Phase 8's
  entitlements. Proves: `set_business_ai_trust_level()` is owner-only and
  genuinely entitlement-checked (Level 2 rejected at basic, granted at
  growth; Level 3 rejected at growth, granted at brand); the central
  `_ai_authorize_action()` gate implements the real fixed 4-tier risk
  taxonomy (critical is *never* authorized regardless of trust level;
  low/medium/high scale with the real trust level); Level 1 auto-applies
  a genuinely fresh `ai_inferred` attribute/category suggestion the
  instant it's created once opted in, logs a real `ai_actions` row, and
  `undo_ai_action()` genuinely reverses it (restores the real pre-change
  value, re-opens the suggestion, rejects a repeat undo) — while a
  `business_confirmed` suggestion or a business still at the default
  trust_level=0 never auto-applies at all; a real, named Level 2
  `business_ai_policies` row only ever auto-responds within its own
  explicit conditions, sourcing its offer's real terms from an
  already-approved `business_experiences` template (never an invented
  price), logs a real `medium`-risk `auto_applied` row on a match and a
  real, deduped `blocked` row with the specific reason on a near-miss;
  and the pre-existing, untouched `business_fulfillment_policies`
  auto-accept engine keeps firing exactly as before for a business that
  never touches any of this.
- **`business-content-resweep.js`** — Decision 6, Phase 5 (see CLAUDE.md),
  the periodic re-sweep job on top of the real Trust & Safety content-
  screening layer (Phases 1-3). Proves: `record_business_content_
  screening()`'s new `source_param` defaults to `submission` (unchanged
  regression check — a submission-source HIGH still auto-blocks), while a
  real `resweep`-source HIGH stays genuinely un-auto-resolved so it
  reaches the admin queue instead; the widened `admin_get_pending_
  content_screenings()` filter surfaces a resweep-source HIGH row while
  still correctly excluding a submission-source one; the resweep-row
  review short-circuit in `admin_review_business_content_screening()` —
  approving OR denying a resweep row never writes its staged snapshot to
  the live business row, only flips `review_outcome`; the real due-batch
  selection in `submit_business_content_resweeps()` correctly queues
  genuinely never-screened `experience`/`offer`/`availability` candidates
  while excluding a `business_profile` screened moments earlier (inside
  the real 30-day window); a repeat submit call doesn't re-queue an
  already-pending target; and the real two-phase pg_net round-trip end to
  end through the actually-deployed `resweep-business-content` Edge
  Function — the queue genuinely clears once each request resolves, a
  repeat apply with nothing pending is a no-op, and a genuinely stale
  (>10 minute) pending row is discarded without ever needing a real
  response. Same standing, already-disclosed Anthropic account credit-
  balance limitation as every other AI feature in this codebase: the
  real classify call inside the Edge Function itself can fail with a
  real 500, which this script reports honestly rather than assumes away —
  the queue/plumbing around it is still proven correct either way.

## What's not covered

Everything else this file's own history has verified live, one-off, over
many sessions — this is a growing set matching the highest-value failure
modes and races named across the 10/10 roadmap's Part 8 plan and the
"Scorecard to 10" Phase 1 plan, not a full regression suite. Extend this
directory the same way (one script per real, previously-manual
verification) as more schema changes land.
