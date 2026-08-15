# "Nearby V3/V4" Plan — Phases A–D Audit (2026-08-15)

*Prepared as a handoff document for an independent AI reviewer. Everything below describes work
actually built, applied to production, and verified — not a plan or a proposal. Confidence
markers used throughout: **VERIFIED LIVE** (re-tested directly against production with real
disposable data after building), **VERIFIED VIA REPLAY** (confirmed to exist in a from-scratch
database rebuild), **CLIENT VERIFIED** (bundle/parse/test-suite clean), **NOT DONE** (a real,
disclosed gap, not silently skipped). Nothing in this document is marked done unless it was
actually checked by one of these methods — see "Verification methodology" at the end for what
each marker actually means and its limits.*

## 1. Context: what "Nearby V3/V4" is and where Phases A–D sit

Nearby is a React Native/Expo app on a Supabase backend combining proximity dating, group event
hosting ("gatherings"), topic communities, and a local-business fulfillment marketplace. Earlier
the same day (2026-08-15), the codebase already had a working "intent layer": a user types what
they want ("dinner tonight for two"), a resolver checks existing supply (gatherings, communities,
friends'/matches' own open asks, business perks, live business availability), and — if nothing
existing fits — the ask becomes a real `business_requests` row that fans out to nearby businesses,
which can respond with a real `business_request_offers` row the consumer can accept into a
reservation.

A user then pasted a second, more polished external strategic pitch (8 numbered ideas framed as 4
layers: Discovery / Intent / Marketplace / Intelligence). Before writing any plan, the codebase
was checked idea-by-idea against what already existed. The headline finding: **most of the pitch
was not new** — several ideas were already fully built under different names from earlier the same
day. Two ideas (composed multi-source itineraries + a single blended "match %" score) were
explicitly rejected as fabrication-risk and not scheduled. Two ideas were genuinely new and
buildable without inventing any data: real time-window granularity on already-collected demand
data (**Phase A**), and letting reliability data that already existed actually *influence*
marketplace ordering instead of just being displayed (**Phase C**). One idea was already fully
built as a mechanism but missing a one-tap shortcut into it (**Phase B**). One idea — merging
independent friends' asks into one real group transaction — was recognized as a genuinely new
mechanism with real open design questions (consent, ownership, reconciliation) and was
deliberately **not built on a guess** — flagged for the user's own explicit design call
(**Phase D**, built later the same day once that call was given).

**All four phases are DONE, build-wise**, per the verification records below.

---

## 2. Phase A — real time-window granularity on aggregated business demand

**What it does**: `BusinessDashboardScreen`'s existing "Demand Near You" section (real aggregated
counts of open `business_requests` in a business's own category/radius) already showed
category/party-size/soonest-date. Phase A adds a fourth real line: which part of the day
(morning/afternoon/evening) most of that open demand actually asked for — e.g. *"mostly evening
(2 of 3)"* — computed from `business_requests.time_window_start`, a column that already existed
and was already collected on every ask, just never surfaced in this aggregate.

**What changed**:
- `get_aggregated_demand_for_partner()` (SECURITY DEFINER RPC) extended from a 4-column return to
  6 columns, adding `dominant_period`/`dominant_period_count`. A request with no time window still
  counts toward the total but never shifts the dominant period. Zero time-windowed requests in a
  category correctly returns `null`/`null`, not a fabricated default.
- `notify_aggregated_demand_threshold()` (the trigger that pushes a business once real nearby
  demand crosses a threshold) was **deliberately not** also scoped per-time-period — explicit
  scope decision, not an oversight, to avoid multiplying dedup bookkeeping for no real payoff at
  current volume.
- `BusinessDashboardScreen.js`: one new line on the existing "Demand Near You" row, shown only
  when at least one real request in that category actually specified a time.

**Real bugs caught while building** (not just applying):
1. The migration's first draft used bare `category`/`soonest_date`/`dominant_period` identifiers
   inside a plpgsql function body — ambiguous with the function's own OUT parameters, failed at
   *call time* (not apply time) with "column reference is ambiguous." Fixed by renaming every CTE
   column.
2. A migration-filename-ordering bug: the new file initially sorted *before* an unrelated
   same-day migration that also contained a stale `create or replace` of the same function
   (restoring the old 4-column shape) — would have silently clobbered the 6-column version on a
   true from-scratch rebuild, even though it worked fine against already-live production (where
   the 6-column version was already the newest definition either way). Caught by *actually
   replaying* the full migration folder in filename order, not by inspection. Fixed by renaming
   the file to sort after its dependency.

**VERIFIED LIVE** against production (`enmosvippabmuqslzrox`): grants confirmed
(`authenticated` yes, `anon` no); a real disposable 4-row scenario (3 Coffee requests — 2 evening,
1 morning — plus 1 with no time window, against a temporarily-repositioned real business)
produced hand-checked-exact output at every step, including the no-time-window request correctly
not shifting the dominant period; a second category with zero time-windowed requests correctly
returned nulls; a non-owner's call correctly returned nothing. All test data deleted, production
confirmed back to its exact pre-test baseline (0 `business_requests`).

**VERIFIED VIA REPLAY**: 35-file from-scratch migration replay, exit 0, new 6-column function
confirmed present (not the old 4-column shape).

**CLIENT VERIFIED**: direct parse + clean `npx expo export --platform ios` (one file edited, no
new files).

**NOT DONE**: no manual simulator/device run — the time-window line has never been visually
confirmed rendering correctly against real data on an actual device/screen.

---

## 3. Phase B — one-tap "Turn this into an offer" shortcut

**What it does**: a business owner looking at a "Demand Near You" row can now tap "→ Turn into an
offer" and land directly in the existing (already-built, already-verified) "Post Availability"
flow, pre-filled with the row's real category and — when Phase A found one — the real dominant
time window (e.g. suggested title *"Coffee available this evening"*, falling back to *"Coffee
available"* when no dominant period exists yet). Every field, including the suggested title,
stays fully editable before posting — nothing auto-submits.

**What changed**: pure UI wiring onto an already-existing, already-verified mechanism
(`postBusinessAvailability()`, built earlier the same day as part of the broader intent-layer
work) — no new backend RPC, no schema change. `openPostAvailabilityModal()` gained an optional
`{ category, dominantPeriod }` prefill parameter.

**Real bug caught while building**: the existing blank-start "+ Post Availability" button was
passing the modal-opening function *directly* as the `onPress` handler — which, once that
function gained an optional parameter, would have silently passed React's synthetic event object
as the new `prefill` param instead of `undefined`. Harmless in practice (an event object has no
`.category`/`.dominantPeriod`), but fixed to be explicit (`() => openPostAvailabilityModal()`)
rather than relying on that coincidence.

**CLIENT VERIFIED**: direct parse + clean `npx expo export --platform ios` (one file edited, no
new files, no schema change — this phase needed no database work at all).

**NOT DONE**: no manual simulator/device run — never confirmed on a real screen that the button
opens the modal with the right category chip pre-selected and the right suggested title, or that
posting from there still correctly matches against real open requests the same way the
blank-start path already does.

---

## 4. Phase C — reliability-weighted fan-out and offer ordering

**What it does**: reliability data (response rate, acceptance rate, completion rate per business
partner) already existed and was already *displayed* to consumers
(`formatPartnerReliabilityLine()`). It was never *used* anywhere — a new request fanned out to
eligible businesses in plain radius/recency order, and a consumer saw multiple live offers in
whatever order they happened to arrive. Phase C makes both orderings prefer businesses with a
real, established completion-rate track record, without excluding anyone.

**What changed**:
- `_business_request_fanout()` and `_match_request_to_availability()` (internal, zero-grant
  SECURITY DEFINER helpers — never directly callable by any client, only from within
  `create_business_request`/`create_business_request_for_gathering`/`post_business_availability`)
  re-pointed via `CREATE OR REPLACE`, same signatures. Only the `ORDER BY` changed — for the
  fan-out, also the CTE it reads from. Every other line, including all push-notification logic,
  is byte-for-byte unchanged from the live, already-proven version (pulled fresh from production
  before editing, confirmed byte-identical to the last local migration — no drift to reconcile).
- New ordering: `(established DESC, completion_rate DESC NULLS LAST, distance/recency ASC)`, where
  `established` = 5+ real past `business_request_offers` rows for that partner — the same real
  threshold `formatPartnerReliabilityLine()` already uses client-side, not a new number invented
  for this. `completion_rate` computed inline with the identical arithmetic
  `get_partner_offer_reputation()` already uses (not called as a separate RPC, since this runs
  inside another SECURITY DEFINER function over the same table).
- A partner below the 5-opportunity threshold is **never penalized**: `completion_rate` is `null`
  for them, `NULLS LAST` groups every non-established partner together below the established
  ones, and *within* that group the original distance-asc/recency-desc tie-break is completely
  unchanged — a brand-new partner lands exactly where it would have landed before this change.
- `BusinessRequestDetailScreen.js`'s own offer list gained a `useMemo`-derived `displayOffers`
  that reorders only the subset of offers still in `'offered'` status (the ones a consumer is
  genuinely deciding between) by the identical rule, and only when 2+ such offers actually exist
  to compare. Every other row (pending/declined/accepted/expired/completed) keeps its original
  `created_at` position untouched.

**Real bug caught while drafting, before it ever touched a database**: the fan-out's first draft
had `select e.id, e.id` in an `INSERT ... SELECT` (both columns reading the partner id, neither
the actual `request_id_param`) — caught by re-reading the file before applying it, fixed to
`select request_id_param, e.id`.

**VERIFIED LIVE** against production, not just applied: confirmed both internal helpers remain
correctly locked down post-replace (`authenticated`/`anon` both still `false` on execute — neither
is or was ever meant to be directly callable). Built a real disposable scenario — two test
partners at the *exact same coordinates* (so distance can't explain any ordering difference), one
given 5 real completed historical offers (crossing the threshold, confirmed
`get_partner_offer_reputation()` returns `total_opportunities: 5, completion_rate: "100.0"`
exactly), the other with zero history. Calling the fan-out directly on a real new request
correctly inserted the established partner's offer row *before* the no-history partner's
(physical insertion order confirmed via `ctid`) despite being equidistant — proving the ordering
is genuinely driven by reliability, not a coincidence of distance or timestamp. All test data
deleted, production confirmed back to its exact pre-test baseline.

Additionally **verified via a larger controlled scenario in a local Docker replay**: 3 partners at
3 genuinely different distances, plus a cap-exceeding 6-posting availability-matching scenario —
confirmed the established, high-completion partner wins even when it is the *farthest away*;
confirmed a lower-completion established partner still outranks every no-history partner;
confirmed the `LIMIT 5` cap correctly drops the lowest-priority (no-history) postings first when
eligible candidates exceed it, not an arbitrary subset.

**VERIFIED VIA REPLAY**: 37-file from-scratch migration replay, exit 0, both re-pointed functions
confirmed present with the new `ORDER BY`.

**CLIENT VERIFIED**: direct parse of both touched files + clean `npx expo export --platform ios`
(two files edited, one new migration, no new client files).

**NOT DONE**: no manual simulator/device run — never confirmed the reordered offer list actually
*reads* correctly on a real screen once 2+ real offers exist for the same request, or that the
already-shown reliability line stays visually consistent with the new tap order.

---

## 5. Phase D — group intent → a real, jointly-owned business request

This is the largest and highest-stakes of the four phases: converting "N connected people
independently have an open ask in the same category" into one real, group-consented, jointly
owned business transaction. Unlike A–C, this was **not built on an AI-guessed design**. The open
design questions (does merging need consent, what happens to individual requests, who owns the
result, how do party size/budget reconcile) were explicitly surfaced to the user rather than
answered by the coding session. The user reviewed those questions and returned a full, locked,
14-rule specification, explicitly framed as *"I would not let Claude make these decisions itself,
because they define the social/transaction model."* Everything below is a literal implementation
of that spec, not a reinterpretation.

### 5.1 The locked rules (verbatim intent, as implemented)

1. Explicit consent from every participant — never a silent merge.
2. Existing individual requests are never deleted — they transition to a real
   "merged/superseded" state and keep their own history/audit trail.
3. The resulting shared request is **group-owned** — the initiator is the operational submitter,
   not a unilateral owner.
4. A merged individual request must not also independently generate a duplicate business
   opportunity.
5. Party size = the real sum of every committed participant's own party size + guests — never
   averaged, never invented.
6. Budget is reconciled into a real range from real individual numbers; the group's *final*
   number is always set explicitly by a human — never silently averaged or overwritten.
7. A material change (date/time/budget/party size/offer) after someone already consented requires
   real re-consent from them — no silent carry-forward onto terms they never saw.
8. A business offer is only accepted on the group's behalf once **every** currently-required
   participant has explicitly confirmed it — never a single person's own tap.
9. A decline doesn't automatically kill the group — the initiator explicitly decides whether to
   wait, exclude that person, or continue with who's left.
10. A participant leaving *after* a real offer exists invalidates that offer's not-yet-complete
    confirmations, so the remaining group can't coast to a reservation on stale consent.
11. Never expose a participant to an unexpected business transaction.
12. User-facing terminology is "group plan" / "do this together" — never "merge" or "proposal" in
    any on-screen copy.
13. A complete, real audit trail — every individual request, every consent, every roster change,
    every offer confirmation, stays queryable.
14. Stay entirely within the existing "no stranger discovery via intent" boundary: every candidate
    participant must already have a real, open, same-category `business_requests` row of their
    own, and must already be a genuinely connected person (accepted friendship or match) — the
    identical connected-set definition the app's own existing Tier 2/Layer 3 mechanisms already
    use, re-validated server-side on every write, never trusted from the client.

### 5.2 What was built

**Schema** (`20260815_v3_group_plans_phase_d.sql`): three new tables.
- `group_plan_proposals` — initiator, category, real reconciled `proposed_budget_min`/
  `proposed_budget_max` (computed from real individual `budget_max` values at proposal time),
  `agreed_budget_max` (settable only via an explicit RPC call, never defaulted), `status`
  (`pending|confirmed|cancelled|expired`), `resulting_request_id`.
- `group_plan_participants` — one row per person, `source_request_id` pointing at their own real
  pre-existing request, `party_size`/`guest_count`, `status`
  (`invited|accepted|declined|left`).
- `group_plan_offer_confirmations` — one row per `(offer, participant)` confirmation — the actual
  mechanism behind rule 8.

`business_requests` gained two nullable columns (`group_plan_id`, `superseded_by_group_plan_id`)
and a widened `status` CHECK adding `'merged'` as a new value — zero behavior change for any
pre-existing row.

**Seven new RPCs**, all SECURITY DEFINER, no direct client INSERT/UPDATE on any of the three new
tables (matching this schema's established convention everywhere else):

- `propose_group_plan(source_request_id, invitee_source_request_ids[])` — the initiator's own
  request becomes participant #1 (auto-accepted, since proposing *is* consent). Every invitee id
  is independently re-validated server-side against rule 14's exact connected-set definition — a
  stale or spoofed client-supplied id is silently skipped, never trusted.
- `respond_to_group_plan(proposal_id, accept)` — each invitee's own explicit consent (rule 1),
  double-response guarded.
- `set_group_plan_budget(proposal_id, agreed_budget_max)` — initiator-only, bounded to the real
  proposed range. **This is rule 7's actual mechanism**: it resets every already-accepted
  non-initiator participant back to `'invited'` (with a real push explaining why) whenever the
  budget genuinely changes.
- `confirm_group_plan(proposal_id, exclude_user_ids[])` — initiator-only, requires an explicitly
  set `agreed_budget_max` and 2+ real accepted participants. `exclude_user_ids` lets the initiator
  continue without someone even if they already accepted ("continue without Sarah" — rule 9).
  Creates the one real shared `business_requests` row (real summed party size, real explicit
  budget, real coordinates from the initiator's own already-collected source request), fans it out
  via the *exact same* fan-out/availability-matching functions every solo request already uses
  (no second mechanism), and flips every accepted participant's own individual source request to
  `'merged'` — never deleted (rule 2). Anyone excluded/declined/never-responded keeps their own
  request exactly as it was, still independently open.
- `cancel_group_plan(proposal_id)` — initiator-only, pending-only.
- `leave_group_plan(proposal_id)` — any non-initiator participant, at any stage. After the
  group's real request already exists, leaving clears that person's own not-yet-complete offer
  confirmations (rule 10).
- `confirm_group_plan_offer(proposal_id, offer_id)` — rule 8's actual mechanism: one confirmation
  row per accepted participant; only the confirmation that makes `confirmed = required` actually
  triggers acceptance, via a new internal `_accept_business_offer_internal()` (the identical logic
  the pre-existing `accept_business_offer` uses, minus its own requester-ownership check — caller
  authority here comes from "every required participant confirmed," not from `auth.uid()` owning
  the row). Locked down with zero grants to any role, callable only via a nested SECURITY DEFINER
  call — same established pattern as this schema's other internal helpers.

**One small, deliberate change to a pre-existing function**: `accept_business_offer()` gained
exactly one new guard clause (`CREATE OR REPLACE`, every other line byte-for-byte unchanged from
the live version pulled fresh from production before editing): a request with `group_plan_id` set
can never be accepted by its own `requester_id` alone — only `confirm_group_plan_offer`, once
every required participant has confirmed, can accept it. **This is rule 11's actual server-side
enforcement**, not just a UI convention — even a client bug or a direct RPC call cannot let the
initiator unilaterally accept on the group's behalf.

**RLS**: two new additive SELECT policies (OR'd with the existing requester-only/business-only
ones, never narrowing anything) so every group participant — not just the initiator — can see the
real shared request and its real offers, gated by a new `is_group_plan_participant(proposal_id,
user_id)` helper matching the same "SECURITY DEFINER bypasses RLS, internal `auth.uid()` guard"
pattern this schema already established elsewhere for similar cross-table visibility problems.

**Client**: `src/services/groupPlans.js` (thin RPC wrappers), `src/screens/GroupPlanScreen.js` +
route (the one real screen every participant sees, rendering whatever's actually true for the
caller right now: invited → Accept/Decline; accepted, pending → Leave; initiator, pending → set
budget / confirm-with-exclude / cancel; confirmed → real offers with a live "N of M confirmed"
count and a "Confirm for the Group" action). On-screen copy never says "merge" or "proposal"
anywhere (rule 12). Three entry points added to the existing `BusinessRequestDetailScreen.js`: a
"People you know are also asking for this" section with a checkbox picker on the caller's own open
request; a banner when this exact request is itself someone else's still-pending invite; and a
banner once merged/confirmed. The screen's own solo Accept button is replaced by a "Confirm With
the Group" link for a group-plan request, so the UI never even offers an action the RPC would now
reject. Five new push-notification-tap routes, all landing on the same `GroupPlanScreen`.

### 5.3 Verification

**VERIFIED LIVE** against production, across four separate disposable-data scenarios using real
pre-existing connected pairs in production (an accepted friendship and a match):

1. **Full happy path**: 3-person proposal (budgets $50/$75/$100) → real proposed range
   `$50–$100` verified exact → double-respond correctly rejected → budget outside range correctly
   rejected both directions → non-initiator budget-set correctly rejected → setting the budget
   correctly reset both non-initiator participants back to `invited` (rule 7 — *proven*, not
   assumed) → confirming with only 1 of 3 truly accepted correctly rejected → after re-accepting,
   non-initiator confirm correctly rejected → confirm succeeded with real `partySize: 4` (1+1+2,
   rule 5) and the real explicit `budget_max: 50` → all three individual source requests correctly
   flipped to `merged` with `superseded_by_group_plan_id` set (rule 2) → double-confirm correctly
   rejected → a real offer inserted against the resulting request → **a direct solo
   `accept_business_offer` call by the initiator was correctly rejected** (rule 11's enforcement,
   proven against a real attempt, not just present in the SQL text) → a random non-participant's
   confirm attempt correctly rejected → first confirmer: 1 of 3 → idempotent re-confirm → second
   confirmer: 2 of 3, offer still `offered` → third (final) confirmer correctly triggered the real
   accept (offer → `accepted`, request → `fulfilled`).
2. **RLS via an actual role switch** (`set role authenticated`, not just reading `auth.uid()`
   inside an RPC — genuinely enforcing row-level security, not just testing application logic): a
   real non-participant stranger got real `null`/empty results querying the proposal, the
   participant roster, the resulting request, and its offers directly; every real participant
   correctly saw all four.
3. **Leaving pre-confirmation**: a participant left before the group's real request existed →
   confirmed their own source request stayed `open`, untouched, while the remaining participant's
   correctly merged; resulting party size correctly reflected only who stayed.
4. **Initiator excludes an already-accepted participant at confirm time**: proving rule 9's
   "continue without Sarah" specifically for someone who *already said yes* (not just someone who
   never responded) — their source request correctly stayed `open`, and the resulting party size
   correctly excluded them.

Also directly verified: non-initiator cannot cancel; cancelling a pending proposal leaves both
source requests fully untouched; confirming after cancel is correctly rejected; the extended hourly
expiry-sweep function (which now also expires stale never-decided proposals) runs clean.

All test rows across all four scenarios (14 disposable `business_requests`, 4
`group_plan_proposals` and their cascaded participants, 1 offer) were deleted afterward — including
correctly nulling both sides of the `business_requests.group_plan_id` ↔
`group_plan_proposals.resulting_request_id` foreign-key cycle before deleting either table.
Production confirmed back to its exact pre-test baseline (0 rows across every touched table).

**VERIFIED VIA REPLAY**: 38-file from-scratch migration replay, exit 0 throughout — all 3 new
tables and all 9 new/changed functions (including the modified `accept_business_offer`) confirmed
present in the freshly-rebuilt database.

**CLIENT VERIFIED**: direct parse of all 5 touched/new files, the existing 42-test Jest suite
unchanged and still 42/42 passing, and a clean `npx expo export --platform ios`.

### 5.4 Explicitly not built (disclosed, not silently skipped)

- A live capacity/price re-quote from the business when a participant leaves after an offer
  already exists. Rule 10's own text only requires invalidating stale confirmations (built); a
  true re-quote would need the business to actively re-price, which no mechanism in this schema
  does even for a solo, non-group request.
- A UI affordance for the initiator to remove an already-accepted participant *before* confirm
  time, outside the confirm-time exclude picker. The exclude list only ever applies at the moment
  of confirming, matching the RPC's own real shape.
- `complete_business_reservation` (marking a fulfilled reservation as completed after the fact)
  was left completely untouched — that's an operational step after the group's real acceptance
  already happened via full consent, not a new binding decision the 14 rules govern.

**NOT DONE**: no manual simulator/device run-through — next session should confirm the full flow
end-to-end in the running app: proposing from a real open request's candidate list, receiving and
responding to a real push-delivered invite, the budget re-consent reset actually surfacing
correctly to a re-invited participant on a real screen, and the "N of M confirmed" UI updating
correctly across two real accounts in real time.

---

## 6. Cross-cutting notes for the reviewer

- **No payment collection anywhere in any of the four phases**, matching this app's own
  long-standing, explicit, repeatedly-reaffirmed decision to defer Stripe/payment-processor
  integration — real money moving is treated as a decision requiring the user's own direct
  involvement (a real external account), not something to build autonomously.
- **No new stranger-discovery surface was introduced by any phase**, including Phase D. Every
  phase operates strictly on data that already existed (real open requests, real reliability
  history, real accepted friendships/matches) — nothing fabricated, no invented percentages, no
  guessed defaults presented as real numbers. Where a real number genuinely didn't exist (e.g. a
  category with zero time-windowed requests in Phase A, a partner below the reliability threshold
  in Phase C), the response is an honest `null`/unranked state, never a fabricated placeholder.
- **The single largest standing gap across all four phases is identical and repeated verbatim in
  every section above**: none of this has been exercised in a real running app on a real
  simulator or device. Every verification claim above is either (a) a real, disposable-data test
  run directly against the production Postgres database via the Supabase Management API — proving
  the backend logic is correct — or (b) a clean client bundle/parse/test-suite run — proving the
  code compiles and existing tests still pass. Neither proves the actual on-screen UI renders,
  looks right, or feels right to a real user tapping through it.
- Phases A–C are additive changes to an already-live, already-verified marketplace mechanism built
  earlier the same day; Phase D is the first genuinely new transactional mechanism in this pass and
  received proportionately more scrutiny (a locked human specification before any code, four
  distinct live test scenarios instead of one, an actual RLS-enforcing role switch rather than
  relying solely on RPC-internal `auth.uid()` checks).

## 7. Verification methodology (what each marker means, and its limits)

- **VERIFIED LIVE**: real SQL executed against the actual production database
  (`enmosvippabmuqslzrox`) via the Supabase Management API, using real disposable test rows and,
  where relevant, `set_config('request.jwt.claims', ...)` (and for Phase D's RLS check, an actual
  `set role authenticated` role switch — the earlier phases relied on RPC-internal `auth.uid()`
  checks, which do not by themselves prove row-level security is enforced at the table level; this
  distinction is worth an independent reviewer's attention). All test data was deleted afterward
  and production was independently confirmed back to its exact pre-test row counts.
- **VERIFIED VIA REPLAY**: the entire `supabase/migrations/` folder was applied in filename order,
  with `psql -v ON_ERROR_STOP=1`, against a truly empty Postgres database (a locally-run
  `supabase/postgres` Docker image, schema dropped and recreated), and the new objects were
  confirmed to exist afterward. This is the only way to prove a fresh project can actually be
  rebuilt from committed files alone — live-production verification alone cannot catch a
  migration-ordering or duplicate-definition conflict, since production was never rebuilt from
  these files in the first place.
- **CLIENT VERIFIED**: every touched/new JavaScript file was parsed directly via `@babel/core`
  with the project's own Expo preset (catches real syntax errors), and a full
  `npx expo export --platform ios` was run to confirm the whole app still bundles with no
  resolution errors. Where applicable, the existing Jest suite was re-run and confirmed unchanged.
- **NOT DONE**: stated plainly wherever it applies, never silently omitted. The single standing
  gap across every phase in this document is the same: no manual simulator or physical-device
  run-through has occurred for any of this work.
