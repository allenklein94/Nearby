# Staging fixes + remaining non-phone checks (owner approved 2026-11-19, staging branch only)

Approved (owner, chat 2026-11-19): fix Test 6 (malformed-link cleanup) and E9 (muting), staging branch only; regression
tests; repeat the affected staging tests; finish the staging email/request checks that don't need phone sign-in; check
that future temporary session files are owner-only from creation. NOT approved: merge, production, website publish, Build 87.
Branch: `integ/staging-run` (never merged). Logs: /workspaces/.nearby-verify/v460.

## Fixes

| Item | Change | Local verification |
|---|---|---|
| Test 6 (Sev 3) | `src/utils/businessWebLink.js`: `n`/`r`/`b` leave the address bar whenever any is present, valid or not (`stripBusinessWebLinkParams`); other parameters kept; nothing stored for an invalid link | unit test added (fails on the old code); `businessWebLink.test.js` 26/26 |
| E9 (Sev 3) | migration `20270429_business_message_alert_mute_window.sql` (+ rollback): the 5-minute window is per RECIPIENT and claimed only after the sender/customer, suspension, block and mute (`_push_muted`) checks pass. A muted message claims nothing; switching alerts back on lets the next NEW message alert at once; muted messages are never replayed. Dedupe key, one alert per person per conversation per 5 min, `_send_push`, wording, failure handling unchanged. Old per-conversation windows dropped (timestamps only). | from-scratch replay (PG 17.6 + real Auth schema) 552/552; journeys 1560 tests, all pass after a test-only fix (`failure_window` now reads every recipient's window); `businessMessageAlerts` 14/14 incl. the new E9 test; targeted mutation (mute check moved back after the claim) = the E9 test alone fails; rollback = 14/14 fail (shape), re-apply schema diff 0, second apply idempotent; 7 concurrency scripts PASS incl. `business-message-alert-concurrency`; Jest 594/594 suites (one plan guard needed the 0429 post-deploy step, added) |
| Session files | `/workspaces` has default ACLs: an ordinary file is created rw-rw-rw- and umask 077 is IGNORED (checked). New `scripts/staging/private_files.py`: session/token/password files only via mkdir 0700 + O_EXCL 0600, mode re-checked, refuses otherwise (self-test PASS in /workspaces and the scratchpad). `stg/e-env.sh` now creates `w-pass` through it. This run's sessions: 0600 in a 0700 scratchpad folder, revoked (logout 204, refresh 400) and shredded. No token-bearing file left in `stg/` (grep). | |

## Staging results (2026-11-19 ~11:20-11:40 UTC)

- **0429 NOT applied to staging: BLOCKED.** `deploy.js --target=staging --check` refused by the Management API: the token in
  `.claude/staging-access-token` lacks `database_read` (v2 had it; the file now holds a token without it). No other credential
  tried. So **E9 is not yet repeated on staging**; script ready (scratchpad `e9-retest.sh`: mute -> message -> unmute ->
  message at once -> message again; expects 0 / 1 / 0 outbox rows for W).
- **Test 6 PASS** on the rebuilt private website (export of 2b5a3035, APP_VARIANT=staging; the Expo project id slot holds a
  synthetic placeholder 00000000-0000-4000-8000-000000000429: web never registers push tokens): malformed link -> W's
  dashboard, nothing opened, address bar `/business/` (before: the query stayed). Regression: the other 9 link cases same
  as before (1-4, 6-10 PASS; 5 = W's own inbox preview, own data, as recorded before); 0 page errors, no token in URLs or
  console, only 127.0.0.1 + the staging host.
- **E10 request leg PASS:** W had New requests muted; C's request targeted at W (1ae7f3c6) reached W's business
  (`notifiedCount` 1) and produced NO outbox row.
- **E4 (server + link) PASS, email arrival pending owner:** W switched New requests on; C's request f4dc22cd -> ONE outbox row
  to W (`business_opportunity_received`, that request + W's business), handed to send-push (net request 12; its answer is
  only readable with database access). Headless: W opening `?n=business_opportunity_received&r=f4dc22cd…&b=f570296c…` lands
  on Opportunities with the request listed; W2 (wrong owner) sees only W2's own empty business. Not verified: the exact card
  scrolled to + outlined. **Owner to confirm**: one email at ~11:35 UTC "A customer asked for your business" whose link
  carries that request id.
- **E1 no-pending-code PASS:** confirm with no code outstanding = `code_expired`; W's address stays verified. Wrong-code leg
  NOT run (a new code un-verifies the address until the owner reads it from the inbox).
- Fixture changes for these checks (staging only, labelled "(not real)"): W's business now has category Coffee (group
  food_drink), largest group 10, owner pin 26.59, -80.04 (`host_pin`, set by W through `set_business_location`); 2 requests
  from C (1ae7f3c6, f4dc22cd); W's New requests switch now ON. Add to the cleanup list.

## Still open

- Owner: a staging token WITH `database_read` + `database_write` (v2's scopes) so 0429 can be applied (`--check` then deploy)
  and E9 repeated; also needed for reading send-push answers (net._http_response).
- Owner: confirm the E4 email; E3 (Resend "Delivered" + SPF/DKIM headers) and E22 (no customer data in the email source).
- Not run here: E1 wrong code, E16 (needs changing the staging Resend secret: token lacks secrets write), E19 (no expired
  request on staging), E11 (switch labels on the website; can run headless next), E13-E15 (staging phone build),
  E23 (after the custom-domain cutover).
- Phone sign-in on the real website: PENDING (phone provider off on staging; separate item, not blocking the above).
- 20270429 and the link fix exist ONLY on `integ/staging-run`; before any production plan they must be carried to the source
  branches (business messages / business-web-only) with their own review. Number 20270429 may clash with another branch's
  next migration: re-number when carried.

## Follow-up (2026-11-19 ~11:50 UTC)

- **Token: still the old one.** `.claude/staging-access-token` unchanged since 10:13 UTC (same fingerprint as the token refused
  `database_read`; 0600, gitignored, not the production token). 0429 + the E9 staging retest wait for a NEW staging-only token
  (7 days, nearby-staging only: database read + write for the migration; secrets read + functions read + Auth config read so
  the full preflight can run). Prepared, not run: scratchpad `after-token.sh` = new fingerprint + 0600 check -> production
  refused on project / secrets / functions / Auth config / database query -> staging allows database query + the three
  preflight reads -> preflight -> 0429 hash = c0e32938… -> `deploy.js --check` (rolled back) -> apply -> `e9-retest.sh`. Token
  only in environment variables / a process-substitution header, never on a command line or in a log.
- **E11, website half PASS** (headless, W, rebuilt private site): Profile > Settings shows five separate switches; "New
  requests" and "Customer messages" are two different lines, both ON = the stored choices (W switched New requests on during
  E4); 0 page errors, no token in console/URL, only 127.0.0.1 + the staging host. The personal "Messages" switch lives in the
  app's Settings only (the website has no personal settings), so the app half (both lines on a phone) is SETUP-BLOCKED until a
  staging phone build. Session revoked (logout 204, refresh 400) and shredded.

## v4 token, 0429 on staging, E9 retest (2026-11-19 ~12:18-12:25 UTC)

- **Token v4 isolation PASS** (new fingerprint, 0600, owner-only folder): production refused all five calls (project, secrets,
  functions, Auth config, database query: 403); project listing refused (no `projects_read`); staging allowed all five (200 /
  database query 201). Token sent only via a process-substitution header; the account-wide `SUPABASE_ACCESS_TOKEN` was unset
  in every staging process.
- **Preflight PASS** (exit 0, 4 secret names, URL digest matches, nothing names production; `stg/preflight4.log`).
- **0429:** committed file sha256 c0e32938…b422 (commit 147a10bc), `deploy.js --target=staging --check` = CHECK OK (rolled back),
  then applied: ledger row `deployed` 2026-11-19 12:21:36 UTC, approval ref = owner chat ~12:20 UTC, session 26305aa4.
  `migration:status --target=staging` lists 20270429 recorded. Production untouched.
- **E9 PASS on staging** (W = only member of business f570296c; customer C2; `stg/e9-retest.log` + database read-back):
  W muted `owner_messages` -> M1 12:22:55 = no outbox row, no window claimed; unmuted -> M2 12:23:00 = ONE outbox row (15, W,
  dedupe key `business_message:<M2>:<W>`), window = W at M2's time; M1 still no row after unmute (no replay); M3 12:23:04
  (inside 5 min) = no row; no dedupe key used twice; W's mutes back to `[]` (all on). send-push answered row 15
  `{"ok":true,"skipped":"no_token","emailed":true}`; the outbox row still shows `queued`, attempts 1 (as earlier rows).
  Sessions revoked (logout 204 x2).
- **E4 email hand-off:** send-push answer for net request 12 (request f4dc22cd) = `emailed:true`. Owner still confirms arrival
  + contents in the inbox.
- Expected owner inbox: ONE "customer message" email ~12:23 UTC for M2 (not for M1 or M3).
- Staging fixture additions for cleanup: messages 667e3a56 / a5b36005 / edbcee81 (C2 -> W), outbox row 15, window row (W, C2).

## E9 email + link (2026-11-19 ~12:35-12:50 UTC)

- Owner: the 12:23 customer-message email ARRIVED; its link returned HTTP 502. Cause: the private website server (port 8787)
  was not running (nothing listening; the codespace process had stopped). Restarted the SAME export (`stg/web460`, the
  Test 6 build, via `stg/site/business`), same address, bound to 127.0.0.1; no email link, secret, migration or production
  setting changed. Local 200; the forwarded address now answers 302 to GitHub sign-in for a signed-out visitor (private
  port working) instead of 502.
- Headless link check (`stg/linkcheck-e9`), link shape = send-push's `?n=business_message_received&r=<M2>&b=<W's business>`:
  W -> W's dashboard, conversation with Customer C2 open, M2's text shown, address bar back to `/business/`: PASS;
  W2 (wrong owner) -> W2's own empty business, no C2 message: PASS; signed out -> sign-in screen, nothing shown: PASS.
  0 page errors, no token in URLs or console, only 127.0.0.1 + the staging host. Sessions revoked (logout 204, refresh 400),
  shredded.
- Still the owner's step: click the emailed link in a real browser (GitHub sign-in, then staging sign-in as W). Website
  sign-in by phone remains blocked on staging (phone provider off), so the real-browser journey needs W's session another way
  or stays PENDING.

## Real-browser click + remaining non-phone checks (2026-11-20 ~00:55-01:05 UTC)

- **Owner, real browser (after the 502 fix):** clicking the emailed link loaded the staging business sign-in screen (the
  private website + GitHub port sign-in carried the link through). Submitting the phone number returned "Unsupported phone
  provider" (staging Auth has phone sign-in off; no SMS provider). Recorded: **real-browser email-link navigation PASS up to
  the sign-in screen; real-browser authentication and the full open-the-conversation journey remain UNVERIFIED** (the
  headless runs with an injected session passed that leg, which is not the same). Owner decision: no placeholder SMS
  credentials; phone-dependent checks stay PENDING.
- Website server found stopped again at ~00:56 UTC (the codespace process ends on restarts); restarted the SAME export
  (`stg/web460`) on 127.0.0.1:8787 (`stg/http-e19.log`). Nothing else changed.
- **E19 PASS (expired request link):** request f4dc22cd (C -> W, staging test) moved past its deadline (expires_at = now - 1 min)
  and expired by the normal sweep `expire_stale_business_requests()` (request + W's row `expired`, 0 outbox rows). Headless,
  real link shape `?n=business_opportunity_received&r=f4dc22cd…&b=<W>`: W lands on Opportunities, "FROM YOUR NOTIFICATION |
  This request has expired. Nothing more to do." with that request's facts (Coffee · 2 people · Fri, Nov 20 · 10 AM) and no
  offer action; address bar `/business/`; W2 (wrong owner) = own empty business; signed out = Sign in. 0 page errors, no token
  in URLs/console, only 127.0.0.1 + the staging host. (The first run's FAIL was my expected wording, "isn't available anymore",
  which is the unknown-id message; the expired wording is the correct state.)
- **E8 PASS (multi-location, server + headless; email arrival = owner):** setup on staging: second location L2
  e8000000-0000-4000-8000-0000000000e8 "Staging Test Business W, Location 2 (not real)" (copy of W's business row), W
  membership L2 (owner). The 0427 gate held: adding L2 with no live location-aware W session was REFUSED
  (`multi_location_not_ready`); allowed after a W session called `note_location_aware_session` (204). W's selection = L1.
  C followed L2 (follower 9ce32ff2; the message policy requires it) and wrote message 222fea1d at 01:00:25 -> ONE outbox row
  (17, W, `data.partner_id` = L2, dedupe `business_message:222fea1d…:W`) -> send-push `{"ok":true,"skipped":"no_token",
  "emailed":true}` (net request 35). Headless link `?n=business_message_received&r=222fea1d…&b=<L2>`: W (L1 selected) lands on
  "Staging Test Business W, Location 2 (not real) | Managing 2 locations", conversation with Customer C open showing that
  message; server selection after = L2 (switched, server-checked). W2 (non-member) = own business, nothing of L2; C (customer)
  = "not linked to an approved business". 0 page errors, no token leak, only staging hosts. Sessions W/W2/C revoked (logout
  204, refresh 400) and shredded. **Owner to confirm**: ONE "customer message" email ~01:00 UTC whose link ends `&b=e8000000…`.
- Observation (not part of these checks): staging's weather job calls OpenWeatherMap with an invalid key (401, net requests
  31-34). Staging has no weather key; harmless noise, no action taken.
- Cleanup additions (staging only): business L2 e8000000…, W's L2 membership, W's `location_aware_sessions` row, follower
  9ce32ff2, message 222fea1d, outbox row 17; request f4dc22cd now `expired`; W's selected location left on L2 (switch-back
  call used the wrong parameter name; W's sessions are all revoked, so nothing is affected until W signs in again).

### Status after this run

- Done without phone sign-in: E1 (code), E2, E4 (server + link), E5, E6, E7, E8, E9, E10, E11 (website half), E12, E18
  (headless), E19, E20, E21, Test 6.
- Owner (inbox / Resend): confirm the E4 and E8 emails; E3 (Resend "Delivered" + SPF/DKIM headers); E22 (no customer data in
  the email source); E1 wrong + expired code (needs a new code read from the inbox; a new code un-verifies W's address until
  entered); E16 (needs the staging Resend key changed and then restored by the owner; my token can't write secrets and I don't
  hold the key).
- PENDING on phone sign-in / a staging phone build: real-browser sign-in + conversation journey, app half of E11, E13-E15.
- E23: after the custom-domain cutover.
- Not done: merge, production, website publish, Build 87, Auth/SMS changes.
