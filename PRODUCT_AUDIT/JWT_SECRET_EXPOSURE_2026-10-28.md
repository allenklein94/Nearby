# Legacy JWT secret exposure (2026-10-28): HS256 key REVOKED 2026-10-28 23:10:17 UTC; post-revocation watch until ~2026-10-29 23:17 UTC

The secret is never printed in this document, in commits or in chat.

## What happened

During the photo-storage review (session 6a535e54, 2026-10-28) a read-only Management API call
(`GET /v1/projects/enmosvippabmuqslzrox/postgrest`, used to read `db_schema`) returned the PostgREST config, which includes
`jwt_secret` = the project's LEGACY HS256 signing secret. The output was shown in that session.

## Where it is (checked 2026-10-28, by exact-value search without printing it)

| Place | Holds it? |
|---|---|
| `~/.claude/projects/-workspaces-Nearby/6a535e54-….jsonl` (the earlier session's local transcript, mode 600, this codespace only) | YES (one line, the tool result) |
| Every other file under `~/.claude`, `/workspaces/Nearby` (incl. working tree), `/tmp` | no |
| Git history (all refs, `git log -p -S`) | no |
| Docker container logs (replay / storage-api) | no |
| Repo docs, commits, PR text | no |
| The conversation sent to the model provider (Anthropic) as part of that session's context | YES, as conversation content (retention per the account's data settings) |

Not checkable from here: whether the codespace's disk is backed up/snapshotted by GitHub, and whether the transcript was
ever shared. The local scratch replay secret (`local-replay-jwt-secret-not-a-real-key-…`) is made up, not this one.

## What the secret can still do (project key state, metadata read 2026-10-28)

- JWT signing keys: `ES256` = **in_use** (signs every new session), legacy `HS256` = **previously_used**, i.e. still
  TRUSTED for verification. So a token forged with the exposed secret (any role, incl. `service_role`) is still accepted
  by the API until that key is revoked. Severity: HIGH while unrevoked.
- API keys: legacy `anon` + `service_role` (HS256 JWTs signed with this secret) still exist; new `publishable` + `secret`
  keys exist.

## Who depends on the legacy key today

| Caller | Uses | Impact of revoking the legacy key |
|---|---|---|
| App (build 86 and the new build), business web export | publishable key (`src/services/supabase.js`, since 2026-07-19) | none |
| User sessions | access tokens signed ES256; refresh tokens are not JWTs | none expected (any HS256 access token from before the ES256 switch expired long ago: 1 h lifetime) |
| Database -> edge functions (pg_net, push outbox) | vault `service_role_key` = an `sb_secret_…` key | none |
| Cron (26 jobs) | no key in any command | none |
| **Edge functions: 21 source files read `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`** (the injected LEGACY keys) | legacy JWTs | **break** (admin client calls refused) until moved to `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` (both already injected) |
| 28 of 34 functions with `verify_jwt = true` | verify the caller's token | must still accept ES256 user tokens + the new keys: confirm in a test call per function before step 4 |
| 13 live functions with NO repo source (CLAUDE.md, item 148 list) | unknown | cannot be audited from the repo: may break; owner decision |
| `.claude/mcp.json` Management API token (`sbp_…`) | not a JWT, unaffected | none |

## Status (2026-10-28, owner approved steps 1 + 2 with safeguards)

**Step 1 (redact local copies): PARTLY DONE.** `6a535e54-….jsonl`: 2 occurrences replaced with
`[REDACTED-legacy-jwt-secret-2026-10-28]`, every line still valid JSON, 0 left. A second transcript also held it
(`8d29f6a8-….jsonl`); redacting it was refused by the session's auto-mode safety check (transcript editing), so it is
left for the owner to run (script that never prints the value, given in the session). Copies already sent to the model
provider are unaffected either way.

**Step 2 (move functions off legacy keys): 18 of 21 DEPLOYED + VERIFIED; 3 HELD.**
- Pre-checks: runtime `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` = `{"default": <new key>}` (digest compared, parses
  as the helper expects, so the helper uses the new variable, not its fallback); the legacy-named variables also hold the new keys;
  neither legacy JWT key matches any function variable; no function reads a JWT secret. Live source of every function compared
  byte-exactly (source maps in the bundles) with git: for the 18, live = the commit before 582c727e, i.e. the deploy changes ONLY
  the key lines; their `_shared` imports equal live too.
- Deployed one at a time with the CLI (`--use-api`), live `verify_jwt` preserved per function (5 stay off), each followed by a
  harmless smoke call identical before/after (validation/permission refusals, no writes, no AI or Stripe call):
  admin-sponsored-refund v2, ai-concierge v2, business-ai-assistant v2, business-email v2, business-onboarding-assistant v19,
  business-stripe-connect-onboarding v3, cancel-sponsored-placement v2, create-business-payment-intent v4,
  create-sponsored-checkout v3, read-offer-creative v2, report-presence v12, resweep-business-content v3,
  rewrite-offer-plain-language v2, screen-business-content v46, send-push v27, sponsored-stripe-webhook v2,
  stripe-connect-webhook v2, submit-business-application v11. Afterwards every live source = commit 582c727e exactly.
- send-push: secret key accepted, token lookup ran (`skipped: no_token` for the dedicated test account, which has no device
  token, so nothing was delivered); a user token is still refused (401). User sessions are ES256.
  No real push has passed through the outbox since the deploy (none queued): the first real one is still to be watched.
- HELD (not deployed; their live versions read the legacy-NAMED variable, which already holds the new key, so they do not
  depend on the exposed secret): `delete-account` and `moderate-photo` (repo carries undeployed trust & safety / 0349 code:
  deploy with 0349), `create-assistant` (live uses an older `_shared/categoryTags.ts`; redeploying ships item 168's
  customer-only vocabulary change too: needs its own approval).
- The 13 recovered functions: not redeployed. `REVIEWER_EMAIL` is NOT set (secrets list 2026-10-28): set it before
  `review-login` / `setup-review-account` are ever redeployed.

## Status update (2026-10-28, later; owner authorization of the 8-point plan)

**Correction: the legacy API keys (anon / service_role) were ALREADY DISABLED on 2026-07-23 23:28 UTC** (Management API
`api-keys/legacy` = `{"enabled": false}`; the REST API refuses a legacy key with "disabled on 2026-07-23"). So step 3 was done
three months ago and nothing has depended on those keys since; no action was taken now and none is needed. The restoration
path (`PUT /v1/projects/{ref}/api-keys/legacy?enabled=true`, or Dashboard > API Keys) was deliberately NOT exercised: re-enabling
would put two JWTs signed with the exposed secret back into service. Disabling the keys does NOT close the exposure: a token
forged with the secret is still accepted as a Bearer token while HS256 stays `previously_used`. Only step 4 closes it.

**Step 1: no local copy remains.** Exact-value search (value held in memory only, never printed) over `~/.claude`, the repo
(working tree, excl. compressed git objects; history checked earlier) and `/tmp`: 0 files. Escaped forms and four 12-character
fragments: 0 hits in every transcript, incl. `8d29f6a8-….jsonl` (unchanged since 12:33 UTC). The earlier "second transcript
still holds it" is not confirmed by this search; nothing is left to redact, so no manual procedure is needed and no safety
restriction was worked around. Copies sent to the model provider are unaffected.

**Verification since the 18 deploys (2026-10-28 22:36-22:50 UTC):**
- Auth: password sign-in 200 (ES256), refresh 200 (ES256), get-user 200; REST as user 200; storage as user 200; signed-out REST 401.
- Push: outbox -> `send-push` v27 with the new secret key: HTTP 200 `{"ok":true,"skipped":"no_token"}` (dedicated test account, no
  device token; a real on-phone delivery after these deploys is still unobserved).
- Cron: every job in the last 2 h succeeded (19 jobs incl. `retry-push-outbox`, `delete-expired-stories`, resweeps), 0 failures.
- Database: no function signs JWTs or reads a JWT secret (only `private.location_pin`'s own HMAC, unrelated); no cron command
  carries a token; no `jwt` setting.
- Storage signed URLs are signed with Storage's own key (kid `faebca04…`), NOT the legacy secret (HMAC compared): revocation
  does not affect photo links.
- 24 h watch: started 22:36 UTC; re-check function errors, `push_outbox` failures, `net._http_response` non-2xx and cron
  failures at ~2026-10-29 22:40 UTC, plus one real push on the phone.

## Step 4 DONE: HS256 revoked (2026-10-28 23:10:17 UTC, owner approved after confirming a real push on the phone)

Pre-check: real push (outbox -> send-push v27 -> Expo, ticket + receipt `ok`) at 23:08 UTC; owner confirmed it on the phone.
Baseline right before (status codes only; token held in memory, anon role, 60 s life): a token forged with the exposed secret
was ACCEPTED (200), proving the exposure was real; the disabled legacy anon key was refused (401).

Revocation: Management API `PATCH /config/auth/signing-keys/a875b5ff…` `{"status":"revoked"}` -> 200; keys now ES256 `in_use`,
HS256 `revoked`. Irreversible.

Post-revocation checks (23:10-23:13 UTC; scripts printed status codes only):

| Check | Result |
|---|---|
| Forged HS256 anon token (same as baseline) | **401** (was 200): old key rejected |
| Disabled legacy anon key | 401 |
| Password sign-in / session refresh (dedicated test account) | 200 / 200, both ES256 |
| Get user | 200 |
| REST as user (publishable key) / with secret key / signed out / no key | 200 (3 rows) / 200 (3 rows) / 200 / 401 |
| Storage list (secret key) / sign / fetch signed photo URL / list as user | 200 / 200 / 200 / 200 |
| Function with the secret key (`send-push`) | reached the function (400 = its own body validation) |
| Function with a user ES256 token (`read-offer-creative`, verify_jwt on) | reached the function (400 "Missing partnerId"); signed out 401 |
| Real push through the outbox after revocation (23:11 UTC) | send-push 200, Expo ticket + receipt `ok`; on-phone arrival CONFIRMED by the owner with a 23:22 UTC re-test |
| Network bans (Management API `network-bans/retrieve`, 2026-10-28 23:25 UTC) | none (`banned_ipv4_addresses: []`) |

Not tested: Realtime websocket subscriptions (ES256 user tokens, same verification path as REST; watch the logs), the 13
recovered functions individually (none uses a JWT secret; their legacy-named variables hold the new keys).

Remaining exposure: none from this key: tokens signed with it are refused. The secret also remains in the model provider's
copy of the earlier conversation, now harmless. Post-revocation 24 h watch: review scheduled in-session 2026-10-29 23:17 UTC
(fires only if this session is open; otherwise ask for it): HS256 requests (any 2xx = escalate), 401 rates, cron, push outbox,
re-run of both check scripts.

**Interim check (2026-10-28 23:20 UTC, read-only, after a codespace restart lost the in-session schedule):** gateway logs
23:10:30-23:20: 15 requests, all this session's own post-revocation checks + one edge-runtime `auth/v1/user`, 0 HS256 user/API
tokens (the one HS256 string seen is Storage's own signed-URL signature, a separate key, 60 s expiry); cron 24 runs succeeded,
0 failed; `net._http_response` non-2xx since 23:10 = 0; the 23:08 + 23:11 test pushes: send-push 200, Expo `ok`. Outbox rows
stay `queued` after a 200 (all 5 rows in the table, incl. the 2026-10-20 one): pre-existing, not caused by the revocation, left as
is. Push after revocation CONFIRMED ON THE PHONE: a test push sent 23:22 UTC through the outbox (send-push 200, Expo `ok`) arrived
on the owner's iPhone (owner confirmed). End-of-watch review re-scheduled in-session for 2026-10-29 23:19 UTC (lost again on another restart: then ask for it). Lost on the 2026-10-28 ~23:45 UTC restart; re-armed 23:54 UTC for 2026-10-29 23:19 UTC (session-only again).

## Full incident review run early (2026-10-28 23:26-23:28 UTC, owner asked; read-only except one test push; 24 h watch continues)

| # | Check | Result |
|---|---|---|
| 1 | Old key rejected | signing keys ES256 `in_use`, HS256 `revoked`; an HS256 Bearer on REST = 401. A forged-with-the-real-secret test cannot be repeated (the value no longer exists here); the 23:10 test (200 -> 401) stands |
| 2 | Sign-in / refresh / get user / REST as user (dedicated test account) | 200 ES256 / 200 ES256 / 200 / 200 (3 rows); signed out after |
| 3 | Edge functions | send-push with the secret key reached its body validation (400); read-offer-creative as user 400 "Missing partnerId", signed out 401; function log errors since 23:10 = 0 (21 lines), function 5xx = 0 |
| 4 | Scheduled jobs since 23:10:17 | 35 succeeded, 0 failed |
| 5 | Background requests (`net._http_response`) since 23:10:17 | 2, 0 non-2xx/errors |
| 6 | Push | 23:28 UTC test through `_send_push`: send-push 200, Expo `ok`, arrival CONFIRMED on the owner's iPhone |
| 7 | Gateway logs since 23:10:17 | 26 requests, 0 5xx, 4 401 (all this session's / the previous session's refusal checks). Detector validated (finds ES256 on the 8 signed-in requests). 4 HS256 entries: 3 refused (401) checks + **1 accepted (200): 23:22:44 `POST /admin/v1/network-bans/retrieve`, user agent `@supabase-infra/mgmt-api`, role `supabase_admin`, token issued 2026-07-02, expires 2036** = Supabase's own Management API serving this session's network-bans read (same shape as the 2026-10-27 call). Not a client of this project and not evidence of misuse |

Held functions: `moderate-photo` (v17) as user = 404 "No primary photo found" (its DB lookup ran, so its key works), signed out 401;
`create-assistant` (v28) as user = 400 "Missing text", signed out 401; `delete-account` (v9) ACTIVE, deliberately not invoked
(a real call deletes the account). Transcripts: no file under `~/.claude/projects` contains a `jwt_secret` field; the
exact-value search cannot be repeated (no copy of the value left to search with), the earlier 0-hit result stands.

**OPEN (blocks closing):** the platform's `/admin/v1` route still accepted an HS256 `supabase_admin` token AFTER the HS256 key
was revoked. Unknown from here whether that token is signed with the exposed legacy secret (if so, a forged `supabase_admin`
token might still reach `/admin/v1/*`) or with a separate platform key. Question for Supabase support, not answerable by a
test without the secret. No production change made. Support ticket SENT by the owner via the support portal 2026-10-28, awaiting reply: `PRODUCT_AUDIT/SUPABASE_SUPPORT_TICKET_HS256_ADMIN_2026-10-28.md`.

## Exploitation check (2026-10-28 ~23:10 UTC; owner: escalate at once on any sign of use)

Source: API gateway logs (Management API `analytics/endpoints/logs`, ClickHouse table `logs`, `source = 'edge_logs'`, one
day per query; the gateway records each request's token algorithm + role, never the token). Oct 21 - Oct 28 (now): 7,670
requests, every authenticated one ES256 except exactly 4 HS256 requests:
- 2026-10-27 23:46:58: `supabase_admin` (apikey + authorization) on `/admin/v1/network-bans/retrieve`, 200. Before the
  exposure (2026-10-28) and a Supabase platform call (dashboard / CLI network-bans read), not a client of this project.
  It means the platform itself still signed an internal admin token with the legacy secret: after revocation, check that
  Dashboard > Database > Network bans still loads (added to the post-revocation checks).
- 2026-10-28 22:35:46-56: three requests with the disabled legacy anon / service_role keys on `/rest/v1/gatherings`, all
  401: the previous session's own confirmation that the legacy keys are refused.
The gateway query flagged ANY request whose Authorization token was not ES256 (any role, any apikey) plus ANY request with
a JWT as its apikey; the 4 above are all it found.

**Widened scan (all sources that record auth, Oct 21-28, same day-by-day method):**
- Function gateway logs (`function_edge_logs`, ~470 calls): non-ES256 tokens only 2, both 2026-10-28 22:35:47, legacy anon +
  service_role keys, 401 (the same refused checks).
- Privileged access (gateway + functions): every `service_role` / secret-key request came with an `sb_secret_` key (no JWT,
  ~180-310/day, the DB -> function and function -> DB traffic); privileged JWTs = only the supabase_admin platform call and the 2
  refused legacy service_role checks above.
- Storage logs: roles authenticated / anon / service_role only; service_role only on Oct 28 (4, the session's own checks via the
  secret key; no HS256 request reached storage per the gateway scan).
- Auth audit: every event maps to a known account: the owner's phone account (build 86: refresh/revoke, logout, a password
  recovery request + phone sign-in 2026-10-28 00:08), an unconfirmed phone sign-up started from build 86 (2026-10-27 23:45, before
  the exposure), and the dedicated test account (created 2026-10-27 23:48 via the Management API; logins from node / Python =
  this work). No admin user changes, no unknown account.

**Conclusion (worded as the owner set it):** no suspicious HS256 activity was identified in the logs examined, but
exploitation cannot be definitively ruled out. Limits: logs exist only for the API gateway, functions, storage, auth, realtime
and Postgres; direct DB connections need the DB password, not a JWT; retention bounds the look-back; a forged token used once
inside the window would show in these queries, but nothing can prove absence beyond the retained logs.

## Step 4 readiness (revoke HS256; IRREVERSIBLE; needs separate owner approval)

| Dependency | Finding | Risk at revocation |
|---|---|---|
| User sessions (23 rows, oldest 2026-07-15, 21 active in the last hour) | access tokens ES256, 1 h lifetime (`jwt_exp` 3600); refresh tokens are not JWTs | none expected: no HS256 access token can still be valid |
| App, web pages, business export | publishable key | none |
| DB -> functions, cron | new secret key / no key | none |
| Storage signed URLs | Storage's own key | none |
| Functions with `verify_jwt = true` | already accept ES256 user tokens (smoke calls) | none expected |
| Gateway handling of `sb_` keys | Supabase documents that new API keys keep working after revocation; NOT testable from here before revoking | low, untested: verify right after (REST with publishable + secret key, one function call, one push) |
| Legacy anon / service_role keys | disabled since 2026-07-23 | they become permanently unusable (intended) |
| Anything external holding an HS256 token | none known; no usage data exists | unknown, the only open item |

Procedure when approved: Dashboard > Settings > JWT Keys > HS256 (previously used) > Revoke. Then read the key status
(`revoked`) via the Management API, and run the checks above (sign-in, refresh, REST with publishable + secret key, storage,
one function, one real push, Dashboard > Database > Network bans loads). Rejection of the old key: the gateway logs must show
no HS256 request succeeding afterwards, and the disabled legacy anon key (an HS256 JWT) must still be refused (401).

**Earlier revocation (assessment 2026-10-28):** safer. The watch measures the 18 new-key deploys, not any HS256 dependency;
nothing but one Supabase platform call used HS256 in 8 days, and the remaining unknowns (gateway handling of `sb_` keys, that
platform call) can only be checked after revocation, so waiting buys no information while keeping the key trusted. Only
pre-revocation item left: one real push on the owner's phone. Waiting's one benefit: a failure in the 18 deploys can't be confused
with a revocation failure.

**End-of-watch review:** scheduled in-session for 2026-10-29 22:43 UTC (fires only if this session is still open; otherwise
ask for it). It repeats the checks above + this exploitation scan for Oct 28 22:36 onward, then asks for revocation approval.
No undo exists; a failure is fixed forward (there is no HS256 dependency to restore).

## Fallback removal (item 7): code done, NOT deployed

`_shared/supabaseKeys.ts` no longer falls back to `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` (missing/invalid new
variable = undefined); guard `edgeFunctionKeys.test.js` updated (61/61) + the 3 send-push suites that load the helper (80/80
together). Deployment plan (separate approval): redeploy the 18 functions one at a time, same method as step 2 (live
`verify_jwt` preserved, same harmless smoke call before/after, live source compared with git afterwards), send-push last
with an outbox check. The 3 held functions get it automatically when they ship (delete-account + moderate-photo with 0349;
create-assistant only on its own approval). The 13 recovered functions read the legacy-named variables directly and are
untouched by this change.

## REVIEWER_EMAIL (item 6)

Not set. Set only when `review-login` / `setup-review-account` are about to be redeployed, by the owner, without echoing it:
`! read -rs RE && npx supabase secrets set REVIEWER_EMAIL="$RE" --project-ref enmosvippabmuqslzrox; unset RE`
(the value then appears only as a digest in `supabase secrets list`).

## Step 3 inventory: who uses the legacy JWT-based API keys (anon / service_role) (2026-10-28)

| Dependency | Key it uses | Affected by disabling legacy keys? |
|---|---|---|
| App (build 86 + new build), docs pages (invite, business, shared-night), business web export | publishable key | no |
| User sign-in / sessions | ES256 access tokens | no |
| Database -> edge functions (`_push_outbox_deliver`, `delete_expired_stories`, `submit_business_content_resweeps`) | vault `service_role_key` = new secret key | no |
| Cron (26 jobs) | none (no http, no key in any command) | no |
| Database webhooks / auth hooks | none exist | no |
| 18 deployed functions | new-key variables via the helper | no |
| 3 held + 13 recovered functions | legacy-NAMED variables, which hold the new keys | no, unless disabling changes what Supabase injects into those names (not documented; watch) |
| Stripe webhooks / RevenueCat webhook | their own signing secrets; Stripe inert (no keys set) | no |
| Moderation (moderate-photo, moderate-text, moderate-chat-image), AI functions | as the function rows above | no |
| Repo scripts / journeys | Management API token (`sbp_…`), not a JWT | no |
| Anything outside this inventory holding a legacy key (old builds, third parties) | unknown; no "last used" data available | the only open risk; re-enable if anything fails |

No embedded legacy JWT found in the repo, the database functions or cron. Supabase gives no usage data for the legacy keys,
so the 24 h watch after disabling (function errors, push outbox, a phone sign-in) is the evidence, plus re-enable as the undo.

## Fallback recommendation

The helper's fallback to the legacy-named variables can be removed safely: the new variables exist and parse as expected
(verified above), so the 18 deployed functions already use them. Removing it makes a missing variable fail loudly instead of
silently reading another name. Recommended: remove it in code now, and ship it with the next deploy of those functions (or as
one more controlled redeploy), after step 3.

## Rotation procedure (each step needs owner approval)

1. **Contain the copy now (owner choice):** delete or redact that one line of the local transcript (exact-value replace,
   verified by a re-search). Reversible only before it is done. Doesn't affect anything already sent.
2. **Move edge functions off legacy keys:** in the 21 files, read the secret / publishable key from
   `SUPABASE_SECRET_KEYS` / `SUPABASE_PUBLISHABLE_KEYS` (one shared helper), redeploy each, test each function once.
   Decide the 13 source-less functions (recover + switch, or accept they may break).
3. **Disable the legacy API keys** (Dashboard > Settings > API Keys > disable JWT-based keys). Reversible (re-enable).
   Watch function logs + the push outbox for 24 h; re-enable at the first failure.
4. **Revoke the previously-used HS256 key** (Dashboard > JWT Signing Keys > revoke). IRREVERSIBLE: from then on no token
   signed with the exposed secret is accepted. Sessions: none should end (all current sessions are ES256); as a
   precaution expect a sign-in prompt for any device holding a session older than the ES256 switch.
5. **Verify:** a forged-token check needs the exposed secret; instead read the key status (`revoked`) via the
   Management API, then one real sign-in + push + a function call on the phone.

Until step 4 the exposure stays open. Steps 2-4 are independent of the 0348-0354 database deploys and the TestFlight
build (the app already uses the new keys), so they can run before external users without delaying either.

## Safeguard for future sessions

Never call `GET /v1/projects/{ref}/postgrest` (or any config endpoint) without filtering the output to the needed
field; never print `api-keys` without `reveal=false`; print metadata only.
