# Staging Supabase project: audit + setup plan (owner Option 1, 2026-11-15)

Status: PLAN ONLY. Nothing created, deployed, merged or published. Production unchanged.
Priority stays build 87 + Tier 1; staging work starts only after the owner approves the steps below.

## 1. Read-only audit of the "seven seeded test businesses" (production, 2026-11-15)

Run by `node scripts/phone-session/seed.js status` (read-only) plus a direct read of `brand_partners`,
`business_requests` and `business_request_offers` via the Management API.

| Question | Result |
|---|---|
| Do the seven test businesses exist? | **No.** `seed.js status`: 0 people, 0 profiles, 0 businesses, 0 gatherings, 0 owner links. They exist only in the seed PLAN (code 7530ef9b5bb4), which was approved 2026-10-25 but never applied. |
| Businesses in production | **1:** Coastal Coffee (created 2026-07-31), `active` = true, **no latitude/location** (`location_source` null), not named "test". |
| Publicly discoverable? | Coastal Coffee has no point, so it can't be routed to or shown on the map or in distance lists. Nothing else exists. |
| Real requests reaching them | 0 business requests in production in total, 0 offer rows. |
| Effect on demand analytics | None: no requests, and every business-facing aggregate needs >= 5 distinct people. |

**So no cleanup is needed.** The earlier worry came from the seed plan's *design* (7 businesses), not from rows in production.
Recommendation: leave Coastal Coffee exactly as it is. Don't apply `coastal-coffee-setup.js` (plan 292906c9d1de) to
production: under Option 1 it is superseded by a "Coastal Coffee (test)" created in staging. Keep the script for staging.
Don't apply the production phone-session seed either (see section 7).

## 2. Facts the plan rests on (checked 2026-11-15)

- Supabase org `rqptmsklhjkgnjgdygmo` has 2 projects: Nearby (prod, active) and Anesthesia-ai-os (**INACTIVE/paused**).
  The Free plan allows 2 *active* free projects, so a free staging project fits (the owner confirms on the dashboard while creating it).
- Prod: 34 edge functions live (35 in the repo); secrets set = AWS keys, REVIEW_LOGIN_PIN, ANTHROPIC_API_KEY, REVENUECAT_WEBHOOK_SECRET.
- The app + business website read the Supabase URL and key from ONE file, `src/services/supabase.js` (hard-coded to prod).
  Other prod refs are only in QA/live-verify/trust-safety scripts.
- `app.json`: bundle id `com.allenklein.nearby`; Turnstile host `allenklein94.github.io`; `eas.json` has development/preview/production profiles only.
- A from-scratch replay of all 494 migrations already works (`scripts/replay/from-scratch-replay.sh`, isolated). `deploy.js` has `prod` and `local` targets only; `local` refuses hosted Supabase.
- `supabase/.temp/linked-project.json` links the CLI to PRODUCTION: a plain `supabase functions deploy` would hit prod.

## 3. Isolation safeguards (non-negotiable)

1. **Separate project, separate credentials.** New ref + keys; the staging token/keys live only in a new gitignored file
   (`.claude/staging.json`), never in Git, chat or logs. The prod Management token is never used against staging, and the reverse.
2. **No production data.** Schema comes from the repo's migrations; data = synthetic only (labelled "(test)",
   `*.nearby.invalid` emails, 555-01xx fictional phones). No pg_dump/copy from prod, ever.
3. **Ref guard.** Every staging script/command takes the staging ref explicitly and refuses `enmosvippabmuqslzrox`
   (and the CLI's linked project is never used). `deploy.js` gets a `staging` target with its own ledger; the prod checks are unchanged.
4. **Auth:** phone sign-in with **test OTP numbers only** (fixed codes for the 555-01xx numbers; no Twilio, no real SMS). CAPTCHA off. Signup hook can be rehearsed there.
5. **Notifications:** push only to the staging app's tokens (separate bundle id, below). Resend/email: not configured (inert).
6. **Payments:** Stripe test keys only, or none. RevenueCat: none (no app record for the staging bundle).
7. **AI:** a separate Anthropic key with a small credit cap (only if hand-written offers are tested); otherwise screening fails closed, as on prod.
8. **Google, AWS, PostHog, Sentry:** not configured in staging (Google discovery stays off; analytics/crash reporting disabled in the staging build) so test activity never mixes with production data.
9. **Fail closed (owner, 2026-11-15, required in step B):** the staging build and every staging script refuse to start
   if any configured value points at production: Supabase URL/ref and publishable key (database, Auth, Storage, realtime,
   edge-function URLs all derive from the ONE URL, which is checked), push (staging bundle id + staging Expo project
   credentials; staging `send-push` refuses a token registered to the prod project), payments (Stripe key must start
   `pk_test_`/`sk_test_`; a live key = refuse), server functions (staging secrets checked to hold no prod ref or prod
   service key). A refusal shows an error screen and makes no request. Guard tests cover each, plus the reverse (a
   production build never carries a staging value).
10. **Staging passing ≠ production approval** (owner rule, 0414): each production migration keeps its own approval; final production smoke tests with real, authorized business accounts are still required.

## 4. What a staging-connected iOS build + business website need

Code change (one branch, AFTER build 87 is submitted, so build 87 is untouched):
- `src/services/supabase.js`: read URL + publishable key from `Constants.expoConfig.extra` (default = prod, so prod builds behave the same).
- `app.config.js` wrapping `app.json`: `APP_VARIANT=staging` → bundle id `com.allenklein.nearby.staging`, name "Nearby Staging",
  staging URL/key in `extra`, analytics/Sentry off. A separate bundle id means it installs NEXT TO the real app and never receives prod pushes.
- `eas.json`: a `staging` profile (`distribution: internal`, `env: { APP_VARIANT: "staging" }`). The iPhone is registered once (`eas device:create`).
- Guard test: a prod build can never carry the staging ref, and a staging build can never carry prod's.
- Business website: `APP_VARIANT=staging npx expo export -p web` into a scratch folder, served locally/forwarded privately
  (Codespaces port). Never written into `docs/` (GitHub Pages = production).

The owner runs the EAS build (never from a session). Native code stays the same as build 87, so this is a build-config change only.

## 5. Lifecycle verification in staging (consumer request → offer → acceptance → booking)

Actors (all synthetic): consumer = a staging phone account on the staging iPhone app; business = "Coastal Coffee (test)" managed by
a second staging account on the staging website; friend = a third test account.
1. Schema: apply the migrations production runs today (through the live set), so the test reflects what users get.
2. Edge functions: deploy all repo sources to staging (explicit `--project-ref`).
3. Seed: `coastal-coffee-setup.js` + the phone-session seed, pointed at staging (labelled test point, hours 07:00-18:00, largest group 10,
   auto-accept up to 10, Coffee).
4. Run: ask "coffee today" → "We asked 1 nearby business" → Opportunity on the website (exact-request link) → automatic reply (no AI needed)
   → reply signature + push on the staging phone → "I'll take this one" → "You're booked" → Your Plan → business marks the visit
   completed on the visit day → "✓ Visit confirmed" → Plans > Past.
5. Hand-written offer: only with the staging Anthropic key (section 3.7); otherwise recorded SETUP-BLOCKED.
6. Then (separately) rehearse the staged migrations 0348+ in number order on staging, the rehearsal the 0414 gate asks for.

## 6. Costs

| Item | Cost |
|---|---|
| Supabase staging project (Free) | $0; pauses after ~7 days idle (restore from the dashboard). Pro alternative: $25/month org + compute per project. |
| SMS | $0 (test OTP numbers only) |
| EAS internal build | within the free build quota |
| Anthropic (optional, hand-written offers) | a few dollars with a hard spend cap |
| Stripe test mode | $0 |

## 7. Approvals needed (each separate)

- **A.** Owner creates the staging project in the dashboard (region us-east-2, Free), then shares nothing in chat: the owner (or a session, with approval) puts the ref + keys in `.claude/staging.json`.
- **B.** Code branch: config change (section 4) + `deploy.js` staging target + ref guard. Built after build 87 is submitted; not merged until approved.
- **C.** Applying migrations + deploying functions to staging (no production effect, but recorded).
- **D.** Staging secrets (owner sets them: Anthropic key with a cap, Stripe test key if wanted).
- **E.** Owner runs the staging EAS build.
- **F.** Seeding staging + running the lifecycle; results recorded per scenario (Functional / Usability / Visual / Device / Evidence).

Production: no Coastal Coffee setup, no production seed, no test-business migration, nothing merged or published.

## 8. Hosted check of multi-location 0424-0426 (owner, 2026-11-16; approval-gated, NOT started)

Local verification ACCEPTED (owner, 2026-11-16); multi-location development FROZEN; NOT production-ready. This hosted
step runs only after build 87 is submitted, inside approvals B (code: `deploy.js` staging target + ref guard) and C
(apply + deploy to staging), each asked for separately. Before it starts, the session confirms in writing: target ref =
`hxsioiiulubavhogzipo` (refuses `enmosvippabmuqslzrox`), the staging project holds synthetic data only, and no command
in the step names the production URL, ref or keys.

What changes (staging only):
1. Migrations: the COMBINED tree (`integ/multi-location-x-trust`), every file in number order through 20270426,
   via `deploy.js --target=staging` (own staging ledger). 0426 sets `pgrst.db_pre_request` on `authenticator` and
   reloads PostgREST: this is the first thing that must work on hosted Supabase (check 1).
2. Edge functions from that tree: `send-push` (location named in alerts + `&b=` link), `screen-business-content`,
   `business-ai-assistant`, `business-stripe-connect-onboarding` (location forwarded as `x-nearby-business` / 409 when stale).
3. Test data: one test owner account (555-01xx test OTP number), two test locations "(test) Location A/B", one A-only
   staff account; labelled "(test)", `*.nearby.invalid`; nothing else.

Checks (each recorded PASS/FAIL separately; any unexpected result = stop + report):
1. Hook installed: `select rolconfig from pg_roles where rolname = 'authenticator'` names `public.nearby_pre_request`;
   a plain REST read works; a call with a stale `x-nearby-business` returns 400 P0001 hint `business_selection_changed`.
2. CORS: a browser-origin preflight from the website origin allows the `x-nearby-business` header (else the website breaks
   for every business call: STOP).
3. Edge forwarding: each function above refuses a stale location and succeeds for the selected one.
4. Two-device test: `scripts/replay/business-selection-api-local.js` pointed at the staging URL (30 checks incl. the racing
   switch on the hosted pooler, B byte-identical).
5. Rollout gate: adding a second location is refused while a non-location-aware session is live (`multi_location_not_ready`).

Cleanup: delete the test accounts (auth + profile cascade), both test businesses and their memberships, by recorded ids;
then count = 0 for each. Rollback (staging): `scripts/rollback/20270426`, `20270425`, `20270424` newest first, then
redeploy the four functions from the pre-0424 tree; or simply discard the staging project (it holds nothing real).

Mandatory blocker before ANY real business gets a second location (owner, 2026-11-16): the old-build loophole. A build
<= 87 signing in AFTER the second location exists sends no header and is not stopped by the gate. Needs a definitive fix
(e.g. for accounts with 2+ memberships, refuse location-specific writes that carry no valid `x-nearby-business`), built,
tested and approved on its own. Passing this hosted step does not lift it.
