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

## Rotation procedure (each step needs owner approval; nothing done yet)

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
