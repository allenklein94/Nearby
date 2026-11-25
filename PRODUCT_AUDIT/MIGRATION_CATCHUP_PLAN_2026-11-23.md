# Production migration catch-up: audit + proposed batches (2026-11-23)

Read-only audit. Nothing deployed, merged, published or written. Build 87 unchanged.

## 1. Fresh facts (checked 2026-11-23)

| What | Result | Source |
|---|---|---|
| Production ledger | 5 rows; latest = **20270347** (pre-ledger baseline + 0344 historical + 0345-0347 deployed) | `migration:status --target=prod` |
| Pending for production | **85** migrations, **20270348-20270432**, no number gaps | every remote branch's `supabase/migrations/` (83 branches) |
| Same file, different content on two branches | **none** (each file has one blob everywhere) | blob hashes per branch |
| On `main` | 22 of them (0348-0369) | `main` |
| Staging ledger (`nearby-staging`) | 88 rows; applied through **0432**, all in order, **except 0417** (84 of the 85) | `status.js --target=staging` from `post-tier1/visit-confirmation` |
| 0417 (Dating tattoo/piercing preferences) | only on `post-tier1/browse-global-ranking` + `post-tier1/dating-card-reasons`; owner reversed the same-day decline and ACCEPTED it as staged (2026-11-14; main's CLAUDE.md still says "declined for now", stale) | those branches' CLAUDE.md |
| Production backups | **0 restorable backups, PITR off** (Free plan; WAL archiving on) | `GET /v1/projects/.../database/backups` |
| Production database | ACTIVE_HEALTHY, Postgres 17.6 | Management API |

The earlier "84 pending" = the 84 that staging has. The true production backlog is 85 (0417 too). "347 applied" was the
latest migration NUMBER, not a count of applied migrations.

## 2. Can everything deploy now? No. None can deploy today.

The ledger and `deploy.js` enforce strict number order: a held migration holds every later one. Two hard walls:

**Wall A (blocks all 85):** 0348 breaks build 86 (it reads its own profile with `select('*')`, refused after 0348; fails
closed). Build 87 must be built, processed by Apple and installed on EVERY device first (inventory 2026-10-29: one
iPhone on build 86). Build 87 has not been started (last check 2026-11-21). The business website is no longer a
blocker: the live site (published today) already carries the pre/post-0348 profile reads.

**Wall B (blocks 0373-0432):** 0373 refuses public text writes (gathering titles, bios, etc.) that weren't screened
through the new `screen-user-content` edge function. Build 87 doesn't call it, and screening needs **Anthropic credit**
(none today). Deploying 0373 before both = nobody on build 87 can post public text. So 0373 onward needs a **build 88**
carrying the post-87 client work, installed everywhere, plus credit.

Also before any batch: **a verified backup** (none exists).

## 3. Preconditions (before Batch 1)

1. **Backup + verified restore.** Choose one (owner):
   - (a) Supabase Pro plan: daily backups (and optional PITR add-on). Simplest; costs money.
   - (b) Logical dump: `pg_dump` of production with the database connection string (the owner supplies the DB password
     through a local env var, never in chat), restored into an isolated local Postgres, then compared to production
     (schema + row counts + per-table checksums). Free; also give the restore check a time limit.
   Either way: a backup taken right before EACH batch, restore proven at least once. A down migration is not a recovery
   plan for data-changing steps (0375, 0393, 0400, 0402-0406 move or delete records).
2. **Build 87** from 2a28c8e8 (or later commits touching only docs): built, Apple-processed, installed on every device;
   Tier 1 passes.
3. **One deploy branch** holding all 85 committed files in order (incl. 0417). `deploy.js` only deploys files committed
   at HEAD of the checkout it runs from, and refuses 0417 forever once 0418 is recorded. Creating it = a merge (needs
   your approval; not done).
4. **Fresh drift check:** production schema == a from-scratch replay at 0347 (last done 2026-10-29, 24,635 items).
5. **Full-sequence test on a production-like database:** from-scratch replay 0001-0432 incl. 0417 + all journeys + the
   concurrency scripts + rollback round trips; then the whole sequence applied to PRODUCTION inside one rolled-back
   transaction with per-table row fingerprints before/after (the method used for 0348-0369; nothing persists, but it
   touches production, so it needs your OK). Staging (0348-0432 minus 0417, real Auth/Storage) stays the hosted rehearsal.

## 4. Proposed batches (number order is forced; each migration still needs its own approval code)

Every batch: backup -> `deploy.js --check` per file -> deploy one by one -> its post-deploy checks -> stop on the first
failure (no automatic rollback; you decide).

### After Wall A (build 87 everywhere + Tier 1 + backup)

| Batch | Migrations | Also needed | Checks / notes |
|---|---|---|---|
| 1 | 0348-0354 profile privacy, no self-granted verification, ID verified, suspension, verified phone for social, crossed-paths push consent, ID upload limits | `moderate-photo` redeploy right after 0349; `delete-account` held with 0349; approved 0348 sequence (you sign in on the website before 0348, then `get_my_profile()` check, then repeat the website pass) | Business owner (outlook) has no verified phone: business side only after 0352. Suspension real-API test incl. existing-session case. |
| 2 | 0355-0362 report evidence, rate limits, duplicate-account signals, thresholds, trusted-write fixes (0359-0361 deploy together right after 0358), gathering creation limits | Privacy Policy sentences for 0355/0357 published with them | Real-API limit checks (post-deploy plan). |
| 3 | 0363-0366 behaviour signals, server-only grants, thresholds, intention-count privacy | `report-presence` redeploy (location jumps) | 0364 gated post-deploy plan. |
| 4 | 0367-0369 phone-only sign-up hook (installed, OFF), near-duplicate photos (detection OFF), review case history | Auth hook switch = separate approval later | New phone sign-up test is a separate controlled test. |
| 5 | 0370-0372 report reason codes, Verified Business, offer safety | `screen-business-content` deploy at 0372 (code from the 0415 branch or later, per the activation checklist section 9) | Build 87 compatible (0370 maps its English reasons; 0372 binds the edge function's own writes). Hand-written offers still need Anthropic credit (as today); automatic replies unaffected. |

### After Wall B (build 88 everywhere + Anthropic credit + website re-export)

| Batch | Migrations | Also needed / gate |
|---|---|---|
| 6 | 0373-0381 public-text screening, suspended-number retention, account-takeover protection, shared device/text signals, friend-request burst, review links, photo detection on, impersonation + business reports | new `screen-user-content` function; 0375's deletion step-up switch stays OFF; 0380 after the `moderate-photo` redeploy + one `sweep`; 0375 account-recovery gates resolved |
| 7 | 0382-0398 anti-scraping, crossed-paths consent + safeguards, gathering review signals, outage alerts, video offers + business moments paused, stories security, media/gathering/community reports, admin content removal, gated perk, legal holds, link safety, report feedback, unsafe report reason | 0382 needs build 88's Dating Browse (rollout like 0348); 0388 live before any outside business is onboarded; 0396 needs the Web Risk key + `screen-user-content` redeploy + Privacy Policy sentence |
| 8 | 0399-0406 admin restrictions, ID document retention, admin facts, held evidence, deletion hardening, case link count, deletion blockers, deleted-account records | `delete-account` redeployed right after 0402 (never before) |
| 9 | 0407-0417 fake-credibility removals, private gathering ratings, Trending needs established attendees, familiar hosts, blocked attendees, host cancellations, shared links (OFF), business duplicate warnings, business note screening, offer evidence, Dating tattoo/piercing | 0407/0409/0410 need build 88's client side; 0408 = blocker before external users (ratings readable today); 0413 detector stays off until its Privacy Policy sentence; 0414's `deploy.js` evidence gate (staging pass + real two-business upload, needs credit); 0415 then `screen-business-content` redeploy; 0416's full rollback round trip still owed; 0417 joins the deploy branch |
| 10 | 0418-0429 business website + multiple locations: claim needs profile, service area, offer screening retry, push token invalidation, offer view privacy, contact details, memberships, selection guard, location-aware client, message alerts + mute window | 0422 only after build 88 replaces 87 AND the website is re-exported from that branch; 0427 edge-function changes (`business-stripe-connect-onboarding`); website re-export + publish approval (= Option B) |
| 11 | 0430-0432 business visit confirmation | new app + website first (builds <= 87 show the wrong state); native review of the strings |

## 5. Held, with reasons (nothing unexplained)

- **All 85 today:** no Build 87 on devices (0348) + no verified backup.
- **0373-0432 after Batch 5:** need build 88 + Anthropic credit + website re-export (0373, 0382, 0407, 0409, 0422, 0430 each
  break or mislead build 87; number order holds the rest).
- **Inside batches:** switches stay OFF after deploy (0367 hook, 0368/0380 detection, 0375 D2, 0388/0389 pauses, 0413
  detector), each with its own later approval.
- **Launch gates that migrations don't close:** Twilio upgrade (trial) before real business owners; Resend secrets on
  production; native review of machine-authored strings.

## 6. Proof production is caught up

1. `migration:status --target=prod` shows every repo file 0348-0432 as recorded (deployed), and repo == ledger.
2. Production schema == a from-scratch replay at 0432 (functions, policies, views, grants, column grants, triggers,
   constraints, buckets), except documented ordering-only differences.
3. Row counts and fingerprints of pre-existing rows unchanged except the documented data steps.
4. Prod journeys with no prelude: all pass (incl. the trust & safety suites that need 0348-0361 today).
5. Every redeployed edge function's live version = the deploy branch's source.
6. Real-API signed-in checks (dedicated test account): profile privacy, suspension incl. old tokens, limits, sign-up hook.
7. Phone + website: Tier 1 items + the live website five-tab pass after the last batch.

## 7. Recommendation

Don't deploy anything now. Do now (no production change): pick the backup method, start Build 87, and let me prepare
the deploy branch and the full-sequence test (precondition 5) once you approve those two steps. Batches 1-5 can run
right after Build 87 + Tier 1. Batches 6-11 wait for build 88 and Anthropic credit. That's the earliest point of
"zero pending".
