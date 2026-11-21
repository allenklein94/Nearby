# Visit confirmation correction (branch post-tier1/visit-confirmation, from integ/staging-run 23e03073)

Owner decisions 2026-11-21 (`PRODUCT_AUDIT/BUSINESS_WEB_PARITY_AUDIT_2026-11-21.md`); owner ordered the build NOW on an
isolated branch (2026-11-21). NOT merged, NOT deployed, website NOT published, build 87 (2a28c8e8) and production untouched.
Worktree `/workspaces/.nearby-verify/wt-visit`; logs `/workspaces/.nearby-verify/v463`; local DB container `nearby-v460`
(from-scratch replay through 20270429), resumable script `/workspaces/.nearby-verify/verify463.sh`.

## Design (backward compatible; `completed` NOT redefined)
- `business_request_offers.customer_done_at` = the customer's own "Mark as done" (personal). `visit_confirmed_at` = the
  business's "Confirm visit" (the ONLY confirmed visit / redemption). Neither client-writable (no UPDATE policy).
- `status = 'completed'` keeps meaning "done by someone": plans this month, plan status, plan stops, "How was it?",
  account deletion, Plans history, booked-state readers (accepted|completed) unchanged.
- `complete_business_reservation` (same signature; builds <= 87 keep working, their "Mark as Completed" = the personal mark):
  requester -> personal mark (always, even an owner booking their own business); business (selected location =
  `managed_partner_id`, 0424's selection) -> confirmation + the one `OFFER_REDEEMED`. Each side idempotent; both refused
  before the visit day and after a no-show; the first completion by either side moves status/plan as before.
- `mark_business_no_show`: refused once confirmed; allowed after a customer's own mark (business authoritative). Both lock
  the offer row first: proven by a 2-connection race script (confirm vs no-show: exactly one wins, never both).
- Existing completed rows: neither column (confirmer unknown) = never counted as confirmed; customer sees "Marked as done";
  the business may still confirm or say no-show. Production has 0 offers.

## Migrations (each needs its own owner approval, in order, after 20270429)
- **20270430** core: columns; complete / no-show; business figures read `visit_confirmed_at` (offer value, performance,
  reputation, funnel, category outcomes, reliability rankings, market validation); `get_business_opportunities` returns
  `visit_confirmed_at` (never `customer_done_at`); offer evidence (0416) + admin offer history carry `visit_confirmed_at`
  only (business side only: the customer's mark is never kept or shown there).
- **20270431** routing track record: `_ai_auto_respond_to_business_requests`, `_business_request_fanout`,
  `_match_request_to_availability_core`, `_match_request_to_policy_core` (item 63 tie-break inputs).
- **20270432** analysis views (service role): `request_journey`, `routing_candidate_outcomes`, `intent_funnel`.
- Rollbacks in `scripts/rollback/`, run 0432 -> 0431 -> 0430. Rolling back drops the two columns (who confirmed is lost).
- Checked, NOT changed: paid-placement refunds (own status), Stripe + every edge function (no offer-completion read),
  `_learn_from_redemption`, booking cancel (accepted only), account deletion (booked/completed status only).

## Client
- One rule `src/utils/visitConfirmation.js` (`offerVisitState`, `canMarkDone`, `canConfirmVisit`, `canReportNoShow`).
- Customer (`BusinessRequestDetailScreen`): "Mark as done" (one button, only while still booked, from the visit day);
  afterwards "✓ Marked as done" in the booked card; "Visit confirmed" + glow + sound + first-visit note only from the
  business's confirmation (`offerCard`, `presentOffer().confirmation.markedDone`, `fetchFirstRedemptionId`).
- Business (`BusinessDashboardScreen` Bookings = the same screen in the app and the website export): "Confirm visit"
  (coral, asks once: can't be undone), "Didn't show up" hidden once confirmed, Cancel only while still `accepted`; a
  customer-marked booking stays in Bookings until the business answers; the card reads "accepted" + Accepted step until
  confirmed (`businessCardStatus`, `offerStage`); pipeline "Completed this month" = confirmations only.
- Admin offer history: "Redeemed (business confirmed)" vs "Completed (not confirmed by the business)".
- New strings (machine-authored except English; native review needed): `ui.requestDetail.markAsDone` / `markAsDoneA11y` /
  `markedAsDone` (replace `markAsCompleted` / `markThisReservationCompleteA11y`), `ui.bizDash2.confirmVisit` /
  `confirmVisitA11y`, `ui.bizDash1.confirmThisVisit` / `confirmThisVisitBody`, `ui.shared.errors.what.confirm_that_visit`.

## Tests
- Journey `visitConfirmation` (12 steps) + updated `offerJourney`, `groupBookingLifecycle`, `requestFunnel`,
  `intentFunnel`, `offerEvidence` (they asserted a customer completion counted as a redemption).
- `scripts/replay/visit-confirmation-concurrency.js`: confirm vs no-show, double confirm, customer vs business at once.
- Jest: `utils/visitConfirmation.test.js` + updated offer progress / pipeline / presentation / first redemption / moments /
  admin history / dashboard rule / lifecycle matrix (regenerated); guard allow-lists name 0432 for its views only.

## Verification run (2026-11-21, at 4e1ef0387; logs `/workspaces/.nearby-verify/v464` + `v464r`; local only, never production)
- Rollback 0432 -> 0431 -> 0430 = the saved pre-0430 schema, 0 diff lines (the earlier 1-line diff was a stale
  `private.offer_evidence.customer_done_at` left in the local container by a WIP version of 0430; dropped, not a rollback bug).
- Journeys with 0430-0432: 1572/1572. On the rolled-back DB, offer + groupBooking journeys fail 50/79 (they really test 0430).
  Re-apply after rollback = identical schema (0 diff lines).
- Concurrency: visit-confirmation (confirm vs no-show: exactly one wins; double confirm; customer + business at once),
  booking-capacity, reschedule-accept, offer-revision: all pass.
- Jest 595/595 suites, 8023 tests (11 todo). Fixed this run: `offerAcceptedMorph.test.js` had a syntax error (the suite
  had never run; it now passes), moment 6's fixture remembered the raw status instead of `offerStage()` (code was right),
  + a new case: customer marks done, then the business confirms live = the Visit confirmed moment plays once.
- iOS + web exports clean (4e1ef0387).
- From-scratch replay on an EMPTY database (PG 17.6 + real Auth schema, the established recipe): 555/555 migrations incl.
  0430-0432, journeys 1572/1572 on it.
- Reviewed by hand: `complete_business_reservation` vs its 20270330 predecessor (no check dropped; builds <= 87 still get
  `success: true`); every trigger on business_request_offers (only `_learn_from_redemption` reads 'completed', the
  customer's own learning, left on status by design); `business_lifecycle_events` (service role only, records status
  truthfully; the funnel reads it only for 'offered'); website confirm dialog (`utils/webAlert.js` -> window.confirm);
  client 'completed' readers outside the rule are booked-state checks (accepted|completed), correct as is.

## Not done / blocked
- No phone or real browser check (none available). No staging deploy (needs owner approval even for staging).
- Native review of the new strings. Website export not regenerated or published (separate approval).
