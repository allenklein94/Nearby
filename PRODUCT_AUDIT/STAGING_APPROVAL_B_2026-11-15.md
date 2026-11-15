# Approval B: staging app + deployment target (2026-11-15)

Status: BUILT on branch `staging/environment-config` (from main 990fe5f9), NOT merged, nothing deployed, built, published or
submitted. Production and build 87's source commit are untouched (main unchanged). Plan: `STAGING_PROJECT_PLAN_2026-11-15.md`.

## What a build talks to (one source: `src/config/environments.js`)

| | Production (no APP_VARIANT) | Staging (`APP_VARIANT=staging`, EAS profile `staging`) |
|---|---|---|
| App | "Nearby", `com.allenklein.nearby`, scheme `nearby` | "Nearby Staging", `com.allenklein.nearby.staging`, scheme `nearby-staging` (installs beside the real app) |
| Expo project (push tokens) | bcd5120e-... | its own, from `NEARBY_STAGING_EAS_PROJECT_ID` (must differ) |
| Supabase | enmosvippabmuqslzrox | from `NEARBY_STAGING_SUPABASE_URL` + `NEARBY_STAGING_PUBLISHABLE_KEY` |
| Analytics, Sentry, in-app purchases | on | off |
| Stripe publishable key | app.json (empty today) | none, or `pk_test_` only |
| Turnstile, Spotify | app.json | removed (production hostname / scheme) |
| Store submit | `submit.production` | no submit profile exists |

Fail closed, never a fallback:
- **Build time** (`app.config.js`): a production build with ANY staging variable set stops; a staging build missing any value,
  or with production's URL/ref, key or Expo project, or a live Stripe key, stops; an unknown APP_VARIANT stops.
- **Run time** (`src/services/supabase.js`): the embedded environment must be exactly production's or a staging set sharing
  nothing with production. Otherwise no Supabase client is created, every use throws, and `App.js` / `App.web.js` show
  "This build of Nearby can't start" before notification handling or any screen mounts.
- `LoginScreen`'s reviewer call used production's key directly; it now uses the build's own key (`PUBLISHABLE_KEY`).

## Staging database + functions (`--target=staging`)

- Ref only from `NEARBY_STAGING_REF` or the gitignored `.claude/staging.json` (`scripts/lib/stagingTarget.js`); production's
  ref refused in any form. Token only from `NEARBY_STAGING_ACCESS_TOKEN`, refused if equal to `SUPABASE_ACCESS_TOKEN`.
- `--target=prod` now refuses if any staging setting is set, and always uses production's ref (never `SUPABASE_PROJECT_REF`).
- Approvals: production `NEARBY_PROD_APPROVAL=<version>:<sha>`, staging `NEARBY_STAGING_APPROVAL=staging:<version>:<sha>`;
  each refused for the other and refused while the other variable is set. Each database keeps its own `private.migration_ledger`.
- 132 migrations call production's edge functions by URL (send-push, resweep-business-content). A staging deploy re-points
  every function + cron job to staging INSIDE the same transaction; `bootstrap.js` does it inside EVERY migration's
  transaction, so no committed staging state ever calls production.
- `scripts/staging/functions-deploy.sh`: always `--project-ref`, refuses production (the CLI link points at production).
- `scripts/staging/preflight.js` (read-only): refuses SMS provider credentials, phone sign-in without test OTP numbers, custom
  SMTP, Resend / Twilio / Expo / AWS / RevenueCat secrets, unconfirmed Stripe secrets, any function/cron naming production, a
  vault key for production. Run before every seed or test.

Why staging can't reach real people: it holds no production data (synthetic seed only); push tokens can only come from staging
installs (separate bundle id + Expo project, and a production build can't talk to staging); no email or SMS provider; no
live Stripe or RevenueCat; Auth phone sign-in by fixed test OTP numbers only.

## Tests (2026-11-15, logs /workspaces/.nearby-verify/v432)

- `src/config/environments.test.js` 42 + `scripts/staging/stagingSafety.test.js` 44: both environments, 11 build-time and
  9 run-time cross-environment mismatches, no client on a mixed environment, EAS profiles, no other production reference in
  the app, the published website carries no staging value; runners, approvals, re-point placement, bootstrap, preflight,
  functions script. Mutation checks: 6 safeguards removed one at a time, each fails its test; restored = all pass.
- `npx expo config`: production = app.json + production environment; staging = separate app; staging pointed at production
  and production with a staging value both refused by Expo.
- iOS export (production) clean; web export (staging, placeholder values) clean; that staging bundle dropped into
  `docs/business` fails the website guard (removed after).
- Full Jest (clean rerun): 535/535 suites, 7316 passed, 11 todo.
- Not tested: a real EAS staging build, the app on a phone, any call to the staging project (no staging token exists yet).

## Owner steps after approving B (none needs a session)

1. Create the Expo project `nearby-staging` (expo.dev, same account); note its project ID.
2. Create a separate Supabase access token for staging use (`NEARBY_STAGING_ACCESS_TOKEN`); never the production one.
3. In the staging Expo project's `preview` environment set `NEARBY_STAGING_SUPABASE_URL`, `NEARBY_STAGING_PUBLISHABLE_KEY`,
   `NEARBY_STAGING_EAS_PROJECT_ID` (and export the same three locally: `eas build` evaluates app.config.js on your machine).
4. Later approvals unchanged: C (bootstrap + functions), D (secrets), E (`eas build --profile staging -p ios`), F (seed + lifecycle).
