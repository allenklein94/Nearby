# Business website release checklist (2026-11-22)

Owner request: one consolidated branch with the website-only owner flow, Home request preview, blank-dashboard fix and
admin-link fix; full automated checks; a release checklist. **Nothing merged, deployed, published or set. Build 87 untouched.**
"4 people" wording kept as built.

## 1. The branch

**`integ/business-website`** (pushed, head e5d4fcd13). Integration branch only: never merge it as is.

It already contained everything; this session added only two missing docs from `post-tier1/business-web-only`
(the Resend checklist with the verified domain + `EMAIL_REPLY_TO`, the Customer messages native-review sheet).

| Piece | Where it came from | On the branch |
|---|---|---|
| Blank-dashboard fix (TDZ) | main 708b7600 (`hotfix/web-dashboard-tdz`) | yes (ancestor) |
| Admin review link fix | main f6c50f96 (`hotfix/web-admin-link-hidden`) | yes (ancestor) |
| Website-only owners (web CompleteProfile, 0418 claim fix, exact-request email link) | `post-tier1/business-web-only` | yes (every code change; that branch's 12 other commits are equal patches or older versions this branch already replaced) |
| Home request preview | `post-tier1/business-web-only` 743f3150a / baa7d10d1 | yes (2dca96e39 / e86d842e4, same patches) |
| Website success toasts (D1, `SuccessToastHost` in `App.web.js`) | `post-tier1/visit-confirmation` 0ee217ca4 | yes |
| Build 87 source (main) | main 4e75b915f | yes (merged) |

**Integration conflicts: none open.** All conflicts were resolved when the combined staging tree was built (see
`staging/onboarding-visit-2026-11-22`, `integ/staging-run`). Not included on purpose: `post-tier1/custom-domain` (3 commits;
merging it IS the domain cutover, own approval) and docs-only commits on `post-tier1/multi-location`.

**What "consolidated" really means here.** The website is an export of the whole app, and `deploy.js` deploys migrations
in number order only. So this tree is not only the website: it also carries the trust & safety stack (0348-0416),
multi-location (0424-0427), customer messages (0428-0429), visit confirmation (0430-0432) and the onboarding fixes.
A website release from this tree depends on that whole stack being live (section 4). A smaller first step that works on
production today is in section 6.

## 2. Already built and tested (automated, local only; logs `/workspaces/.nearby-verify/v461`)

| Check | Result |
|---|---|
| Jest | 605/605 suites, 8146 tests passed (11 todo) |
| iOS export | clean |
| Website export (`/Nearby/business` base) | clean |
| Headless website check, mocked Supabase (sign-in states, no-profile CompleteProfile, not-linked, linked dashboard + all tabs, email link -> exact request, Make an Offer + preview, Home request preview, Performance layout, tampered link) | 86/86 |
| Empty-database rebuild (0001 -> 20270432) | 555/555 migrations applied |
| Journeys on that rebuilt DB | 142/142 suites, 1572/1572 tests |
| Concurrency scripts on it | 7/7 pass (business-message-alert, booking-capacity, offer-revision, reschedule-accept, reschedule-reply, behavior-signal, review-case) |

Not proven by any of this: a real browser, a real sign-in, real email delivery, an iPhone, dark mode, larger text,
real data. Headless = mocked backend.

## 3. You configure manually (never in chat, Git or a log)

1. **Twilio (check FIRST).** Production sends sign-in codes through **Twilio Verify, account ending 941e**
   (service ending 51d9; read from Supabase Auth settings 2026-11-22). Supabase can't tell whether that account is a
   **trial**. In the Twilio console: if it is a trial, Verify only reaches verified caller IDs, so a new business owner
   would never get a code. Upgrade before inviting any real owner. Also note: Supabase allows 30 SMS per hour for the
   whole project (`rate_limit_sms_sent`) and 5 s between codes per number.
2. **Resend on production.** Production has NONE of `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `BUSINESS_WEB_URL`
   (secret names checked 2026-11-22; only `ANTHROPIC_API_KEY` exists). Values: section 0 of
   `BUSINESS_EMAIL_RESEND_STAGING_CHECKLIST_2026-11-18.md` (production key, `Nearby for Business <alerts@mail.thisisnearby.com>`,
   `support@thisisnearby.com`, website address before/after the domain cutover). Domain + DNS: already done (staging E3/E22 PASS).
   Until set, business email stays off; push still works.
3. **Anthropic credit** (production org has none). Without it every offer, logo, note and profile text a business types
   fails closed ("Try again"): the website can sign in and browse but can't send a hand-written offer. Automatic
   replies don't need it.
4. **`REVIEWER_EMAIL`** secret (review-login redeploy needs it; App Review only, not the website).
5. **Every installed app build > 87** on every business-owner device before 0422 and 0430 (old builds show "{viewedCount}"
   literally and "Visit confirmed" for the customer's own tap). Today: one iPhone.

## 4. Database migrations and edge functions that need deployment

Production is at **20270347** (ledger, read-only 2026-11-22). **84 migrations** are staged after it, 20270348 -> 20270432,
deployed **only in number order through `npm run migration:deploy`**, each with its own approval code. The website
features need these specifically, but `deploy.js` can't skip the ones before them:

| Migration | Website need |
|---|---|
| 0348 | profile column privacy: device gate first (every device on build 87+, website re-exported) |
| 0418 | a website-only owner's application links once their profile exists (without it the claim is marked before the profile and the owner is never linked) |
| 0419 | "We go to customers" service area at sign-up |
| 0420 | offer screening retries itself on temporary failures |
| 0421 | dead push token -> that one alert goes by email |
| 0422 | customer read receipts never reach the business (gate: build > 87 on owner devices) |
| 0423 | Profile > "Phone + website" (on 0347 that row shows an error) |
| 0424-0427 | multi-location (0427 blocker: old-build sign-in loophole, see CLAUDE.md) |
| 0428-0429 | customer messages alert the business |
| 0430-0432 | business "Confirm visit" (ship the new client first) |

Static check of this branch's client against production today: 62 server functions it calls exist only in staged
migrations. Business ones fall back quietly (`get_my_businesses` -> no location selector, `note_location_aware_session`
best effort) except `get_business_contact_details` (row error). Everything else is admin/trust, website-admin only.

**Edge functions changed since production's last deploy (2026-10-28 22:30 UTC):** send-push (prod v28),
screen-business-content (v47), submit-business-application (v12), business-email (v3), business-ai-assistant (v3),
business-stripe-connect-onboarding (v4), delete-account (v9), moderate-photo (v17), report-presence (v13), review-login
(v7), screen-user-content, `_shared`. Each redeploys at the point `scripts/live-verify/post-deploy.js` names (e.g.
send-push right after 0421 and again after 0428; screen-business-content at 0372 from the 0415 tree or later;
delete-account + moderate-photo with 0349). The exact-request email link needs only send-push + the Resend secrets.

## 5. Verifiable on staging before production

Staging (`nearby-staging`) is at 0432 with Resend live. Already PASS there: email delivery + privacy (E3, E22), exact-request
link (E8/E9/E19), visit confirmation server + website (V1-V11, V13). Still to run on staging, from THIS branch's export:

- [ ] Website export of `integ/business-website` against staging (local, unpublished), real browser
- [ ] New owner: apply on the website -> admin approves -> phone code -> CompleteProfile -> dashboard linked (0418)
- [ ] A customer request -> push + email -> email link signed out -> sign in -> exact request opens
- [ ] Home request preview: shows up to 3, a row opens that request, booked/expired disappear at the deadline
- [ ] Make an Offer: preview = customer card; hand-written offer (BLOCKED until staging has its own Anthropic key, separate org)
- [ ] Accept -> Bookings -> Confirm visit -> success toast once
- [ ] Profile save, contact details, service area both modes
- [ ] Dead-token email (0421) with a deleted app (needs the staging iPhone build)
- [ ] Customer phone steps (A5/A8/A10, V3/V6/V10/V12): need the staging iPhone build (owner runs EAS)

Twilio: staging sign-in uses a test OTP (expires 2026-11-28), so staging can't prove real SMS. Production's SMS check
stays separate (Tier 1 item 0(f)).

## 6. Two ways to release (your choice)

**A. Now, with no database change:** publish the export of **main** (dashboard + admin-link fixes, f6c50f96), after
your signed-in pass on the local export. Works on 0347. Rollback = revert the publish commit. The request preview is
client-only and also works on 0347 (production's `get_business_opportunities` already returns `partner_id`), but adding
it to main means changing main: needs your approval and does not touch build 87's pinned source 2a28c8e8.

**B. The full website from this branch:** only after 0348-0432 (or at least through 0423) are live and verified, Resend
is set and Twilio is upgraded. Publishing it on 0347 would show the contact-details error and a website-only owner would
never be linked (no 0418).

## 7. Needs your explicit approval (one by one)

1. Publishing anything to `docs/business/` (A or B).
2. Adding the request preview (or anything) to main.
3. Each production migration, by its approval code, in number order.
4. Each production edge-function deploy.
5. Setting production secrets (you set them yourself).
6. Upgrading Twilio / adding Anthropic credit / Resend production key (your accounts).
7. The custom-domain cutover (merging `post-tier1/custom-domain`).
8. Staging steps that change staging (deploying functions there, creating test accounts, sending test requests), as before: one approval per run.

**Separate and first:** the pending iPhone Back-button test on build 87. Nothing here touches build 87.
