# The Offer System — Phases 4, 5, 6 Report (Aug 17 2026)

## Context

This picked up "The Offer System" (Request → Offer → Commitment → Reservation → Payment →
Experience) right where a prior session left off — Phases 1–3 were already done (see
`CLAUDE.md`'s own "Outstanding: 'The Offer System'" plan for the full six-decision design and
Phases 1–3's own status notes). This session built Phases 4–6, the final three phases of the
plan, and closed the initiative out.

---

## Phase 4 — Social Offer primitive (Group Plans-scoped)

**What it is:** A general primitive letting any *connected person* (not just a business) propose
how they'll fulfill part of a Request — e.g. "I'll drive," "I'll host" — distinct from a
commercial business offer.

**Built:**
- New `social_offers` table — `request_id`, `offerer_id`, `offer_description`, `status`
  (`offered|accepted|declined|withdrawn|expired|cancelled`, mirroring the commercial-offer
  lifecycle), `viewed_at`, `unique(request_id, offerer_id)`.
- `submit_social_offer()` — re-validates eligibility server-side on every call against a real
  connected-set: accepted friendship, match, shared community, or shared gathering. Never trusts
  the client.
- `respond_to_social_offer()` — only the request's own requester can accept/decline.
- `mark_social_offer_viewed()` — idempotent read receipt.
- Client: `src/services/socialOffers.js`, a new "Social Offers" section wired into
  `GroupPlanScreen.js` — the first shipped surface, deliberately scoped to an existing confirmed
  Group Plan's roster, not a general "invite anyone" screen.

**Verified:** New `scripts/live-verify/social-offer-group-plan.js` — builds a real confirmed
group plan from scratch and proves eligibility checks, real RLS visibility (a stranger sees
nothing; the whole confirmed roster sees the offer), and accept/decline behavior. Found and
fixed two real cleanup-ordering FK bugs while verifying. Plus a from-scratch migration replay
(63 files, exit 0).

**Commit:** `1b2862dd`

---

## Phase 5 — Dating match → Proposal → Business Request bridge

**What it is:** The locked shape *Match → Proposal → Other person accepts → Dating Experience →
Business Request*. A mutual match alone was never supposed to authorize fanning a request out to
businesses — one person has to propose a real plan, and the other has to explicitly accept it
("Match ≠ Date").

**Built:**
- Checked live first (per the plan's own instruction) — confirmed no existing table covered
  this, so built new: `date_proposals` (`match_id`, `proposed_by`, `plan_text`, `status`:
  `proposed|accepted|declined|withdrawn`, `created_at`, `responded_at`), with a partial unique
  index allowing only one pending proposal per match at a time.
- `business_requests` gained a nullable `match_id` column (mirroring `gathering_id`).
- Four new RPCs:
  - `propose_date()` — checks the caller is a real match participant, checks blocks, sends a
    push.
  - `respond_to_date_proposal()` — the actual "Match ≠ Date" enforcement: rejects the proposer
    trying to respond to their own proposal.
  - `withdraw_date_proposal()` — proposer-only, only while still pending.
  - `create_business_request_for_match()` — the real gate: raises an error unless a genuinely
    *accepted* proposal exists for the match. Party size is hardcoded to 2 (never user-typed).
- New `is_match_participant()` helper (SECURITY DEFINER) backing two additive RLS policies so a
  match-sourced request is visible to **both** participants, not just whoever submitted it.
- Client: `src/services/dateProposals.js`, a new `DateProposalScreen.js`, a "💌 Plan Something
  Together" entry in `ChatScreen.js`'s Together menu (gated on romantic matches), and a new third
  mode on `AskBusinessScreen.js` for match-sourced requests.

**Verified:** New `scripts/live-verify/date-proposal-business-request.js` (29 assertions) —
reused the one real existing match in production (Google voice ↔ Allen). Proved: non-participants
can't propose/respond; only one pending proposal per match; the proposer can't accept their own
proposal; the fan-out is rejected before acceptance *and* after a decline; withdraw/re-propose
works; the happy path produces a real `party_size: 2` request visible to both sides under real
RLS. Plus a from-scratch migration replay (64 files, exit 0) and a clean `npx expo export`
(2189 modules).

**Commit:** `6aed0c85`

---

## Phase 6 — Prove-the-loop checkpoint (not a build phase)

**What it is:** The user's own explicit closing question: *"Are these primitives clean enough
that Nearby can go from a user's intent → an Offer → commitment → reservation → transaction →
completed Experience without rewriting the architecture?"*

**What was done:** No new schema. Built one comprehensive live-verify script —
`offer-system-prove-the-loop.js` — that walks a single real disposable request through the
entire chain **with a commercial offer and a social offer coexisting on it at once**:

1. Real request created.
2. Commercial offer submitted by the real business owner (Allen) *and* a social offer submitted
   separately by Allen as an individual (he's a real friend of the requester, Claude) — both land
   at `offered` simultaneously.
3. Commercial offer accepted by the requester.
4. Confirmed this **did not** touch the social offer — proving `accept_business_offer()`'s
   one-winner exclusivity sweep only ever reaches `business_request_offers`, never
   `social_offers`.
5. A real `business_reservations` row confirms (`status: confirmed`, `provider: nearby`).
6. A real `business_payments` row exists (`status: not_required`, correct amount/payer —
   honestly inert, no processor connected).
7. `complete_business_reservation()` closes it out — rejected for a stranger, rejected on a
   repeat call, succeeds for the real requester.
8. Re-checked the social offer at the very end — still sitting at `offered`, completely
   undisturbed by the entire commercial lifecycle running to completion around it.

**Result:** All 26 assertions passed clean on the first real run (after fixing one arg-order bug
in the test script itself). Production confirmed back to its exact pre-test baseline.

**Consequence, per the user's own instruction:** Since it passed clean, **the Offer System's
conceptual architecture stops expanding here** — `CLAUDE.md`'s closing status was rewritten to
say so explicitly, so a future session doesn't read "6 phases done" as license to keep adding new
objects. What follows is hardening/polish only.

**Commit:** `c7aeaaec`

---

## What's still open (disclosed, not silently dropped)

- **No manual device/simulator run-through** of any of this session's UI (Social Offers section,
  "Plan Something Together" flow) — same standing gap as everywhere else in this codebase's
  history.
- **Stripe / a real external reservation provider** — explicitly out of scope per Decision 5,
  needs the user present for that call.
- **Outcome/rating capture** after a completed reservation — flagged, not built, same as before
  this session.

---

## Verification bar held on every phase

Every schema change: applied to production and independently verified live with real disposable
test data, cleaned up afterward, plus a from-scratch Docker migration replay (truly empty
database → exit 0). Every client change: a clean `npx expo export --platform ios`. Each phase:
its own commit, pushed individually as it landed.
