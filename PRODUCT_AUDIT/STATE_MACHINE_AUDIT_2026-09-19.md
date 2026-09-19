# State-machine audit: decline, cancellation, propagation (2026-09-19)

Scope (user request): decline needs a real state that reaches consumer, business dashboard, request, offer, notifications,
recommendations, reservation, analytics; cancellation must be global (gathering, occasion plan, business reservation -> the
Plan knows). "No ghost offers, no stale buttons, no accepting something already declined."

Method: live `pg_constraint` / `pg_proc` / `pg_trigger` inspection of production (project enmosvippabmuqslzrox) plus the
function bodies, cross-read against the client. Code-derived, not exercised: production has 1 business request, 0 reservations,
0 offers with real history, so none of the gaps below has been reproduced on real data.

## 1. The states (live CHECK constraints)

| Entity | States |
|---|---|
| business_requests | open, fulfilled, expired, cancelled, merged |
| business_request_offers | pending, offered, accepted, declined, expired, cancelled, completed, withdrawn |
| business_reservations | requested, confirmed, failed, cancelled |
| business_availability | active, expired, cancelled, filled |
| occasion_group_plans | voting, voting_business, decided, cancelled, fulfilled |
| date_proposals | proposed, accepted, declined, withdrawn |
| plans (the Universal Plan) | draft, confirmed, completed, cancelled |
| gatherings | no status: cancellation = hard delete (cancel_gathering) |

## 2. Decline: already a real state (no gap in the core)

`decline_business_offer` (business declines a request it was sent) writes `business_request_offers.status = 'declined'` with a
curated `decline_reason` (+ note when "other"), guarded to `pending/offered` only ("already resolved" otherwise), and pushes the
consumer plus other plan participants (`business_offer_declined`). `accept_business_offer` refuses anything but an `offered`
offer on an `open` request, so a declined/withdrawn/expired offer can never be accepted. Client buttons key off
`o.status === 'offered'`. Declines feed the owner's own insight surface (locked convention: never auto-reweights matching).
Counter/alternative: the business's own offer (`offered`, with proposed time/price) is the counter; withdraw = `withdrawn`.

Ghost-offer sources are closed: request cancel, request expiry, availability expiry/cancel, gathering cancel and offer accept
(sibling offers -> `expired`) all sweep the offer rows.

## 3. Cancellation propagation matrix

| Trigger | Offers | Request | Reservation | Plan row | Parent/Group plan | Notify |
|---|---|---|---|---|---|---|
| cancel_business_request (open only) | cancelled | cancelled | n/a | -> cancelled (trigger) | group plan unchanged | yes |
| request expiry | expired | expired | n/a | -> cancelled (trigger) | unchanged | no |
| cancel_gathering | cancelled | cancelled | cancelled (via `_cancel_reservation_by_offer`, unless payment captured) | cancelled | n/a | yes |
| cancel_community | same as gathering (Item 51) | | | | | yes |
| cancel_business_reservation | offer -> cancelled | **stays fulfilled** | -> cancelled | **stays confirmed** | unchanged | yes |
| cancel_occasion_group_plan | none | none | none | -> cancelled (trigger) | (is the group plan) | **none** |
| date proposal declined/withdrawn | n/a | n/a | n/a | -> cancelled (trigger) | n/a | existing |

## 4. Gaps (ranked)

1. **Reservation cancelled, Plan still "confirmed".** `_cancel_reservation_by_offer` cancels the offer and reservation but never
   reopens/cancels the request, and plan status is derived only from `business_requests.status`. Result: `plans.status` (and
   `get_plan_overview.lifecycle.status`) stay `confirmed` while the reservation is `cancelled`. The overview's reservation and
   offer sections are live so they are truthful, but the headline state is stale. This is the exact case the user named.
2. **`plans.status = 'completed'` is never written.** `complete_business_reservation` sets the offer `completed`; nothing moves
   the plan (or the fulfilled request) to completed. Completion is invisible at the Plan level.
3. **Occasion group plan only cancellable while `voting`.** Once `voting_business`/`decided`/`fulfilled` an organizer cannot
   cancel it at all; and when its resulting request/reservation/gathering is cancelled, the group plan stays `fulfilled`
   ("Planned" forever). `cancel_occasion_group_plan` also sends no notification to invited participants, and does not cancel
   any downstream request (none exists while `voting`, but `voting_business` can have one).
4. **Stale "Planned" on personal occasions.** `occasions.resulting_plan_id` is set when a plan is made and never cleared when
   that plan is cancelled; `OccasionsScreen` shows "Planned" on any non-null value. A cancelled plan still reads as planned.
5. **Child cancelled, parent plan unaware.** Cancelling a gathering/request under an occasion or match plan updates the child
   only; the parent stays `draft` and `children[]` (live) is the only place it shows. Acceptable through the read layer but not
   a stored state.
6. **All businesses decline: no terminal state.** Each decline notifies the consumer, but the request stays `open` (plan
   `draft`) until `expires_at`. There is no "nobody available" state or prompt; it is a quiet dead end until expiry.
7. **Client freshness.** BusinessRequestDetail loads on focus with no realtime, so a button can be briefly stale; the server
   rejects the action with a clear error, so this is cosmetic (no wrong outcome), not a data problem.

## 5. Recommendation engine / analytics

- Availability search and matching filter `status = 'active'` and `ends_at` (cancelled/filled/expired excluded). Fan-out is
  request-scoped, so a closed request stops matching. Gatherings are hard-deleted, so they cannot be recommended after cancel.
- `get_business_opportunities` returns every offer row with its status; the dashboard renders by status (declined/cancelled
  shown as such). Decline reasons and outcomes are real columns (`decline_reason`; `business_offer_outcomes` is written only by
  `submit_offer_outcome`, i.e. post-experience ratings). There is no analytics row for a *cancellation* (only the status
  change itself), so cancellation reasons/patterns are not captured anywhere. Not a bug; a product gap if wanted.

## 6. Proposed fixes (not built; awaiting go-ahead)

A. One shared "plan status from real facts" function so plan status is recomputed from the request, the offers and the
   reservation together (fixes gaps 1, 2): reservation cancelled -> plan `cancelled` or back to `draft` (needs a product call:
   does a cancelled reservation reopen the request, or end the plan?); reservation completed -> `completed`.
B. Let organizers cancel a group plan in every non-terminal state, cascading to its request/offers/reservation through the
   existing helpers, and notify invited participants; mirror a cancelled resulting request/gathering back onto the group plan
   (gaps 3, 5).
C. Clear or derive the occasion "Planned" badge from the plan's live status (gap 4).
D. Add a terminal "no one available" outcome, or a nudge, when every invited business has declined (gap 6).
