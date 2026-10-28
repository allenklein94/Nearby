# Supabase support ticket draft: HS256 admin request accepted after legacy key revocation (2026-10-28)

Status: DRAFT, not sent. Owner sends it (Dashboard > Support, or support@supabase.com). Contains no credentials, secrets,
tokens or user data.

---

**Subject:** Security question: HS256 `supabase_admin` request accepted on `/admin/v1` after revoking the legacy JWT signing key

**Project ref:** `enmosvippabmuqslzrox`
**Severity:** security question after a credential exposure (no evidence of misuse found)

**Summary**

On 2026-10-28 our project's legacy HS256 JWT secret was exposed in a development session: the response of a Management API
`GET /v1/projects/{ref}/postgrest` call included `jwt_secret`. We then:

1. Moved all edge functions to the new API keys (`sb_publishable_…` / `sb_secret_…`). Legacy API keys had already been
   disabled since 2026-07-23.
2. Revoked the legacy HS256 signing key at **2026-10-28 23:10:17 UTC**
   (`PATCH /v1/projects/{ref}/config/auth/signing-keys/a875b5ff…` with `{"status":"revoked"}`, response 200). Signing keys
   now read ES256 = `in_use`, HS256 = `revoked`.

Verification after revocation:
- An anon-role token we forged with the exposed secret went from **200 before revocation to 401 after** (`/rest/v1`).
- Password sign-in and refresh issue ES256 tokens; REST, Storage, edge functions and our cron jobs all work.
- Gateway logs since revocation show no HS256 token accepted on any client route.

**The request we need explained**

One HS256 request was **accepted after the revocation**:

| Field | Value |
|---|---|
| Time | 2026-10-28 23:22:44 UTC |
| Request | `POST /admin/v1/network-bans/retrieve` → **200** |
| User agent | `@supabase-infra/mgmt-api/v1.628.0` |
| Edge | colo IAD, cf-ray `a51daf2a2af6d64f-IAD` |
| apikey + Authorization JWT | algorithm HS256, role `supabase_admin`, issuer `supabase` |
| Token iat / exp | 1783025614 (2026-07-02 20:53:34 UTC) / 2098601614 (2036-07-02) |

This was your Management API serving our own `POST /v1/projects/{ref}/network-bans/retrieve` call (the ban list was empty).
An identical-shape request appears on 2026-10-27 23:46:58 UTC, before the exposure. We see no other HS256 request accepted
anywhere since revocation.

**Questions**

1. Is the HS256 `supabase_admin` token your Management API uses on `/admin/v1/*` signed with a **separate,
   Supabase-managed key**, or with our project's **legacy JWT secret** (the one we revoked)?
2. Can a token signed with our revoked legacy secret (any role, including `supabase_admin` or `service_role`) still
   authenticate to **any** endpoint of this project: `/admin/v1/*`, pg-meta, Realtime, Storage, Auth admin, edge
   functions, PostgREST, or anything else on the project domain?
3. Does PostgREST or any other project service still hold the legacy secret in its configuration (`jwt_secret` was still
   returned by `GET /v1/projects/{ref}/postgrest` before revocation)? If so, does revocation stop it from being used for
   verification, and should it be rotated or removed?
4. Is any further action needed on our side to make the exposed legacy secret **completely unusable**? For example,
   rotating the legacy JWT secret itself, or anything to do with the `supabase_admin` token's 2036 expiry.

We have made no further changes and are keeping the incident open until we hear back. Thank you.

---

Not included on purpose: the secret, any token or API key, the Management API token, user ids/emails, IP addresses.
