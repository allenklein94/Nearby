# Release inventory: deployment + recovery plan for everything that reaches production (2026-11-27)

Owner task 9 (2026-11-27). One row per thing that can change production. Guard: `scripts/migrations/releaseInventory.test.js`
fails if an edge function in `supabase/functions/` has no row here, or a pending migration has no packet row or rollback
(that half is in `releaseGates.test.js`). Nothing here is approved or deployed; each step keeps its own approval.

Read-only facts used (2026-11-27): production ledger at 20270347; 34 edge functions live (Management API list); production
secrets present (names only): ANTHROPIC_API_KEY, AWS_*, REVENUECAT_WEBHOOK_SECRET, REVIEW_LOGIN_PIN, SUPABASE_*. Absent:
RESEND_*, EMAIL_FROM, BUSINESS_WEB_URL, REVIEWER_EMAIL, any STRIPE_*, GOOGLE_WEB_RISK_*.

## 1. Database migrations (0348-0433)
Plan + recovery per migration: `MIGRATION_APPROVAL_PACKETS_0348-0433.md` (generated; approval code, prerequisite, checks,
rollback file + its limits). Every one has `scripts/rollback/<version>.rollback.sql`, proven in isolation back to 0347.
Enforced by `deploy.js` (production): number order, committed file = approval hash, compatibility evidence, client floor
from 0373 (live session read + distribution + website lines), verified + encrypted backup < 24 h, Privacy Policy sentence
published for migrations that start new processing (rule 8). Recovery beyond a rollback script = restore the same-day
verified backup (procedure: section 5).

## 2. Edge functions
Recovery for every redeploy: BEFORE deploying, save the live bundle (`supabase functions download <slug>` into
`/workspaces/.nearby-verify/backups/functions-<ts>/`, mode 700); rollback = deploy that saved copy. Functions whose repo
source is unchanged since their live version need nothing. "With" = deploy right after that migration, same approval
session, never before it (each tolerates the missing server piece, but the new behaviour needs it).

| Function | Live | Repo change since live | Deploy plan | Notes / recovery |
|---|---|---|---|---|
| admin-sponsored-refund | v3 | none | none | sponsored inert (no Stripe secret) |
| ai-concierge | v3 | none | none | no app build calls it; recommend disabling (privacy review 1b), separate approval |
| business-ai-assistant | v3 | 0426 location header | with 0426 (Batch 10) | |
| business-email | v3 | `_shared/email` | with send-push (Batch 10) | inert until Resend secrets |
| business-onboarding-assistant | v20 | none | none | |
| business-stripe-connect-onboarding | v4 | 0426/0427 | with 0427 (Batch 10) | Stripe test mode only |
| cancel-sponsored-placement | v3 | none | none | |
| create-assistant | v28 | none | none | |
| create-business-payment-intent | v5 | none | none | |
| create-sponsored-checkout | v4 | `_shared/contentClassifier` | with screen-business-content at 0372 | |
| delete-account | v9 | 0375, 0400, 0402, 0403, 0405 | HELD; after 0405 (Batch 8), never earlier: new code calls functions from 0375 + 0402 and carries 0405's rules | old live code works on every version (verified source recovery 2026-10-28) |
| export-data | v10 | none | none | |
| generate-courage-message, generate-icebreaker, generate-introduction, generate-strengths | v5/v8/v4/v7 | none | none | need Anthropic credit |
| get-online-status | v4 | none | none | |
| moderate-chat-image | v3 | none | none | no app build calls it; recommend disabling, separate approval |
| moderate-photo | v17 | 0349 binding, 0357/0368 fingerprints | right after 0349 (Batch 1, packet) | fingerprint RPCs skipped until 0357/0368 exist (PGRST202), so nothing stored before its Privacy sentence |
| moderate-text | v10 | none | none | |
| read-offer-creative | v3 | none | none | |
| rehearsal-chat | v6 | none | none | |
| report-presence | v13 | 0363 signals, 0384 crossed paths | with 0363 (Batch 3); again with 0384 if its code differs | |
| resweep-business-content | v4 | `_shared/contentClassifier` | with screen-business-content at 0372 | |
| revenuecat-webhook | v3 | none | none | |
| review-login | v7 | PIN cap, record-then-count | needs REVIEWER_EMAIL set first (owner); then its own approval | App Review account only |
| rewrite-offer-plain-language | v3 | `_shared/contentClassifier` | with screen-business-content at 0372 | |
| screen-business-content | v47 | 0372, 0387, 0399, 0415, 0420, 0426 | at 0372 from main (contains 0415+), per the offer-screening activation checklist section 9 | fails closed without Anthropic credit |
| screen-user-content | NOT LIVE | new | first deploy with 0373 (Batch 6); link checks need GOOGLE_WEB_RISK key before 0396 | rollback = delete the function (0373 rollback first) |
| send-push | v28 | 0421 receipts, 0424/0428 email link | with 0421; again with 0428 (Batch 10) | |
| setup-review-account | v9 | none | none | |
| sponsored-stripe-webhook, stripe-connect-webhook | v3 | none | none | |
| submit-business-application | v12 | 0419 service area | with 0419 (Batch 10) | retries without the label if sent first |
| translate-message | v6 | none | none | |

## 3. Client releases
| Release | Deploy plan | Recovery |
|---|---|---|
| iOS build 88 (production) | Owner: `eas build -p ios --profile production` -> TestFlight -> device checklist (`BUILD88_DEVICE_CHECKLIST_2026-11-26.md`) -> every device -> App Store Connect check (distribution line) | Build 87 stays in TestFlight until 88 passes; source kept as tag `build-87-ios` + `release/build-87`. Expire 88 in TestFlight to roll back; works on every DB version up to 0372 |
| iOS staging build (`APP_VARIANT=staging`) | Owner runs it (OWNER_STEPS step 11) | staging only; no production effect |
| Business website (`docs/business/`) | Re-export from build 88 source, publish = commit to main (GitHub Pages). Two publishes needed: the blank-dashboard fix (any time, own approval) and the build-88 export before 0373 (website line) | `git revert` the publish commit; previous export f4726d9f has the blank-dashboard bug |
| Privacy Policy / Terms (`docs/privacy.html`, `docs/terms.html`) | Part 1 patch after counsel; Part 2 sentences with their migrations, each marked `<!-- nearby-processing: <version> -->` (deploy.js checks published main) | `git revert`; a reverted sentence makes its migration's gate refuse again |
| Custom domain cutover (`post-tier1/custom-domain`) | Runbook `CUSTOM_DOMAIN_CUTOVER_2026-11-18.md` steps 2-5, each its own approval, after Tier 1 | runbook rollback: GitHub Pages keeps allenklein94.github.io; `business.` redirect is Cloudflare-side |

## 4. External services
| Service | Production state | Needed for | Owner action | Recovery / off switch |
|---|---|---|---|---|
| Supabase (DB, Auth, Storage, Functions) | live, Free plan, no PITR | everything | none | same-day verified backup (section 5); Storage files separately checksummed |
| Expo push + EAS | live (send-push v28) | notifications, builds | none | send-push redeploy of saved bundle |
| Apple (App Store Connect, TestFlight) | build 87 on TestFlight | releases | distribution check (OWNER_STEPS 3) | expire a build |
| Anthropic (production org) | key set, NO CREDIT (every AI function 500s) | offer screening (0372), public-text screening (0373+), AI features | fund it | fails closed: offers/public text wait, never published unscreened |
| Anthropic (separate staging org) | not created | staging screening tests | create + fund (new email) | n/a |
| Cloudflare (DNS, Turnstile, Email Routing) | live; Turnstile widget runs, Auth CAPTCHA OFF | sign-in bot check | none until device-tested | `captcha-settings.js` off |
| GitHub Pages | live (main:/docs) | website, policy pages | publish approvals | revert commit |
| Resend | staging only | business alert email | set production secrets (OWNER_STEPS 16) | unset secrets = push only |
| Twilio Verify (Auth SMS) | live (phone codes) | sign-in | upgrade before outside business owners | n/a (Auth setting) |
| Google Maps / Places / Geocoding | live (EAS key, restricted); discovery HELD | maps, address lookup | none | `places_search_budget` switches |
| Google Web Risk | no key | link checks (0396) | key before 0396 | a missing key = 'unavailable' for every link (`_shared/linkSafety.ts`), never 'safe' |
| Stripe | test mode, no production secret | payments | live approvals (blocked list in CLAUDE.md) | functions inert without secret |
| RevenueCat | live webhook | subscriptions | none | |
| AWS (moderation) | keys set | photo screening | none | moderate-photo fails closed |
| PostHog, Sentry | live | analytics, errors | none | |
| GIPHY | live, client-side | GIF search | Part 1 privacy sentence | |
| Brevo | named in the policy; no secret on functions | (Auth email, if configured there) | confirm with the Auth settings at Tier 1 | |
| Spotify | client OAuth, 0 connected accounts | dating music | server-side token handling before external users | |

## 5. Whole-database recovery
`FULL_READ=1 bash scripts/backup/prod-backup-via-login-role.sh` (temporary Supabase role, read-only sessions, deleted after)
-> restored into an isolated container + every table's row fingerprint compared (PASS record) -> `encrypt-backup.sh` ->
owner downloads it. A restore INTO production is a separate, owner-run decision (Supabase restore of a logical dump into a
fresh project, then repoint): never attempted from a session. Storage files: checksummed copy alongside (27 files on
2026-11-26).

## 6. Missing production secrets: what depends on each (audit 2026-11-27, code + read-only secret names)
| Secret(s) | Read by | Behaviour while missing | Migrations that depend | Before launch? |
|---|---|---|---|---|
| `RESEND_API_KEY` + `EMAIL_FROM` (+ optional `EMAIL_REPLY_TO`) | send-push (email fallback), business-email (`_shared/email`) | email skipped, `{sent:false, reason:'email_not_configured'}`; pushes unaffected | 0421 (one email for a dead push token) and 0428 (message alerts, exact-request link) are inert without them | MANDATORY before any business owner who uses only the website (no app = no push token = no alert at all). Not needed for build 88 testing on the owner's phone. |
| `BUSINESS_WEB_URL` | send-push (email link), business-stripe-connect-onboarding, create-sponsored-checkout | send-push: email without the "open in browser" link; Stripe functions fall back to `https://allenklein94.github.io/Nearby/business/` | 0428's exact-request link | Set with Resend. Change only at the custom-domain cutover. |
| `REVIEWER_EMAIL` | review-login, setup-review-account (repo versions only) | LIVE v7 / v9 have the address inline and work today; the repo versions refuse without it | none | Needed only BEFORE redeploying review-login (PIN cap) or setup-review-account. Safe to leave unset while they stay as deployed. |
| `GOOGLE_WEB_RISK_API_KEY` | screen-user-content (`_shared/linkSafety`) | every link = 'unavailable' -> the text with a link is refused (503 "couldn't check this right now"), never let through; text without links unaffected | 0396 (link safety), via 0373's screening | MANDATORY before 0396 if public text may contain links; otherwise every post with a link is refused with a misleading "try again". |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SPONSORED_WEBHOOK_SECRET`, `STRIPE_LIVE_APPROVED` | 6 payment / sponsored functions | payment functions refuse; acceptance still books (pay the business directly, idea "235"); sponsored inert | none | NOT needed for launch: payments + sponsored can stay off. Live needs the blocked-on-owner approvals (counsel, finance approver). |

## 7. Rollbacks vs data changes that a schema rollback can't undo (audit 2026-11-27)
Method: every statement outside function bodies in 0348-0433 that changes existing rows, drops data or moves it, plus the
jobs the migrations schedule. Production row counts read-only 2026-11-27: 0 live stories, 0 ID submissions, 0 offers
with a read receipt, 1 report.

| Kind | Migrations | Rollback handles it? |
|---|---|---|
| Rows rewritten, rollback maps them back | 0370 report reasons -> codes; 0398 (unsafe_situation -> 'other' + original reason in details) | YES (rollback updates them back; 0398's is lossy by design, wording kept in details) |
| Data moved to a new table | 0422 read receipts -> `business_offer_views` | YES (rollback copies `viewed_at` back) |
| New tables holding user data | 0416 offer evidence, 0423 contact details, 0424 memberships, 0355 report evidence, 0369 case history | Dropping them loses what accrued: 0416 + 0423 rollbacks REFUSE while rows exist (export + owner approval first). Others: export the table before rolling back (step below). |
| Rows ended / deleted at apply | 0389 + 0390 end live Business Moments / personal Stories (`expires_at = now()`); 0429 drops a 5-minute alert-window table | NO, not restorable by the rollback. Production has 0 live stories, so nothing is lost today; the window table is transient |
| Generated / derived column dropped | 0398 `review_priority` | nothing lost (recomputed) |
| Settings rows | 0358, 0365, 0380, 0386, 0412 thresholds; 0354/0390 bucket limits | YES (rollbacks restore the previous values) |
| Deletions done by scheduled jobs after deploy | 0363 (location jumps 1 h), 0369 (closed cases 12 months), 0374/0375/0376/0378 retention, 0391 report-file cleanup, 0400 ID images, 0402/0403 account deletion | NO: once a job has deleted something, no rollback brings it back. Only the same-day backup has it, and restoring it also reverts every user write since. |

Procedure added to every rollback (packets): (1) `select count(*)` of each table the migration created or wrote; (2) if
any row exists, export those tables into the backup folder (0600) and record the counts; (3) roll back only with the
owner's approval naming that export; (4) a job-deleted record is NOT recoverable by rollback: say so in the stop report.
