# Visit confirmation correction: progress (branch post-tier1/visit-confirmation, from integ/staging-run 23e03073)

Owner decisions 2026-11-21 (main `PRODUCT_AUDIT/BUSINESS_WEB_PARITY_AUDIT_2026-11-21.md`). Not merged, not deployed,
build 87 and production untouched. Worktree `/workspaces/.nearby-verify/wt-visit`, logs `/workspaces/.nearby-verify/v461`,
local DB container `nearby-v460` (replay through 20270429).

## Design (backward compatible, `completed` NOT redefined)
- New nullable columns on `business_request_offers`: `customer_done_at` (the customer's own "Mark as done") and
  `visit_confirmed_at` (the business's "Confirm visit"). Clients cannot write them (no UPDATE policy on the table).
- `status = 'completed'` keeps its meaning "done by someone" for every personal/booking reader (plans this month, plan
  status, plan stops, "How was it?", account deletion, Plans history, booked-state readers using accepted|completed).
- `complete_business_reservation` (same signature, builds <= 87 keep working):
  - requester -> personal mark: sets `customer_done_at` (+ today's status/plan completion if still accepted); NO
    `OFFER_REDEEMED`; idempotent; refused after a no-show (as today).
  - business (selected location = offer's partner) -> confirmation: sets `visit_confirmed_at` (+ status/plan if still
    accepted); emits `OFFER_REDEEMED` (moved here); idempotent; refused after a no-show; visit day rule unchanged.
- `mark_business_no_show`: refused once `visit_confirmed_at` is set; allowed after a customer's own mark (business is
  authoritative). Both functions lock the offer row first, so confirm vs no-show can't both win.
- Verified readers switched from status `completed` to `visit_confirmed_at`: routing completion rates (4 functions),
  reputation (item 63), offer performance, offer funnel, offer value, category outcomes, reliability rankings, market
  validation stats, analytics views request_journey / routing_candidate_outcomes / intent_funnel.
- Not touched (checked): sponsored refunds (own `sponsored_placements` status), Stripe/edge functions (no completion
  dependency), `_learn_from_redemption` (customer's own learning, fires on status as today).
- Legacy rows (completed, neither column): never counted as confirmed; customer sees "Marked as done"; business may
  confirm. Production has 0 offers.

## Steps
- [x] dependency inventory (31 functions, 4 views, triggers, client readers)
- [ ] migration 20270430 + rollback
- [ ] client: helpers, customer "Mark as done"/"Marked as done", business "Confirm visit", readers
- [ ] strings (11 languages, machine-authored, native review needed)
- [ ] journey + Jest tests
- [ ] verification run (replay, journeys, rollback, Jest, iOS + web export)
