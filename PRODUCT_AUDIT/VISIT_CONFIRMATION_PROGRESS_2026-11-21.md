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

## Staging preparation (2026-11-21, read-only on staging; nothing written)
- Plan: section 2b (V0-V15) of `STAGING_E2E_TEST_PLAN_2026-11-15.md` (A11 + B5 now point to it); scripts
  `scripts/staging/visit-confirmation-observe.sql` + `visit-confirmation-fingerprint.sql` (+ expected pre/with outputs),
  both run locally against the with-0430 replay.
- Staging read-only: ledger through 20270429, 0430-0432 next in order; the 19 objects 0430-0432 replace are byte-identical
  to the tested pre-0430 state (V0 PASS); 0 requests / offers / reservations / no-shows (nothing to reconcile), 3 test
  businesses, no automatic-reply policy yet.
- Found: builds <= 87 still SHOW "✓ Visit confirmed" for the customer's own tap and "Redeemed" on the old business app card
  (old screens read status); server figures correct. Release the new client before 0430 reaches production.

## Staging run (2026-11-21 ~20:20-20:50 UTC; owner approved P1 + P2 config + P3 in chat; staging only; logs `/workspaces/.nearby-verify/vc-staging`)

**P1 DONE: 0430 -> 0431 -> 0432 deployed to staging** through `deploy.js --target=staging`, each `--check` (rolled back) first,
then applied; ledger rows 20:24:56 / 20:25:17 / 20:25:21 UTC, approval ref "owner, 2026-11-21, chat", session ec52ce79. V0 re-run
right before: identical. **V1 PASS:** fingerprint after = `visit-confirmation-fingerprints-with.txt` (21 lines, identical);
ledger 85 -> 88 rows (only the three); `complete_business_reservation(offer_id_param uuid)` still one overload.
(`status.js` also lists 20270345 NOT RECORDED: the ledger's own migration, applied by staging bootstrap before the ledger
existed; unchanged, unrelated.)

**Journeys on staging (rolled back, staging-only token as SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF=staging):**
`visitConfirmation` + `plansThisMonth` + `planHistory` 23/23. Full suite 1535/1572; the 37 failures are environment, not
0430-0432: 33 in `heldAccountEvidence`, `deletionHardening`, `idDocumentRetention` stop at setup because hosted Supabase's
`storage.protect_delete` trigger refuses direct `delete from storage.objects` (the local replay has no such trigger); 1 in
`offerEvidence` expects exactly 3 rows in `private.offer_evidence_purge_log` but staging already holds 3 real daily-cron rows
(2026-11-19/20/21, 0 purged each), so it reads 6. Test-isolation fixes for hosted runs = separate, not done.

**Real-API run (PostgREST + Auth on staging, real JWTs of the labelled fixtures C = customer, W = owner of W + W Location 2,
W2 = another business; sessions via staging admin password set + password grant, files 0600 in a 0700 scratchpad; W sends
`x-nearby-business` = its selection, as current clients do).** Setup: W selected location 1 (L1); auto-accept policy (party
1-10) on L1 and L2 via `upsert_business_fulfillment_policy` (without the header: refused `location_aware_client_required`,
0427 working). Bookings = C's broadcast request -> L1/L2 automatic reply -> C's `accept_business_offer` (real path, no SQL
writes): X, Y, Z, N (today, visit times 20:44-20:48 UTC; C's zone = UTC), T (tomorrow), M (accepted from L2), R1 + R2 (race).
A targeted request gets no automatic reply (by design: `create_business_request` returns after routing to that business).

| # | Result |
|---|---|
| V2 | PASS: T customer + business both refused "You can mark this as completed on the day of the visit." |
| V3 | PASS (API half): X customer -> `{success, personal}`; observe: completed, mark t, conf f, events 0, plan completed |
| V4 | PASS: repeat -> `alreadyCompleted`; `customer_done_at` stayed 20:31:08.131 after two repeats |
| V5 | PASS (API half): value / funnel / performance / reputation redemptions all 0; X still in `get_business_opportunities` (status completed, `visit_confirmed_at` null, no `customer_done_at` key: the personal mark is not shown to the business) |
| V6 | PASS (API half): W confirms X -> `{confirmed}`; events 1; value 1 redemption ($0, 1 unpriced: automatic replies carry no price), funnel 1, performance 1, reputation 1 (20%) |
| V7 | PASS: confirm again -> `alreadyCompleted`, `visit_confirmed_at` unchanged (20:31:36.935), events 1; customer repeat after confirm also `alreadyCompleted` |
| V8 | PASS: Y confirm, then no-show refused "Only a confirmed visit that was not completed can be marked as a no-show." |
| V13 | PASS: W (selection L1) confirms M (L2) -> "You are not part of this reservation."; header L2 with selection L1 -> `business_selection_changed`; nothing changed |
| other | PASS: W2 confirm X -> "You are not part of this reservation.", W2 no-show X -> "This visit is not one of yours."; no-show on N before its time -> "You can mark a no-show once the visit time has passed." |
| push | PASS: no outbox row for a mark or a confirmation (types queued in the run: opportunity, offer accepted, reservation confirmed only; all `queued`, fixtures have no push tokens) |

**Continued 2026-11-21 21:15-21:17 UTC (after a codespace restart; log `vc-staging/api-v9-v11c.log`).** The first V9/V10 tries
(Z, N at 20:46) were NOT the intended tests: the no-show calls came before the visit time and were refused ("You can mark a
no-show once the visit time has passed."), and Z was then simply confirmed. Redone on Z2 / N2 / R3 (visits 20:55 / 20:58 /
20:59 UTC, all passed; N2 + R3 requested by fixture C2 because C hit the request rate limit):

| # | Result |
|---|---|
| V9 | PASS: Z2 customer-marked 20:47:23 -> W "Didn't show up" `{marked: true}` -> W confirm refused "This reservation is not in a state that can be completed."; C repeat mark `alreadyCompleted, personal`; observe: mark t, conf f, no-show t, events 0 |
| V10 (API half) | PASS: N2 W no-show first `{marked: true}`; C2 (the requester) mark refused "This reservation is not in a state that can be completed."; no-show repeat `{marked: false, already: true}`. (A first try as C, not the requester, got "You are not part of this reservation.": correct for a non-party, test-account mistake, not a defect.) What the APP shows = phone step |
| V11 | PASS: R1 confirm vs no-show at once (no-show not yet eligible) = confirm only; R2 two confirms = one event; R3 confirm vs no-show at once, BOTH eligible = no-show won, confirm refused, C2's later mark refused; no booking anywhere has both a confirmation and a no-show |
| observe | W: status_completed 7, confirmed_visits 5, customer_marked_only 2 (N, Z2); L2 + W2 all 0 |

Observation (not 0430's change, recorded for the owner): after a no-show the offer stays `accepted`, the reservation
`confirmed` and the customer's plan `confirmed` (N2, R3); the customer can't read no-shows, so their plan still reads booked.

**Website on staging (P3; 2026-11-21 21:20-21:30 UTC).** The local export `vc-staging/web` (built 20:34 from 4d9f501fe, embedded
env = staging, `nearbyEnv.variant` staging, placeholder Expo project id 00000000-...0429 = web needs none; production ref
appears only in environments.js's PRODUCTION table), served on a private port inside the Playwright container, driven
headless against REAL staging (no mocks): owner W's real session (password grant) put in the website's own storage key;
selected location L1. Fresh booking X2 (C2, Coffee, 10:30 local = 22:30 UTC, automatic reply accepted 21:19:49, C2 marked
done 21:20:00). Evidence `vc-staging/web-run/` (log, screenshots, page text).

| # | Result |
|---|---|
| V2 (website) | PASS: T (Nov 22) card shows only "Cancel Reservation", no "Confirm visit" / "Didn't show up" |
| V5 (website) | PASS: X2 customer-marked, still listed in Upcoming with "Confirm visit" + "Didn't show up"; Home Performance "5 redeemed" (customer marks not counted) |
| V6 (website) | PASS except the toast: browser confirm "Confirm this visit?\n\nConfirm only once the customer has been here. It counts as a confirmed visit and can't be undone." -> OK -> `{success, confirmed}`; card leaves Upcoming; observe X2 confirmed, events 1; reload: Home "6 redeemed" = server 6. **FAIL: no "Visit confirmed" toast** (see defect D1). Customer half = phone |
| V7 (website) | Second tab dropped the button by itself (live reload), so a stale-tab tap can't be made; repeat already PASS via the API |
| V9 (website) | PASS: no-show bookings Z2 / N2 / R3 not listed; `get_my_business_no_shows` returns the three |
| V13 (website) | PASS: L2's booking M not listed while L1 is selected |
| push | PASS: since 21:19 only opportunity / offer accepted / reservation confirmed queued; nothing for the mark or the confirmation |

**D1 (defect, website, NOT specific to this branch; main has it too):** `App.web.js` never mounts `SuccessToastHost`, so every
`showSuccessToast` on the business website is dropped silently (13 calls in BusinessDashboardScreen, incl. "Visit
confirmed"). Smallest fix: mount `<SuccessToastHost />` in App.web.js. NOT built (needs approval; main = build 87's source).
**Minor:** Home's figures refresh only on reload after a confirm (switching tabs shows the old "5 redeemed"); "Didn't show up"
is shown before the visit time (N, visit 08:46 UTC tomorrow) and the server refuses it with a clear message; two
entitlement-gated reads (missed-match, category outcomes) log 400 console errors on load (pre-existing).

**Still not run (need the owner):** V3 + V6 customer half + V10 app half + V12 = staging iPhone build (P2 blocked on the
`nearby-staging` Expo project id: not readable from this session); V6 toast in a real browser after D1's fix; V15 rollback
rehearsal (own approval).

**D1 FIXED on this branch only (0ee217ca4, owner approved 2026-11-21; main untouched).** `App.web.js` mounts the existing
`SuccessToastHost` (one line + import; no new component, screen or motion). Also: a website "Confirm visit" re-reads Home's
month figures with the existing `loadOfferPerformance` (read-only). Guard `src/motion/successToastHostMounted.test.js` (both
roots mount the host once, inside ThemeProvider, after the navigator; one toast at a time; confirm re-reads the figures).
Jest 596/596 suites, 8027 tests. Website re-exported against staging (`vc-staging/web-d1`, from the main checkout detached at
0ee217ca4, then switched back to main). Headless run against real staging (`vc-staging/web-run-d1/`), fresh bookings X3 + X4:

| Check | Result |
|---|---|
| Single confirm (X3) | PASS: one dialog, one call `{confirmed}`, "✓ Visit confirmed" toast shown once (1 appearance, never 2 at once; screenshot 30) |
| Rapid double-click (X4) | PASS: one dialog, one server call, one toast; X4 one redemption event |
| Home figures | PASS: 6 -> 7 -> 8 redeemed without a reload; server confirmed_visits 8 |
| Other 12 toasts | NOT each triggered in the browser: they call the same `showSuccessToast` into the same single host (code + guard); a re-save of "what you're looking for" was tried but its button was not reachable headless |

**"Didn't show up" before the visit time: NOT fixed (not a straightforward UI fix).** The button is already gated by
`visitHasPassed`, which reads the request's date + start on the BUSINESS's clock; the server reads them in the CUSTOMER's
profile timezone, falling back to UTC-12 when it is unset or 'UTC' (as for these fixtures), so on staging the server's visit
time is 12 h later than the browser's. A client-only guess would either keep this gap or hide the button for hours for real
customers in other zones. Correct fix = the server sends its visit instant (`_visit_starts_at`) with each booking: a
migration change, so separate approval. Real customers with a set timezone in the business's own zone see no gap.

**V10 refusal wording (owner 2026-11-21: keep the 2026-09-27 no-show privacy decision; no customer no-show status, no plan
lifecycle change; wording only) FIXED on this branch only (5661abcf1; main, production, build 87 untouched).**
State check first (read from `complete_business_reservation`, 20270430): the sentence "This reservation is not in a state that
can be completed." is raised by three checks covering five states, and by nothing else: (1) offer status not accepted /
completed (it changed since the screen loaded: cancelled, expired), (2) no reservation row, (3) reservation not confirmed
(still confirming, or failed), (4) a business-recorded no-show. Every other refusal has its own sentence and keeps its own path
(day-of-visit rule, not a party, offer not found, network). One neutral line is true in all five: "This booking can't be
marked as done." ("can no longer" was NOT used: it would be untrue for a reservation still confirming). Customer screen
(`handleComplete`): exact-match on that sentence -> "That didn't go through" / the new line (11 languages, 10 machine-authored,
need native review), no Try Again (retrying can't help), then re-reads the booking; everything else unchanged. Business side
unchanged (it knows its own records). Server authorization + booking behaviour unchanged. Guard `src/utils/markDoneRefusal.test.js`
(pins the exact server sentence to the migration, so a server rewording fails the test). Re-run 2026-11-21: 21 suites /
664 tests pass (incl. `undefinedNames`, i18n). App half of V10 still = phone step on the staging iPhone build.
