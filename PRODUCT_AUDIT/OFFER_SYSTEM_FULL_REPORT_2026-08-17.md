# The Offer System — Full Report, All 6 Phases (Aug 17 2026)

Supersedes `OFFER_SYSTEM_PHASES_4_5_6_REPORT_2026-08-17.md` (deleted — folded in here so there's
one complete record instead of a partial one plus inline notes scattered across `CLAUDE.md`).

## Context

"The Offer System" is the plan that took Nearby's `Request → Offer → Commitment` loop — the
existing Business Fulfillment marketplace — and closed the six real gaps between it and an
external strategic vision doc that argued for the same loop from a different angle. Before any
building, six product decisions were locked directly by the user (not inferred), plus one
standing architectural rule. All six phases below implement those locked decisions. Full
decision text lives in `CLAUDE.md`'s "Outstanding: 'The Offer System'" section; summarized here
only as needed to explain what each phase built.

**The six locked decisions, in one line each:**
1. "Your Options" comparison UI — the data path already existed (`Request → 0..N Offers`); only
   the UI treatment was new (Phase 3).
2. A real Reservation seam, separate from "Offer Accepted" — `Accepted` on an Offer must never
   mean `Confirmed` on a Reservation (Phase 1).
3. Social Offer — a general primitive, first surfaced only inside Group Plans, restricted to
   already-connected people (Phase 4).
4. Dating match → business Request requires an explicit *Proposal* step — a bare match never
   authorizes a fan-out (Phase 5).
5. Stripe / Resy / OpenTable / Uber — out of scope this pass, but build the inert seams now since
   they're cheap (Reservation + Payment, both in Phase 1).
6. Offer lifecycle — refined into `pending → offered (+ viewed_at) → accepted → completed`, plus
   a new `withdrawn` terminal state (Phase 1).

**Standing architectural rule, governing every phase**: the business side never directly writes
the consumer's Experience state and vice versa — each actor only ever reports its own side's
state; Nearby's own SECURITY DEFINER RPCs compute the derived overall state, never a client.

---

## Phase 1 — Reservation + Payment seams, Offer-lifecycle refinements

**What it is:** Closes Decisions 2, 5, and 6 together in one migration, since all three touch the
same two tables (`business_request_offers`, plus two new tables).

**Built:**
- `business_request_offers` gained `viewed_at` (nullable, set once, idempotent) and a new
  `'withdrawn'` status value, additive to the existing CHECK constraint. New
  `withdraw_business_offer()` RPC (owner-only, only valid from `offered`).
- New `business_reservations` table — `offer_id` (unique FK), `status`
  (`requested|confirmed|failed|cancelled`), `provider` (`'nearby'` today), `provider_reference`,
  `confirmed_at`, `failed_at`/`failure_reason`. `accept_business_offer()` extended (not rewritten)
  to also insert this row (`confirmed`, `provider='nearby'`) immediately — zero behavior change
  for any real user, since Nearby is its own initial reservation provider.
- New `business_payments` table — `reservation_id`, `status`
  (`not_required|pending|authorized|captured|failed|refunded`), `amount`, `currency`, `payer_id`,
  `provider`, `provider_transaction_id`. Only `not_required` is ever written this pass — an
  honest, inert seam, not a fabricated pending state.
- `complete_business_reservation()` re-pointed to check/update `business_reservations`, not just
  the Offer's own status.
- New `mark_business_offer_viewed()` RPC — a genuine, idempotent read receipt.

**A real bug found and fixed while verifying, not glossed over:** the concurrency-proof script
`business-offer-double-accept-concurrent.js` had documented `accept_business_offer()`'s first
lock as being on the offer row — re-checking the live function found the real first lock is on
the parent `business_requests` row. The reversed assumption produced a genuine Postgres deadlock
(`40P01`) once this phase's two new `INSERT`s lengthened the transaction. Fixed by locking
`business_requests` first, matching the function's real order; re-ran clean.

**Verified live** (`enmosvippabmuqslzrox`) with new `scripts/live-verify/offer-reservation-payment-seam.js`:
an accepted offer produces a real `confirmed`/`provider='nearby'` reservation and a real
`not_required` payment carrying the offer's own price; `withdraw_business_offer()` only succeeds
from `offered`; `mark_business_offer_viewed()` is genuinely idempotent; `complete_business_reservation()`
now genuinely requires a confirmed Reservation (rejected on a withdrawn offer, which never got
one). All test rows cleaned up; production confirmed back to baseline.

**Verified via a from-scratch Docker migration replay** — hit a real, previously-undocumented
filename-ordering bug in the process: `20260817_business_acquisition_first_consumer_interaction.sql`
sorted alphabetically *before* `20260817_business_discovery_analytics.sql`, the migration that
actually creates the table it depends on (`business_profile_views`) — a landmine invisible on
live production (which was built in real chronological order) but fatal to a fresh replay. Fixed
by renaming to `..._v2_...`. Re-ran the full 61-file replay clean — exit 0.

**Also fixed while in this area:** bumped `run-all.js`'s inter-script delay 2s → 4s after the
suite's growing request volume started tripping the documented `ThrottlerException` gotcha.

**Commits:** `4b0b30c8`, `3a5fde2c`, `0214e0dd`

---

## Phase 2 — Business fulfillment policies

**What it is:** Closes Decision-adjacent Gap 2 from the vision-doc audit — a standing, reusable
auto-accept rule engine per business, distinct from `business_availability`'s one-shot posting.

**Built:**
- New `business_fulfillment_policies` table — one policy per partner (`unique(partner_id)`),
  owner-only SELECT RLS, no direct client write. Real fields: `party_size_min/max`,
  `active_hours_start/end` (a single daily time window, matching `business_availability`'s own
  simplest-shape precedent), `min_spend_per_person`, `max_discount_pct`,
  `auto_accept_party_size_max`, `deposit_amount` (stored only — Phase 1's inert Payment seam,
  no charge fires), `cancellation_window_hours`.
- New `upsert_business_fulfillment_policy()` RPC — the only write path.
- New internal `_match_request_to_policy()` helper (locked down, zero grants, SECURITY DEFINER
  nested-call-only), wired into both `create_business_request()` and
  `create_business_request_for_gathering()` right after their existing fan-out/availability
  matching — additive only, every prior matching pass byte-for-byte unchanged. Reuses the same
  reliability-weighted candidate ordering and the same `ON CONFLICT ... WHERE status='pending'`
  upgrade-path convention, so a policy-matched offer can never clobber an already-`offered` row.
- New Business Dashboard "Fulfillment Policy" card + full editor modal on the Requests tab.

**Verified live** with new `scripts/live-verify/business-fulfillment-policy-auto-accept.js`: a
real 4-person request at the `auto_accept_party_size_max` boundary is genuinely auto-offered with
no manual step, honestly naming the policy in its own description; a real 6-person request (over
the auto-accept bound, still within the party-size range) correctly stays `pending`; an inactive
policy never auto-accepts anything. **One real baseline-drift gotcha hit and resolved during
verification, not worked around**: 2 orphaned test rows from an unrelated earlier throttled
script run were found and deleted before the "back to exact baseline" assertion could pass —
exactly the disclosed "a throttled run can still leave an orphaned row" gap Phase 1 already
named.

**Verified via a from-scratch replay** — all 62 files, exit 0.

**Commit:** `a999b7d9`

---

## Phase 3 — "Your Options" comparison view

**What it is:** Closes Decision 1 — a real ranked comparison screen for 2+ concurrent live
offers on the same request. UI-only, no schema change, since the underlying data path
(`Request → 0..N Offers`) was already real and live.

**Built:**
- `BusinessRequestDetailScreen.js` computes a real `offeredCount`/`showComparison`
  (`offeredCount >= 2`) from the already-fetched `offers` array — no new query. When true, a real
  "🔍 Compare Your Options" header renders above the existing reliability-ordered `displayOffers`
  list; each `offered` row now also shows its real `offer_type` (a new `OFFER_TYPE_LABELS` map —
  the value was already stored/fetched but never rendered) and, when present, a real
  "👁 You've seen this" line backed by `viewed_at`. Below the evidence bar (fewer than 2
  concurrent offers — the common case), the screen renders exactly as before.
- **One necessary piece of wiring the plan text implied but didn't spell out**: Phase 1 built
  `mark_business_offer_viewed()` but nothing ever called it. Closed with a new
  `markBusinessOfferViewed()` client wrapper, fired fire-and-forget for every currently-`offered`
  row the moment the requester's session loads the screen.

**Verified live**: confirmed the real `select('*')` shape genuinely returns `offer_type`/
`viewed_at`, and confirmed calling `mark_business_offer_viewed()` exactly as the client now does
against a real disposable pair genuinely sets `viewed_at`, idempotently on repeat.

No new live-verify script needed — no schema/RPC changed, and the one RPC call wired in was
already exhaustively proven by Phase 1's own script.

**Commit:** `cf0d0d9d`

---

## Phase 4 — Social Offer primitive (Group Plans-scoped)

**What it is:** Closes Decision 3 — a general primitive letting any *connected person* (not just
a business) propose how they'll fulfill part of a Request — e.g. "I'll drive," "I'll host" —
distinct from a commercial business offer, with a deliberately narrow first surface.

**Built:**
- New `social_offers` table — `request_id`, `offerer_id`, `offer_description`, `status`
  (`offered|accepted|declined|withdrawn|expired|cancelled`, mirroring the commercial-offer
  lifecycle verbatim), `viewed_at`, `unique(request_id, offerer_id)`. Owner/requester/
  group-plan-participant-only SELECT RLS.
- `submit_social_offer()` — re-validates eligibility server-side on every call against the exact
  connected-set Decision 3 names: accepted friendship, match, shared community, or shared
  gathering (host or approved attendee) — a strictly *wider* set than Tier 2/Group Plans' own
  friend-or-match-only rule, per the user's own explicit broadening. Never trusts the client.
- `respond_to_social_offer()` — requester-only, deliberately **not** given commercial offers'
  full-consensus group-plan guard, since a Social Offer never competes for one winning slot the
  way a commercial reservation does — multiple social offers can be accepted independently, a
  genuinely different scarcity model.
- `mark_social_offer_viewed()` — added proactively, same idempotent read-receipt shape as Phase
  3's commercial-offer equivalent.
- Client: `src/services/socialOffers.js`; `getGroupPlanDetail()` now also fetches
  `social_offers`; `GroupPlanScreen.js` gained a real "Social Offers" section — the first shipped
  surface, deliberately scoped to an existing confirmed Group Plan's own roster, not a general
  "invite anyone to offer" screen.

**Verified live** with new `scripts/live-verify/social-offer-group-plan.js`: builds a real
confirmed group plan from scratch (Allen as initiator, real friendship with Claude, real match
with Google voice) and proves: a genuine stranger is rejected both submitting and responding; the
request's own requester can't offer on their own request; a genuinely connected participant can
submit, a repeat submit while still `offered` is rejected; **real RLS** (`SET ROLE
authenticated`, not just a JWT claim) genuinely restricts visibility to offerer/requester/every
confirmed participant; a non-requester participant can't accept/decline someone else's offer;
`mark_social_offer_viewed()` is a genuine no-op for the offerer and idempotent for the requester;
accept is the real happy path, a second response to an already-accepted offer is rejected.

**Two real cleanup-ordering FK bugs found and fixed while verifying, confirmed via the real
`23503` error, not a swallowed catch**: `group_plan_participants.source_request_id` and
`confirm_group_plan()`'s own `superseded_by_group_plan_id` stamp both reference the 3 original
per-participant requests — so `group_plan_participants` must be deleted before those requests,
which must be deleted before the proposal itself, on top of the already-known
`group_plan_id`/`resulting_request_id` FK cycle. Fixed and re-run clean twice.

**Verified via a from-scratch replay** — all 63 files, exit 0.

**One disclosed hygiene finding, not fixed, matching the established pattern**: `social_offers`
carries the same standing `anon`/`authenticated` default-table-grant artifact every sibling
table from Phases 1–2 already has — not independently exploitable (RLS is deny-by-default with
zero matching write policies), flagged rather than silently fixed to avoid a broader,
out-of-scope hardening pass.

**Commit:** `1b2862dd`

---

## Phase 5 — Dating match → Proposal → Business Request bridge

**What it is:** Closes Decision 4 — the locked shape *Match → Proposal → Other person accepts →
Dating Experience → Business Request*. A mutual match alone was never supposed to authorize
fanning a request out to businesses; one person proposes a real plan, the other explicitly
accepts it ("Match ≠ Date," the same parallel as Decision 2's "Accepted ≠ Confirmed").

**Built:**
- Checked live first, per the plan's own instruction — confirmed no existing table covered this
  (`date_checkins` is the unrelated safety check-in feature; `group_plan_proposals` is Phase D's
  own multi-person mechanism) — so built new: `date_proposals` (`match_id`, `proposed_by`,
  `plan_text`, `status`: `proposed|accepted|declined|withdrawn`, `created_at`, `responded_at`),
  with a partial unique index allowing only one genuinely pending proposal per match at a time.
- `business_requests` gained a nullable `match_id` FK, mirroring `gathering_id`'s own shape.
- Four new RPCs:
  - `propose_date()` — checks the caller is a real match participant, checks blocks, sends a
    push.
  - `respond_to_date_proposal()` — the actual "Match ≠ Date" enforcement: only the non-proposer
    can accept/decline; the proposer's own attempt to respond gets the same real rejection a
    stranger's would.
  - `withdraw_date_proposal()` — proposer-only, only while still pending.
  - `create_business_request_for_match()` — the real gate: raises a real, honest error
    (`'A plan must be proposed and accepted by your match before asking businesses.'`) unless a
    genuinely *accepted* proposal exists. Party size hardcoded to 2 (both participants, never
    user-typed, matching the gathering path's own "server-computed, not user-supplied"
    precedent). A duplicate fan-out attempt returns the existing real id with `duplicate: true`.
- New `is_match_participant()` helper (SECURITY DEFINER, internally guards
  `auth.uid() = user_id_param`) backing two additive SELECT policies so a match-sourced request
  is genuinely visible to **both** participants, not just whoever submitted it.
- Client: `src/services/dateProposals.js`, new `DateProposalScreen.js` (renders whatever's
  currently true — propose / accept-decline-withdraw / "Find Somewhere to Go →"), a new "💌 Plan
  Something Together" row in `ChatScreen.js`'s Together menu (gated on `isRomanticMatch`), and a
  new third mode on `AskBusinessScreen.js` for match-sourced requests (party size always 2,
  hidden; date chips kept since an accepted plan has no fixed date the way a gathering does).

**Verified live** with new `scripts/live-verify/date-proposal-business-request.js` (29
assertions) — reused the one real existing match already in production (Google voice ↔ Allen,
matching this suite's own "reuse real connections, don't fabricate new ones" convention). Proved
under real RLS: a non-participant can neither propose nor respond and sees zero rows; only one
pending proposal per match at a time; the proposer genuinely cannot accept/decline their own
proposal; the fan-out is rejected both before any proposal exists *and* after a real decline; a
fresh proposal is allowed once the prior one is declined/withdrawn; only the real proposer can
withdraw, and a repeat withdraw is rejected; once genuinely accepted, the fan-out succeeds with a
real `party_size: 2`; a repeat fan-out returns the same id with `duplicate: true`; the resulting
request is visible to **both** match participants and invisible to a genuine stranger.

**Verified via a from-scratch replay** — all 64 files, exit 0, `pg_cron`/`pg_trgm` created
cleanly with no workaround needed this run.

**Deliberately not built, disclosed rather than silently skipped**: no auto-expiry cascade for a
proposal stuck at `'proposed'` forever — the locked status list has no `'expired'` value, and the
recipient can always explicitly decline while the proposer can always withdraw, so nothing here
can hang silently forever without an action already available to resolve it.

**Commit:** `6aed0c85`

---

## Phase 6 — Prove-the-loop checkpoint (not a build phase)

**What it is:** The user's own explicit closing question, asked at the start of the whole plan:
*"Are these primitives clean enough that Nearby can go from a user's intent → a business/person's
Offer → commitment → reservation → eventual transaction → completed Experience without
rewriting the architecture?"*

**What was done:** No new schema. Built one comprehensive live-verify script —
`offer-system-prove-the-loop.js` — that walks a single real disposable request through the
entire chain **with a commercial offer and a social offer coexisting on it at once**, confirming
every state transition matches the locked lifecycle in Decisions 2 and 6 exactly, with no object
skipping a state or being written by the wrong actor:

1. Real disposable request created.
2. A real commercial offer submitted by the real business owner (Allen) *and* a real social offer
   submitted separately by Allen as an individual friend of the requester (Claude) — the one real
   connected pairing this sparse production dataset actually supports, noted honestly in the
   script's own header — both land at `offered` simultaneously, neither affecting the other.
3. Commercial offer accepted by the real requester.
4. Confirmed this **did not** touch the social offer — proving `accept_business_offer()`'s
   one-winner exclusivity sweep only ever reaches `business_request_offers`, never
   `social_offers`. Two primitives genuinely coexist on one request; a real different scarcity
   model, not an oversight.
5. A real `business_reservations` row confirms (`status: confirmed`, `provider: nearby`, a real
   `confirmed_at`).
6. A real `business_payments` row exists (`status: not_required`, a real `$12.50` amount
   correctly attributed to the real payer — honestly inert, per Decision 5, no processor
   connected).
7. `complete_business_reservation()` closes it out — rejected for a genuine stranger, succeeds
   for the real requester, the offer reaches its real terminal `completed` state with a real
   `completed_at`, the Reservation stays `confirmed` (completion tracked on the Offer, not a
   second terminal Reservation state), a repeat completion attempt is rejected.
8. Re-checked the social offer at the very end — still sitting at `offered`, completely
   undisturbed by the entire commercial lifecycle running to completion around it.

**Result:** All 26 assertions passed clean on the first real run (after fixing one arg-order bug
in the test script itself, caught before it could produce a false result). Production confirmed
back to its exact pre-test baseline afterward. No schema change this phase, so no from-scratch
replay was needed; no client change either, so no `npx expo export` was needed.

**Consequence, per the user's own instruction:** Since it passed clean, **the Offer System's
conceptual architecture stops expanding here.** `CLAUDE.md`'s closing status was rewritten to say
so explicitly — the only work that follows on these primitives is hardening/polish, not another
new object or phase.

**Commit:** `c7aeaaec`

---

## What's still open (disclosed across the whole initiative, not silently dropped)

- **No manual device/simulator run-through** of any of the UI this whole initiative built —
  Phase 1's Reservation/Payment dashboard surfaces, Phase 2's Fulfillment Policy card/editor,
  Phase 3's "Compare Your Options" view, Phase 4's Social Offers section, Phase 5's "Plan
  Something Together" flow. Same standing gap repeated across this whole codebase's history —
  no session in this sandbox has ever had simulator/device access.
- **Stripe / a real external reservation or transportation provider** (Resy, OpenTable, Uber) —
  explicitly out of scope per Decision 5. The inert Reservation/Payment seams exist specifically
  so a real provider can plug in later without a second migration; needs the user present for
  that external-vendor/account and legal/product decision, not something to pick up
  autonomously.
- **Outcome/rating capture** after a completed reservation (the vision doc's own "did it work?"
  closing node) — has no home anywhere in this six-phase plan; flagged during planning as a real
  gap deliberately left out of scope rather than silently dropped, matching how the original
  Business Fulfillment Phase 2 flagged the identical gap once already.

---

## Verification bar held on every phase

Every schema change: applied to production and independently verified live with real disposable
test data, cleaned up afterward and confirmed back to the exact pre-test baseline, plus a
from-scratch Docker migration replay (a truly empty database, `psql -v ON_ERROR_STOP=1`, exit 0)
before being considered done. Every client change: a clean `npx expo export --platform ios`. Each
phase: its own commit(s), pushed individually as it landed — not batched at the end — so a
mid-session restart never lost more than one phase's worth of work.

| Phase | Commit(s) |
|---|---|
| Plan lock (6 decisions + architectural rule) | `c0f79c1c` |
| Phase 1 (Reservation + Payment seams) | `4b0b30c8`, `3a5fde2c`, `0214e0dd` |
| Phase 2 (Fulfillment policies) | `a999b7d9` |
| Phase 3 ("Your Options" comparison) | `cf0d0d9d` |
| Phase 4 (Social Offer primitive) | `1b2862dd` |
| Phase 5 (Match → Proposal → Business Request) | `6aed0c85` |
| Phase 6 (Prove-the-loop checkpoint) | `c7aeaaec` |
