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
| A11 | Owner: Mark as Completed (only on the visit day; before = refused) | customer: "✓ Visit confirmed"; Plans > Past after the time | screenshot |
| A12 | Expired / foreign link: open a link with another business's request id, and one for a request that expired | "no longer available", no data | screenshot |

## 3. Service-area journey (B)

| # | Step | Expected |
|---|---|---|
| B1 | Apply as "We go to customers" | no address field; rough area only; `location_source = service_area`, point rounded to 2 decimals |
| B2 | Approval | dashboard says "🚗 Mark your service area" if no point, never "Add your address" |
| B3 | Consumer 8 mi away asks for B's category | routed ("We asked 1"); a consumer 12 mi away = not routed (radius 10) |
| B4 | Reply + accept | booked card shows NO directions, ride, map pin or meeting point for B |
| B5 | Owner completes the visit | "✓ Visit confirmed" as for A |

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
