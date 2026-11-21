# Business website parity audit + visit confirmation decision (2026-11-21)

Read-only audit. Nothing was built, merged, deployed, published or changed in production. Goal (owner): a business can
apply, receive requests, make offers, manage bookings and confirm visits entirely in a browser, without the Nearby app.

## Status words used here
- **LIVE** = in production AND on the published website (`docs/business/`, export f4726d9f, 2026-10-23).
- **BUILT (main)** = on main, in build 87's source, website export NOT published.
- **STAGED** = on a `post-tier1/*` or `integ/staging-run` branch only (named), never merged.
- **MISSING** = no code anywhere.

Important: the published website has the blank-dashboard bug for linked owners (fixed on main, 708b7600 / f6c50f96, not
published). So today, in production, **no linked business owner can use the website at all**, whatever the table says.

## The chain in a browser

| Step | Status | Notes |
|---|---|---|
| Apply | LIVE | `docs/business.html` -> `submit-business-application`, no account or app needed |
| Sign in | LIVE (code) | phone code only (Nearby has no passwords). See "Production SMS" below |
| First profile without the app | STAGED `post-tier1/business-web-only` | on main/live the website says to install the app |
| Request arrives (dashboard) | LIVE code, blocked by the blank-dashboard bug | Opportunities in `BusinessDashboardScreen` |
| Email alert with exact-request link | STAGED `post-tier1/business-web-only` | staging E3/E4/E8/E9/E19/E22 PASS; prod: no Resend secrets, `send-push` v28 predates it |
| Make an offer | LIVE code | photos only on the website (video frames are sampled on a phone) |
| Edit offer (one revision) / manage perks | LIVE code | same dashboard screen as the app |
| Acceptance -> booking shown | LIVE code | |
| Cancel booking / "Didn't show up" | LIVE code | |
| **Confirm the visit (request bookings)** | **MISSING everywhere** | see the decision below; not a website-only gap |
| Perk code redemption | LIVE code | `confirm_offer_redemption`, perks (`brand_offers`) only |
| Analytics (Performance, funnel, value) | LIVE code | reads offer `completed` (see dependencies) |
| Billing (invoices, Stripe Connect setup) | LIVE code, Stripe test mode | web path uses `window.location.assign` |
| Messages | LIVE code | `BusinessConversation` is a website route |
| Business verification | STAGED (0371) | |

## The 18 operations (owner's list)
- **Works on the website (code live, blocked today only by the unpublished fix):** receive requests, view request details,
  make offers, edit offers, manage active offers, track acceptances, analytics, respond to communications, billing via
  Stripe (test mode), the business's one location pin (`set_business_location`).
- **Partial:** sign up (apply live; website-only first profile STAGED), claim/verify (claim by phone live; verification
  0371 STAGED), uploads (photos yes, video no on the website), notifications (website = email only, STAGED; no browser
  push), redemptions (perks yes, request bookings no).
- **Staged elsewhere, do not rebuild:** several locations + location switching (`post-tier1/multi-location`, migrations
  0424-0427 on `integ/staging-run`), per-location email alerts (0428/0429 on `integ/staging-run`), custom domain
  (`post-tier1/custom-domain`).
- **Missing:** team member management (0424 records owner/staff memberships, but no screen or client call adds a
  teammate), a support link on any business screen, business visit confirmation.

Deferred by the owner until the core flow is proven: team members, video upload on the website, more locations work.

## Production SMS (check before any real business sign-in)
Production Auth sends codes through Twilio Verify, account SID ending **941e**. If that is the trial account, production
can text only the numbers verified on it (max 5), so no real business owner could sign in. Owner to compare the SID in
the Twilio console. Staging no longer depends on it (Auth test OTP, `STAGING_TEST_OTP_2026-11-21.md`).

## Decision (owner, 2026-11-21): the business confirms the visit

- The business is authoritative for an actual visit. A "Confirm visit" action on an eligible request booking, in the
  EXISTING Bookings interface (no new screen), calls the existing `complete_business_reservation`.
- The customer's "Mark as Completed" stays only as a personal completion indicator: it never establishes a
  business-confirmed visit and never raises confirmed redemption metrics.
- Perk-code redemption stays separate. Privacy rules unchanged. Confirmation idempotent (the function already returns
  `alreadyCompleted`).
- Implementation only AFTER Tier 1; each step (migration, build, website publish) keeps its own approval.

## What the code does today (the conflict)
`complete_business_reservation` (latest: 20270330) lets the requester OR the business set the offer to `completed` with
`completed_at`, completes the plan, emits `OFFER_REDEEMED`. It records **nobody** as the confirmer. The only button that
calls it is the customer's (`BusinessRequestDetailScreen`, `canCompleteVisit`); the business dashboard never had one
(`git log -S`). So every reader of offer `completed` today counts customer self-marks as visits, contradicting the
documented rule (items 52/53, ideas 343/388, the trust doctrine: "only a business-confirmed visit counts").

## Recommended shape (for owner approval after Tier 1)
Make offer `completed` MEAN business-confirmed, so the ~40 existing readers become correct without touching each one:
1. Server: `complete_business_reservation` called by the business = today's behaviour. Called by the requester = record a
   personal mark only (new nullable `customer_marked_done_at` on the offer or the plan; status unchanged, no event, no
   metric). Builds <= 87 keep calling it from the customer side and get success, so nothing breaks.
2. Business UI: "Confirm visit" on eligible bookings (same rule as `canCompleteVisit`: accepted, confirmed reservation, no
   no-show, visit day reached), mutually exclusive with "Didn't show up" (the server already refuses completion after a
   no-show; the reverse must be checked).
3. Customer UI: "Visit confirmed" only from business confirmation; own mark shows a personal state. New wording needs the
   owner's approval and native review.
4. A journey covering both sides + the metric readers, run on a replay and staging before any deploy.

## Pre-implementation audit still to do (dependencies found, not yet read in full)
Readers of offer `completed` / `completed_at` (migration families, `integ/staging-run`):
- **Business reporting:** offer value (20270176), offer funnel (20270268), request funnel (20270270), Performance tile,
  routing/track record used by item 63's tie-break (20270236, 20270245), live-loop + intent funnel instrumentation
  (20270241, 20270249), business lifecycle history (20270267).
- **Customer side:** plans this month (20270301, item 53), first-visit note (item 52, client `fetchFirstRedemptionId`),
  plan lifecycle + parent plan status (20261210, 20261212, 20270114, 20270131), Plans history (`utils/planHistory.js`),
  "How was it?" outcome modal (`OfferOutcomeModal`), sound cue + `VisitConfirmed` motion.
- **Payments:** sponsored purchase/refunds/terms (20270155, 20270157, 20270159) read `completed`: check whether refund
  eligibility changes when a customer mark no longer completes. Stripe PaymentSheet for priced offers: confirm it does
  not depend on completion.
- **Safety/evidence:** report feedback (20270397), offer evidence (20270416), account deletion blockers (20270405),
  offer view privacy (20270422), event registry (20270247/20270248, `OFFER_REDEEMED`).
- **Group bookings:** 20270290 + journey `groupBookingLifecycle` (both customer and business completion paths tested
  today: those expectations change).
- **Multi-location (staged 0424):** business permission must use the membership/selected location, not only
  `managed_partner_id`, once that stack deploys.
- **Tests that encode today's behaviour:** journeys `offer`, `groupBookingLifecycle`, `plansThisMonth`, `planHistory`,
  `perkRedemption`; Jest `dashboardGlance`, `offerProgress`, `requestTimeline`, lifecycle matrix.
- **Existing data:** production has 0 business offers (no backfill question); staging test rows were completed by
  whoever ran the test (confirmer unknown).

Open owner questions: (1) where the customer's personal mark lives (offer vs plan); (2) whether "N plans this month"
should still count a customer's own mark (today it does); (3) the customer-side wording for their own mark.
