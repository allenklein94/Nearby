# Staging end-to-end test plan: storefront + service-area business (2026-11-15)

Status: PLAN, nothing run against a hosted project. Companion to `STAGING_PROJECT_PLAN_2026-11-15.md` (approvals A-F,
safeguards). Every step below runs ONLY on the staging project; nothing here touches production.

## 0. Prerequisite found 2026-11-15: staging needs the COMBINED code

`deploy.js` applies migrations strictly in number order. The business-website fixes are 0418-0420 (this branch), but
0370-0416 live only on the stacked trust & safety branches (top: `post-tier1/rate-limit-api-checks`). So staging can't
reach 0418-0420 from this branch alone. The combined tree was built and tested locally as
`integ/business-web-x-trust` (integration check only, never merged; results in section 6). Staging is deployed from that
combined tree (or from main once the branches are merged after Tier 1), never from two branches by hand.

Conflicts the integration resolved (each reviewed):
- `screen-business-content` + `_shared/contentClassifier.ts`: 0387 (outage alerts) and 0420 (automatic retry) both
  classified provider failures. Now ONE classification: the outage monitor's cause (credit / credentials / model / rate
  limit / timeout / provider error / bad reply) is reported AND feeds the retry rule (`screeningFailure.js`, `healthKind`):
  credit, key and retired model are never retried; a missing key is a permanent failure.
- 0399's "paused manager" check in screen-business-content is skipped on an automatic retry (no signed-in owner to tell);
  the database still refuses the write, which settles the submission as not sent.
- Offer card styles: 0372's report (⋯) button styles kept beside the shared customer-card styles.
- `scripts/live-verify/post-deploy.js` did not load on the trust stack (unescaped apostrophes in the 0358/0362/0377
  limit-check text): fixed in the integration; the same fix is needed on `post-tier1/rate-limit-api-checks`.

## 1. Accounts and data (synthetic only)

| Actor | Account | Device |
|---|---|---|
| Consumer | staging test phone 1 (555-01xx, Auth test OTP) | staging iPhone build (`APP_VARIANT=staging`) |
| Storefront owner | staging test phone 2 | staging business website (local export, private port) |
| Service-area owner | staging test phone 3 | staging business website |
| Admin | staging test phone 4, `is_admin` set in staging SQL | staging website |

Businesses (applied through the website, approved by the admin; never seeded straight into the table, so the real
application path is tested):
- **A. "Coastal Coffee (test)"**, storefront: test address label "Test location (not a real address)", own pin at the
  staging test point, hours 07:00-18:00 daily, largest group 10, category Coffee, auto-accept party size up to 10.
- **B. "Mobile Detailing (test)"**, "We go to customers": rough area only (rounded to 2 decimals), `max_distance_miles`
  10, a category that exists in the V1 set (choose at run time from the sign-up picker), no address.

## 2. Storefront journey (A)

| # | Step | Expected | Evidence |
|---|---|---|---|
| A1 | Website: owner signs in by phone (test OTP), no profile yet | CompleteProfile on the website; profile saves | screenshot |
| A2 | Apply as a storefront: address + pin required | can't submit without both | screenshot |
| A3 | Admin approves | application approved; owner's account linked once the profile exists (`webBusinessClaim`) | `brand_partners` row, `managed_partner_id` |
| A4 | Owner adds hours, group size, auto-accept 10; verifies an email address (business-email, staging Resend) | code email arrives; "verified" | inbox |
| A5 | Consumer (app): "coffee today" near the test point | "We asked 1 nearby business" | screenshot |
| A6 | Owner has no push token on the website account | ONE email per alert type, body = the push words, link "Open this request: …?n=…&r=<id>" | inbox + `send-push` log `emailed: true` |
| A7 | Owner opens the email link signed out, signs in | lands on Opportunities with THAT request outlined; the `?n=&r=` is gone from the address bar | screenshot |
| A8 | Automatic reply (party <= 10) arrives on the phone | reply signature + one push; tap opens that reply | video |
| A9 | Owner writes a hand-written offer (needs the staging Anthropic key) | "Reviewing your offer…" -> sent; customer sees it | screenshot, `business_offer_submissions` row |
| A10 | Consumer: "I'll take this one" | "You're booked" on the same card; Your Plan; owner: email `business_offer_accepted` + Bookings shows it | screenshots |
| A11 | Visit confirmation: run section 2b (V0-V15) on A's bookings (replaces the old "Owner: Mark as Completed", a button that never existed on the business side; 20270430-0432) | every V step passes; Plans > Past after the time | section 2b record |
| A12 | Expired / foreign link: open a link with another business's request id, and one for a request that expired | "no longer available", no data | screenshot |

## 2b. Visit confirmation (20270430-0432; branch `post-tier1/visit-confirmation`, prepared 2026-11-21)

What it proves: the customer's "Mark as done" is personal only; only the business's "Confirm visit" is a confirmed visit,
a redemption (one `OFFER_REDEEMED`) or a business figure; repeats change nothing; a confirmed visit and a no-show never
both exist; builds <= 87 keep working. Local evidence: branch record `VISIT_CONFIRMATION_PROGRESS_2026-11-21.md`.

**Prerequisites (each its own owner approval; none done):**
- P1. 0430 -> 0431 -> 0432 on staging, in order, through `deploy.js --target=staging` (`--check` first = rolled back),
  from this branch's tree. Approval codes (committed files at 79f33cf74):
  `staging:20270430:869babcb67ee3f7b29f5a0bbbd418c942cc5adbfe157261c939d24fea793ecec`,
  `staging:20270431:b597aa6d1d99c4b02f283a37cdcde1cf1cbe28d5763f55b641f74100f1be3887`,
  `staging:20270432:f696bf304ae2459fd30b480bd8bd342906c2cdaad95b79095e3d680888cf1aa9`. No edge function change.
- P2. Staging iPhone build (`APP_VARIANT=staging`, owner-run EAS) from this branch or later, for the customer app steps
  (V3, V6 customer half, V12). Without it those halves are SETUP-BLOCKED; the API and website steps still run.
- P3. Business website = a LOCAL export of this branch pointed at staging (private port, as E-runs). Never published.
- P4. Bookings come from A1-A10 with the automatic reply (A4's auto-accept policy; hand-written offers stay blocked
  without the staging Anthropic key). V steps need several bookings visited TODAY, some with a start time already passed
  (no-show needs it): X (mark -> confirm), Y (confirm -> no-show refused), Z (mark -> no-show -> confirm refused),
  W (no-show -> mark refused), T (tomorrow: refused before the visit day). Vary category or time between asks (the
  10-minute duplicate check refuses identical requests).

**After every V step:** `scripts/staging/visit-confirmation-observe.sql` (read-only: per booking status / customer_marked /
business_confirmed / no_show / redeemed_events / plan; per business confirmed vs customer-marked-only).

| # | Step | Expected |
|---|---|---|
| V0 | Read-only, right before P1: `scripts/staging/visit-confirmation-fingerprint.sql` on staging | output = `visit-confirmation-fingerprints-pre.txt` (no drift). **PASS 2026-11-21** (19/19 identical, columns absent) |
| V1 | After P1: same query; `migration:status --target=staging` | = `...-with.txt` (21 lines); 0430-0432 recorded, nothing else changed |
| V2 | T (tomorrow): customer app, business website, then the API as the customer | no "Mark as done", no "Confirm visit"; API refused "You can mark this as completed on the day of the visit." |
| V3 | X: customer taps "Mark as done" (app) | "✓ Marked as done" in the booked card, then "How was it?"; NO "Visit confirmed", glow or sound; observe: customer_marked t, business_confirmed f, redeemed_events 0, status completed, plan completed |
| V4 | X: the same call again via the API with the customer's session (= what builds <= 87 send) | `success`, `alreadyCompleted`; observe unchanged (timestamp not moved) |
| V5 | X: business website Bookings + Home | X still listed, card "Accepted" (not Redeemed), "Confirm visit" shown; Performance / value / Completed this month unchanged (customer_marked_only 1, confirmed 0) |
| V6 | X: business taps "Confirm visit" on the website; customer has the request open in the app | browser confirm "Confirm this visit?" + the can't-be-undone line; OK -> toast "Visit confirmed"; observe confirmed t, redeemed_events 1; card Redeemed; "Didn't show up" gone; Performance +1. Customer: "✓ Visit confirmed" + glow (+ sound if Sound cues on) ONCE; close + reopen = settled, no replay |
| V7 | X: confirm again (second tab still showing the button, or the API as the business) | `success`, `alreadyCompleted`; redeemed_events stays 1; visit_confirmed_at unchanged |
| V8 | Y: confirm, then "Didn't show up" via the API (the button is hidden) | refused "Only a confirmed visit that was not completed can be marked as a no-show."; no no-show row |
| V9 | Z: customer marks done; business "Didn't show up" (allowed); then confirm via the API | no-show recorded; "Confirm visit" hidden; API confirm refused; customer still "Marked as done"; confirmed visits unchanged |
| V10 | W: business "Didn't show up" first; customer taps "Mark as done" | server refuses ("not in a state that can be completed"); RECORD exactly what the app shows (the customer can't read no-shows, so the button can still appear: a usability finding, not a server failure) |
| V11 | Optional: two browser tabs tap Confirm at once; Confirm and Didn't show up at once | exactly one effect, never both (proven locally by `visit-confirmation-concurrency.js`) |
| V12 | Business owner in the staging iPhone build, Bookings (needs P2) | same as V5-V7 in the app |
| V13 | Multi-location (0424 on staging): a manager whose SELECTED location is W2 calls confirm on a W Location 2 booking | refused "You are not part of this reservation."; nothing changes |
| V14 | Old clients: no staging build <= 87 exists (they point at production), so this is the API half only (V4) + code reading | KNOWN TRANSITION, not a failure: on builds <= 87 the customer's own tap still SHOWS "✓ Visit confirmed" and the old business app card shows "Redeemed" (old screens read status 'completed'); every server figure is correct. Release order recommendation: new client (build after 87 + website export) out before 0430 reaches production |
| V15 | Optional, own approval: rollback rehearsal 0432 -> 0431 -> 0430 on staging, then re-apply | V0 output after rollback, V1 output after re-apply; the confirmations recorded in V3-V9 are LOST by the rollback (count them first) |

Cleanup: the staging test bookings stay as fixtures until the owner decides (the existing cleanup script is dry-run only
and was written for the E-tests; extend it before deleting any booking).

## 3. Service-area journey (B)

| # | Step | Expected |
|---|---|---|
| B1 | Apply as "We go to customers" | no address field; rough area only; `location_source = service_area`, point rounded to 2 decimals |
| B2 | Approval | dashboard says "🚗 Mark your service area" if no point, never "Add your address" |
| B3 | Consumer 8 mi away asks for B's category | routed ("We asked 1"); a consumer 12 mi away = not routed (radius 10) |
| B4 | Reply + accept | booked card shows NO directions, ride, map pin or meeting point for B |
| B5 | Owner confirms the visit (section 2b V6 on B's booking) | "Confirm visit" -> customer "✓ Visit confirmed"; B's confirmed visits +1 |

## 4. Failure scenarios (staging only)

| # | How | Expected |
|---|---|---|
| F1 | Anthropic key unset in staging | hand-written offer: "We couldn't finish reviewing this" + Try again; never published; admin outage alert (0387) opens on the first failure |
| F2 | Anthropic key with $0 credit (or a deliberately invalid key) | same as F1; NO automatic retries (permanent: credit/credentials) |
| F3 | Temporary failure (point `screen-business-content` at a key that rate-limits, or block egress briefly) | up to 3 automatic tries (~30 s, 2 min, 5 min), then Try again; one result push; never sent twice |
| F4 | Resend key unset | send-push logs `email_not_configured`, push path unchanged, nothing promised to the owner |
| F5 | Owner dismisses a pending retry / request closes | no further tries; `not_sent` for a closed request |

## 5. Secrets staging needs (owner sets them in the staging dashboard; never in chat or Git)

| Secret | Value | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | a SEPARATE key in its own Anthropic workspace with a monthly spend limit (e.g. $5) | never the production key |
| `RESEND_API_KEY` | a separate Resend API key (sending-only permission) | |
| `EMAIL_FROM` | `Nearby Staging <onboarding@resend.dev>` until a domain is verified | Resend's test sender only delivers to the Resend account's own address: enough for staging |
| `BUSINESS_WEB_URL` | the private staging website address | |
| vault `service_role_key` | staging's own secret key | for the retry cron + push outbox |
| Auth test phone numbers | 4 numbers + fixed codes (Auth > Phone) | no real SMS |

## 6. Local evidence so far (integration tree, no hosted project)

See CLAUDE.md "Business website launch blockers" for the run results (from-scratch replay of the combined migrations,
all journeys, Jest, `deno check`). A staging pass is evidence only, never production approval.

## 7. Business Profile editing (read-only code audit, 2026-11-15; owner asked: record gaps, build nothing)

Confirmed from code (not run in a browser or on a phone):
- **Phone number and website URL are NOT editable anywhere after approval.** They exist only on the application
  (`submit-business-application` -> `business_partner_requests`: website, phone, contact info, used for admin review and
  0414's duplicate warnings). `brand_partners` has no phone or website column and approval does not copy them, so the
  Business Profile tab (app and website) has no such field and customers never see them. Not a bug in the current design
  (customers finish in the app; contact details are kept off offers, 0372); recorded as a gap for the owner to decide
  after real owners test. No change before then.
- Name, description, address, logo, category, secondary categories, subcategory, attributes, cuisine and differentiator save
  through ONE server function `update_business_profile` (definer), which refuses anyone who doesn't manage that business
  ("You do not manage this business") and validates name, category, subcategory, secondary categories, attributes and
  cuisine. The pin saves through `set_business_location` (refuses another business, journey `locationProvenance`); hours
  through the hours editor (`operating_hours`).
- Journeys cover `update_business_profile` only incidentally (location provenance, service area); no journey checks that a
  non-manager's profile save is refused, and none checks the hours editor's write path under real roles.

Staging website checks (signed in as the approved owner, then as a second account that does NOT manage the business):
1. Edit name, description, category + secondary categories, subcategory, attributes, hours, address + pin, logo; Save;
   refresh the browser tab; every value still shown as saved (the "What Nearby knows" summary and the form agree).
2. Same edits on the iPhone build against staging; the website shows them after refresh, and the reverse.
3. Second account: the business's profile can't be saved (direct `update_business_profile` call refused; no edit UI reachable).
4. Record whether owners look for a phone/website field (evidence for the gap above, not a reason to build it now).
