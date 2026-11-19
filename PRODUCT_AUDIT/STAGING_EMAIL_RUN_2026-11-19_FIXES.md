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
