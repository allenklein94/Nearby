# Staging phone sign-in by Auth test OTP (2026-11-21)

Owner approved 2026-11-21: staging only (`nearby-staging`, ref hxsioiiulubavhogzipo), one synthetic number, a temporary
code, 7-day expiry, no SMS provider credentials, no money, production untouched.

## What was changed (staging Auth settings only)
- `external_phone_enabled`: false -> true
- `sms_test_otp`: one entry, +1 561 555 0177 (reserved fictional 555-01xx; staging already used 0110/0112/0113/0115)
- `sms_test_otp_valid_until`: 2026-11-28 15:23:54 UTC
- No SMS credentials added. Side effect of the save: `sms_provider` changed from `twilio` (empty credentials) to null.
- Saved through the Management API with HTTP 200 (Supabase did not require SMS credentials).

The code is never in Git, logs or chat: it is in `/workspaces/.nearby-verify/staging-test-otp.json` (mode 0600, outside
the repo). The pre-change values are in `/workspaces/.nearby-verify/staging-auth-before.json`.

## Why it sends nothing
Auth v2.197.0 source: `internal/api/phone.go` uses the test code for a listed number and never looks up the SMS provider;
`internal/api/verify.go` checks the test code before Twilio Verify. Any other number fails ("Unable to get SMS provider"),
nothing is sent or charged.

## Verified (2026-11-21, staging real Auth API, publishable key)
- Request code for +15615550177: 200
- Verify with the test code: 200, session issued, `phone_confirmed_at` set; staging user `00000654-819d-42f3-972c-4c5480dce81c`
  created (no profile yet; kept for the A1-A12 run, onboarding happens in the staging app)
- Verify with a wrong code: 403

Not verified by this: real SMS delivery (production's separate Tier 1 check), the staging iPhone build (not built yet).
Note: `sms_otp_exp` is 60 s; if the app reports an expired code, request a new one and enter it promptly.

## Rollback (staging only)
PATCH `https://api.supabase.com/v1/projects/hxsioiiulubavhogzipo/config/auth` with
`{"external_phone_enabled": false, "sms_test_otp": "", "sms_test_otp_valid_until": null, "sms_provider": "twilio"}`,
then read the config back and confirm phone off and no test entry. Optional: delete the staging user above
(staging admin API). The entry also stops working by itself after 2026-11-28 15:23 UTC.
