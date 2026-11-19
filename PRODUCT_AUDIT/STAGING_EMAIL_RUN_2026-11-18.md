# Staging email run (owner approved steps 1-3, 2026-11-18)

Approved (owner, 2026-11-18, chat): apply migrations + deploy functions to the ISOLATED staging project, configure staging
email, run the staging safety check, run the email / browser / link tests (E1-E23 minus phone-only ones), clean up.
NOT approved: anything on production, the GitHub custom domain, the production website, production merges, Build 87.

Tree deployed: `integ/staging-run` (never merged) = `integ/ml-x-trust-x-business-messages` (business web + email incl.
`EMAIL_REPLY_TO`, multi-location 0424-0427, the trust & safety stack, business messages 0428; 551 migration files) +
`staging/environment-config` (approval B tooling + the 2026-11-18 email preflight). Merge notes in commit cb3c924b.

## Status

| Step | State |
|---|---|
| Isolation (local facts) | PASS: staging ref `hxsioiiulubavhogzipo` != production; staging URL names only that ref; the staging website bundle embeds only the staging URL + publishable key (production appears only as the constants a staging build compares against and refuses) |
| Tree assembled + Jest | PASS: 593/593 suites, 7998 tests (cb3c924b) |
| Local bootstrap rehearsal (all 551 files, re-point + outbound audit per transaction) | PASS 2026-11-18 (log /workspaces/.nearby-verify/stg/boot-local7.log; real Auth v2.197.0 schema first, as on a hosted project): 551 applied in 152 s, final audit 0 findings, 0 functions / cron jobs name production, 6 functions call STAGING edge functions, an unfixable production webhook argument and a stored production URL each refused their transaction. Found + fixed on the way (3613c5cd / staging/environment-config): 20270391's `private.story_media_settings.storage_url` defaulted to production's Storage API (the photo-cleanup job's DELETE target); the re-point now also rewrites column defaults and `private.*_settings` rows, the audit still checks independently |
| Private staging website | built (APP_VARIANT=staging, base /business), served from this codespace on port 8787 (private: only your GitHub login opens it): `https://automatic-space-robot-vppgg79q56j7cxj7j-8787.app.github.dev/business/`. A codespace restart stops the server; the session restarts it (same address). |
| Hosted staging bootstrap, functions, Auth, secrets | WAITING on the two owner steps below |

## Owner step 1: a separate Supabase access token for staging (needed before ANY staging change)

Approval B requires the staging tools to use their own token, never the one production work uses
(`NEARBY_STAGING_ACCESS_TOKEN`, refused if equal to `SUPABASE_ACCESS_TOKEN`). None exists yet.

1. supabase.com > your avatar > **Account preferences > Access Tokens > Generate new token**, name `nearby-staging-session`,
   expiry 7 days if offered. Copy it into Bitwarden (Nearby — Infrastructure).
2. Put it in the codespace without it touching chat, Git or history. In the codespace terminal (VS Code / browser, bash):
   ```
   read -rs T && printf '%s' "$T" > /workspaces/Nearby/.claude/staging-access-token && chmod 600 /workspaces/Nearby/.claude/staging-access-token; unset T
   ```
   Paste, press Enter (nothing is shown). `.claude/` is gitignored. Tell the session "token in place".
   Revoke it in the dashboard when staging testing ends.

## Owner step 2: the staging Resend key (after the session reports functions deployed)

Easiest, nothing in any shell: Supabase dashboard > project **nearby-staging** (`hxsioiiulubavhogzipo`) > **Edge Functions >
Secrets** > Add `RESEND_API_KEY` = paste the STAGING key from Bitwarden > Save. Check the project name before saving.

PowerShell alternative (Supabase CLI logged in on your PC). `Read-Host -AsSecureString` input is never written to PowerShell
history; the key exists only in this window's memory and is cleared at the end:
```powershell
$sec = Read-Host -AsSecureString "Staging Resend key"
$key = [System.Net.NetworkCredential]::new('', $sec).Password
$tmp = New-TemporaryFile
Set-Content -Path $tmp -Value "RESEND_API_KEY=$key" -NoNewline
npx supabase secrets set --project-ref hxsioiiulubavhogzipo --env-file $tmp
Remove-Item $tmp -Force; Remove-Variable key, sec
npx supabase secrets list --project-ref hxsioiiulubavhogzipo   # names + digests only
```
(`--env-file` keeps the key off the command line, so it isn't in process listings either.) Then tell the session
"staging Resend key set". The session sets the non-secret values itself: `EMAIL_FROM=Nearby Staging
<alerts@mail.thisisnearby.com>`, `EMAIL_REPLY_TO=support@thisisnearby.com`, `BUSINESS_WEB_URL=<the address above>`, and runs
the preflight with `NEARBY_STAGING_RESEND_KEY_CONFIRMED=1 NEARBY_STAGING_EXPECTED_WEB_URL=<that address>` (fails closed if
the URL digest is missing or differs).

## Results

(filled in as the run proceeds)

- 2026-11-18 (session re-check, read-only, nothing written to staging): staging Auth answers (GoTrue v2.198.0; the local
  rehearsal used v2.197.0 = prod, so the hosted bootstrap's first transaction is the real check), `public.profiles` absent
  (PGRST205) = staging still EMPTY; `.claude/staging.json` ref != production and its URL names only the staging ref.
  Website bundle: runtime `nearbyEnv` = variant staging + the staging URL + the staging publishable key; production's ref,
  URL and PUBLIC publishable key appear only in `src/config/environments.js`'s comparison constants. Website server
  restarted after a codespace restart (same address, 200). Preflight fail-closed on BUSINESS_WEB_URL confirmed in code
  (missing digest / missing expectation / mismatch / production address = refused), `stagingSafety.test.js` 71/71.
  Noted, not changed: this tree lacks main's Maps-key fix (f9f64988); irrelevant to the staging website (web exports
  never carry the key) and no staging native build is in scope.
- BLOCKED on owner step 1: `.claude/staging-access-token` does not exist, so no hosted staging change has been made.
- 2026-11-18 staging access token (owner, `.claude/staging-access-token`, 600, gitignored, untracked, `sbp_` + 40 hex,
  != the production token). Read-only scope check, nothing written anywhere: it is a FINE-GRAINED token. PRODUCTION: every
  call refused 403 "Your account does not have the necessary privileges" (project metadata, secrets, functions,
  database/query `select 1`). Staging: database/query `select 1` 201, secrets GET 200 (0), functions GET 200 (0);
  refused: project metadata (missing `project_admin_read`), `config/auth` GET (missing `auth_config_read`); organization +
  project listing 403. Consequence: the preflight reads `config/auth` and will refuse (fails closed) until the token has
  `auth_config_read`. Write permissions (functions deploy, secrets set, Auth config) not tested (testing = writing).
  STOPPED here for owner review; no preflight, migration or deploy run.
- 2026-11-18 ~12:20-13:10 UTC, token v2 (owner, `.claude/staging-access-token`, 600, gitignored, `sbp_` + 40, != the
  production token). Read-only scope check: PRODUCTION refused 403 on project metadata, `config/auth`, secrets, functions,
  `database/query`; project + organization listing 403. STAGING: all five answer (200/201), incl. `config/auth` (v1 lacked it).
- Bootstrap (approval C, code 50f8921b1b91 = 551 files through 20270428, ref hxsioiiulubavhogzipo): first run stopped after
  144 files on a Management API 429 (ThrottlerException; that file rolled back). Tooling fixed (ceeccb36: retry ONLY 429,
  backoff; `--resume-after=<last ok file>` under the same code, refused on an empty project / a file outside the list; 79/79
  staging tests) and resumed after 20261005_notification_categories.sql: 407 more, exit 0. Re-point 0 left, final outbound
  audit clean. Independent read: ledger 84 rows, 0 functions + 0 of 52 cron jobs name production, 0 users.
  Logs /workspaces/.nearby-verify/stg/hosted-boot.log + hosted-boot2.log.
- Functions (approval C): all 35 deployed with the staging token, `--use-api`, explicit ref (ed62a13f: production's 5
  verify_jwt-off functions kept off: stripe-connect-webhook, sponsored-stripe-webhook, revenuecat-webhook,
  submit-business-application, resweep-business-content). API check: 35 ACTIVE, 0 verify_jwt mismatches. CLI 2.58.5 from a
  scratch folder (the repo's `npx supabase` has no linux-x64 binary). Log /workspaces/.nearby-verify/stg/fn-deploy.log.
- Preflight (read-only): exit 0, "no real SMS, email, payment or production credentials; nothing names production"
  (0 custom secrets). Log preflight1.log.
- Website server restarted (port 8787, same staging export, 200).
- Test account (synthetic, for the E checks; cleanup by id): owner W = auth user 7bfdc2ed-fce2-42e5-963f-19a545d21873
  (`owner-w.e-tests@staging.nearby.invalid`, password sign-in, no phone), profile same id, business
  f570296c-ee03-4eb5-85ef-dc9406e1a7bd "Staging Test Business W (not real)" (no location, so never routed).
- **E2 PASS (server):** no email secrets set -> `business-email` start = 200 `{ok:false, reason:'email_not_configured'}`;
  `business_email_settings` 0 rows (nothing stored or verified); invalid address 400; no auth 401. Client maps the reason to
  "Email alerts aren't switched on for Nearby yet. Phone notifications still work." (`src/services/businessEmail.js:59`);
  on-screen display NOT checked in a browser.
- Not run, and why: E1, E3-E5, E7, E9-E12, E16-E18, E22 need the STAGING Resend key (owner step 2) + an inbox the owner
  reads; E4-E8/E17-E21 also need staging website sign-in (phone code = Auth test OTP numbers, a staging Auth change not
  yet made) and DB->send-push delivery (vault `service_role_key` on staging, not yet set); E13-E15 need a staging phone
  build (SETUP-BLOCKED); E23 only after the custom-domain cutover (NOT TESTED). Nothing in production touched.
- 2026-11-18 ~12:30-12:40 UTC (recorded after a codespace restart, from the logs; the headless link script lived in the
  session scratchpad and was lost): non-secret email values set on staging (`EMAIL_FROM`, `EMAIL_REPLY_TO`,
  `BUSINESS_WEB_URL`); preflight exit 0 with 3 custom secrets (preflight2.log). Extra synthetic accounts: owner W2
  (`owner-w2.e-tests@staging.nearby.invalid`, second business), customers C + C2 (`customer-c*.e-tests@staging.nearby.invalid`);
  5 business_messages rows, 0 requests. Headless browser on the private staging website, link landing only (no email sent):
  run 1 (links1.log) 11/13: E21 (other owner W2 sees nothing from C), E6 (non-owner C2 sees nothing), E20 x5 (random uuid,
  not a uuid, unknown type, no query, request type + random id: no page error, nothing shown), address-bar query removed,
  only staging hosts contacted = PASS; E5 + E18 FAIL because W landed on Complete your profile (W's profile was incomplete:
  a setup gap, not a product defect). Run 2 (links2.log) after that: E5 (`?n=business_message_received&r=&b=` opens W's
  conversation with C, query removed, no page error, only staging hosts) + E18 approx (signed out at click -> after sign-in
  lands on the conversation) PASS. Not yet a real email: the link was opened directly.
- 2026-11-19 (session, after a codespace restart): owner step 2 DONE: staging secrets now `EMAIL_FROM`, `EMAIL_REPLY_TO`,
  `BUSINESS_WEB_URL`, `RESEND_API_KEY` (names only read). Preflight with `NEARBY_STAGING_RESEND_KEY_CONFIRMED=1` +
  `NEARBY_STAGING_EXPECTED_WEB_URL=<private address>`: exit 0, 4 custom secrets, URL digest matches (preflight3.log).
  Website server restarted (port 8787, 200). Next: E1 (code email to an inbox the owner reads) -> E3 -> E4/E5/E9-E12/E16-E18/E22;
  needs the owner to name the receiving address.
- 2026-11-19 real emails (owner approved: staging -> support@thisisnearby.com only, which forwards to the owner's Gmail).
  Token for W via a staging-only password reset + password sign-in (helper /workspaces/.nearby-verify/stg/e-env.sh).
  **E1 PASS:** `business-email` start 01:46:01 UTC -> code email received by the owner; confirm with the owner's code at
  01:46:58 = `{ok:true}`, row verified_at 01:46:58, enabled, 0 attempts (under 1 min). Wrong / expired code messages NOT yet checked.
  Delivery path: send-push is reached from the DB (vault `service_role_key` present); the 4 rows from 2026-11-18 answered
  `skipped:no_token, emailed:false` (address unverified then = correct). Observation, not judged yet: every outbox row stays
  `status=queued` after a 200 from send-push.
  **E5 / E12 (server + link):** C's message 36d3dc6a (01:47:50) -> outbox 9 -> send-push `skipped:no_token, emailed:true`;
  the owner received it and pasted the email's link = `<BUSINESS_WEB_URL>?n=business_message_received&r=36d3dc6a-…&b=f570296c-…`
  (exact message + business). Headless (playwright 1.47, /workspaces/.nearby-verify/stg/linkcheck/link.py, signed in by
  session injection): as W it opens the conversation with C (all of C's messages incl. the new one), query removed, no
  page error, only 127.0.0.1 + the staging host; as W2 = W2's own Opportunities, nothing from C (E6 PASS); signed out =
  Sign in screen (E18's after-sign-in leg passed 2026-11-18, links2.log). Owner still to confirm: sender, subject, one copy,
  no customer name / message text in the email.
  **E7 PASS (server):** C's 3 messages 01:58:30 / 01:58:45 / 01:59:00 -> ONE outbox row (12, first message) -> emailed:true;
  after the window a new message alerts again (row 13 below). Owner to confirm one email, not three.
  **E10 message leg PASS (server):** W had `owner_requests` muted (left from 2026-11-18) during E5 + E7; messages still
  emailed. Request leg needs E4 (routing needs a located business).
  **E9 FAIL (Sev 3, staged 20270428, not deployed):** W muted `owner_messages` (`set_my_notification_group`); C2's message
  01:59:42 -> no outbox row (correct); unmuted at once; C2's next message 01:59:51 -> NO alert, also at 02:01:51; only
  02:04:55 (row 13, emailed:true) alerted. Cause (code): `private._alert_business_message` claims the conversation's
  5-minute window (`business_message_alert_windows`, last_alerted_at = 01:59:42, the MUTED message) before `_send_push`
  applies the mute, so a muted message suppresses the next 5 minutes of alerts after the switch goes back on. Same for a
  conversation whose only recipients are suspended or blocked. Not fixed (owner decision): smallest fix = claim the window
  only when at least one recipient will actually be sent the alert (mute/suspension/block checked before the claim).
- 2026-11-19 ~10:00-10:40 UTC: **website sign-in investigation.** "Unsupported phone provider" = staging Auth
  `external_phone_enabled` false (Auth v2.197.0 `otp.go` returns exactly that message when phone is off); staging has no SMS
  provider credentials. Supabase's hosted docs require an SMS provider even for test OTP numbers; the owner declined
  placeholder credentials and an SMS hook. Both staging tokens (v2 + v3) are refused `project_admin_write`, so Auth settings were
  NOT changed (v3: production 403 on every endpoint tried; v3 also lacks secrets/functions read, so preflight can't run with it).
  Owner W (`7bfdc2ed…`) now has phone 15615550110 confirmed (admin API, staging only; inert while phone sign-in is off).
  GitHub port-forward sign-in 302 carries the full path + query (`rd=/business/?n=&r=&b=`).
- **Option 2 (owner approved): automated headless sessions, no Auth change.** Playwright 1.47 container, fresh sessions for W / W2
  / C2 in a 700 folder (600 files), injected inside the browser only, revoked after (global logout 204, refresh refused 400),
  files shredded; every visited URL + console scanned: no token. Website at 127.0.0.1:8787 (same export). 10 cases, real email
  links (messages 36d3dc6a = E5 email, a7ee1309 = E9 row 13 email): (1) W + C's link = conversation with C incl. that message,
  query removed PASS; (2) W + C2's link = conversation with C2 PASS; (3) W2 (wrong owner) = own business, nothing of W's PASS;
  (4) C2 (customer) = "not linked to an approved business" PASS; (5) W + random message id = W's own conversation list (own
  data, no message opened) SAFE; (6) malformed id = W's dashboard, nothing opened, but the query stays in the address bar
  (observation, Sev 3); (7) real id + other business's b = nothing opened PASS; (8) unknown type PASS; (9) unknown request id =
  Opportunities + "This request isn't available anymore." PASS; (10) signed out = Sign in screen PASS. 0 page errors, only
  127.0.0.1 + the staging host contacted. NOT VERIFIED: the real phone sign-in screen on staging (needs phone sign-in enabled),
  the link surviving Nearby sign-in in a real browser (headless 2026-11-18 only), a real expired request (staging has 0).
