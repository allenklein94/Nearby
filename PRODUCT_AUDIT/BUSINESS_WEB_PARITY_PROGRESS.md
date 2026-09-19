# Business Web parity — progress (started 2026-09-19)

Requirement: an owner can run Nearby from the website without being sent to the app for core operations.
Approved scope: (1) gatherings + communities on web, (2) QR scanner on web w/ fallback, (3) Stripe payout onboarding on web
(TEST MODE ONLY; live steps are hard gates, see CLAUDE.md), (4) email fallback for notifications (needs Resend secrets from user).
Also: audit every remaining "Open the Nearby app to..." on web.

| # | Item | Status |
|---|------|--------|
| 0 | Audit of "Open the Nearby app" strings | done: none remain in dashboard |
| 1 | Stripe onboarding on web (test-mode only; server hard gate on live keys; functions deployed) | done, untested with a real Stripe test key (none configured) |
| 2 | QR scanner — CORRECTION: no QR scanner exists in the app; the web-hidden camera item was "Post a Moment", now works on web (file/camera picker) | done (untested in browser) |
| 3 | Gatherings + communities on web (screens registered, web location picker, PostHog stub) | done, bundles; not browser-tested |
| 4 | Email fallback / Resend | not started |
