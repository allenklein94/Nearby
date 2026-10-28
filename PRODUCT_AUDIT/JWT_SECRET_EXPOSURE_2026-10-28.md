# Legacy JWT secret exposure (2026-10-28): review + rotation procedure (NOT rotated; owner approval required)

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
