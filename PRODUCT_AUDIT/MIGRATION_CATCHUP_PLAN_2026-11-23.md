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
iPhone on build 86). UPDATE 2026-11-25: build 87 is built (2a28c8e8), on TestFlight, and on the one known device (see 8.3). The business website is no longer a
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

---

## 8. Owner decisions (2026-11-23) and progress

Approved: one consolidated deploy branch (preparation only); backup option B (logical dump + verified restore, isolated).
Held: the rolled-back test on production (locks); the isolated database is tested first.

### 8.1 Deploy branch: `deploy/catchup-0348-0432` (pushed, NOT merged, nothing deployed)
- Base `staging/onboarding-visit-2026-11-22` (= main/build 87 source + onboarding fixes + visit confirmation + every
  staged trust & safety, business-website and multi-location branch), + 0417 and its rollback (migration files only;
  0417's client stays on `post-tier1/dating-card-reasons`). 85 files 0348-0432, no gaps.
- + `scripts/backup/prod-logical-backup.sh` (option B).
- Batch 1 approval codes (sha256 of the committed files; 0348 = the code recorded 2026-10-29):
  - 20270348:12372a270d356266336f3163bf2f53afd84611dad4be1c8edfb610089585a515
  - 20270349:e14971c04fd70bc79c0e66fa77b07637a7fbead2e572dab921859c86649c11cf
  - 20270350:4cf8bff802c3a370244912ecb574c7ebdb9d41adcdee0a0d6a7fc910b8100802
  - 20270351:5ce0f0e8b742fcd41a0c874252e75c33c3c17ad31bb54f907c24b69912bc99aa
  - 20270352:fb95bbd49b30fa033ed23cd6525f4679d2849c3be16ed914161c6c2433109efe
  - 20270353:3035c5c0dbb59cf65861f655734edc586bf48786c3287d5220d5e2e1bdce0a8b
  - 20270354:39704832c7061377b8e19e331c77799827237b10027a4871ae4425f86f410c8f
  Listing a code here is NOT approval; each is used only after you approve that migration's deploy.

### 8.2 Backup (option B): script ready, needs one thing from you
`bash scripts/backup/prod-logical-backup.sh` (run from the deploy branch): read-only `pg_dump` of public, private, auth,
storage -> a 0600 file outside the repo -> restored into a container on an internal network with no route out (PG 17.6,
production's engine) -> every table's row count + row md5 compared source vs restored, schema diffed; any mismatch = FAIL.
SUPERSEDED 2026-11-27 (no longer needed: the temporary-role wrapper `prod-backup-via-login-role.sh` supplies the connection). Formerly: needs `.claude/prod-db-url` (gitignored), created by you, mode 600, holding production's connection string (Supabase
dashboard > Connect > Session pooler URI, with the database password). The script never prints it. The dump holds
personal data: it stays in `/workspaces/.nearby-verify/backups/` (mode 700), never committed. Storage FILES (photos) are
not in a database dump. Text check of the 85 files: none deletes storage objects directly; 0402/0403 only read them;
0400 starts the ID-document retention lifecycle (ID files deleted after their retention period; production held 0 ID
files on 2026-10-27: recheck before Batch 8). A Storage copy is a separate step if you want one.

### 8.3 Does 0348 really need build 87 on every device? (updated 2026-11-25)
**Build 87 status (owner, 2026-11-25; checked read-only):** EAS iOS build 87 FINISHED 2026-11-22 from 2a28c8e8 (the
approved source), submitted, current TestFlight build. Your iPhone's only live app session (phone-login account)
reported `Nearby/87` at its last token refresh, 2026-11-24 23:06 UTC (Auth updates the user agent on each refresh;
on 2026-10-29 the same session said `Nearby/86`). So the one known device is on 87.

**Yes: 0348 genuinely breaks build 86, and the break is hard, not cosmetic.** Build 86's start-up check
(`AuthContext.checkProfile`, 7d72d615) reads `display_name, birthdate, photo_url, is_admin` from its own `profiles`
row. 0348 revokes table-level SELECT and grants only the viewer-safe columns (no `birthdate`, no `is_admin`), so that
read fails (42501). Build 86 ignores the error, treats the person as "profile not complete" and sends them into
onboarding, whose sign-up upsert is also refused (journey `appVersionCompatibility`: `b86_own_profile_star` and
`b86_signup_upsert` = 42501 after 0348). Result: a build-86 user is stuck in onboarding, and Settings, Profile,
Dating and ViewProfile fail too. Build 87 reads its own row through `get_my_profile()` with a pre-0348 fallback.

Making 86 compatible isn't worth doing: column grants apply per role, not per row, so a build-86-safe grant would be
the leak itself. The only alternative (a row-masking view replacing `profiles`) is a large new unverified change.

**What "every user" means today:** 10 accounts (all yours), 2 signed in during the last 30 days, ONE live app
session (the iPhone, now on 87). The other two push-token rows (applereview, outlook) date from the 2026-10-27 token
move and have no live session. If they sign in again, it must be on build 87.

**The one remaining unknown, for you in App Store Connect:** is any version of Nearby live on the PUBLIC App Store
(or with external TestFlight testers)? If 1.0.0 (build 86 or older) is for sale, a stranger could download it after
0348 and get stuck in onboarding. Before 0348, one of: (a) no public version exists, (b) build 87 is released to the
App Store and the old version is replaced, or (c) the app is removed from sale until then. TestFlight-only = fine.

### 8.4 Build 88 dependencies
The deploy branch already carries the client side the post-87 migrations need: public-text screening calls
(`screen-user-content`, 0373), Dating Browse via `browse_dating_candidates` (0382), location-aware business sessions
(0424-0427), visit confirmation (0430), no host reputation / referral reward (0407), Trending yes/no (0409).
Not in it yet (each still on its own branch; you choose what joins build 88):
- `post-tier1/dating-card-reasons` + `browse-global-ranking` + `dating-appearance-ranking` (0417's client, Browse ranking)
- `release/website-option-a-src` (the website you just published: its source is NOT on main or the deploy branch, so a
  later export from either would undo Option A's pickers) **important**
- `post-tier1/business-web-only` (exact-request email link), `post-tier1/custom-domain`, `post-tier1/category-picker-collapsed`
- `post-tier1/offer-preview-compact` / `offer-preview-dock`, `fix/main-tabs-back`, `fix/native-back-prevent-remove`,
  `test/back-fix-staging`, `staging/environment-config`
- `post-tier1/popularity-established` (client half of 0409's Trending answer)
Build 88 = one integration branch from the deploy branch + the chosen ones, full Jest + exports + journeys, staging iPhone
build first, then production. It is built only after build 87 + Tier 1 (freeze).

### 8.5 Anthropic screening requirements (production)
- Production's `ANTHROPIC_API_KEY` org has no credit. Needed before 0373 (public text), and for hand-written offers
  (0372/0415), photo/chat-image moderation, "Read this for me", plain-language, create assistant, translations.
- Functions that call Anthropic: screen-business-content, screen-user-content (new), rewrite-offer-plain-language,
  read-offer-creative, moderate-chat-image, create-assistant, ai-concierge, business-ai-assistant,
  business-onboarding-assistant, translate-message, generate-* (4), rehearsal-chat. Model: claude-haiku-4-5-20251001.
- 0387 (screening outage alerts) opens an alert on the first credit failure, so a lapse is visible.
- Also outside Anthropic before 0396: a Google Web Risk API key (link safety).
- 0414's deploy gate needs a real two-business identical-image upload, so credit on STAGING too (your separate org).

### 8.6 Exact requirements to deploy 0348-0372 while build 87 is on TestFlight (2026-11-25)
Build 87 is compatible with 0348-0372 by design (Wall B starts at 0373). Before Batch 1, all of these, in order:

| # | Requirement | Status | Who |
|---|---|---|---|
| R1 | Build 87 installed on every device that runs Nearby | DONE for the one known device (UA `Nearby/87`); confirm no other phone/simulator has the app | you |
| R2 | No public App Store / external-tester install of build 86 or older (8.3) | UNKNOWN | you (App Store Connect) |
| R3 | Tier 1 passes on build 87 against production as it is (0347) | NOT RUN | you, on the iPhone |
| R4 | Build 87 compatibility test at 0372: a journey running build 87's EXACT queries (2a28c8e8: own profile via `get_my_profile`, sign-up insert/update, profile edit, push register/logout, Friends, Dating, ViewProfile, id_verified retry, report submit, gathering create) on a from-scratch replay at 0347 then 0348-0372. `appVersionCompatibility` today encodes build 86 + an October "new build"; it needs a build-87 block | NOT BUILT | me, isolated replay only |
| R5 | Fresh drift check: production schema == replay at 0347 (last 2026-10-29) | NOT RUN | me, read-only |
| R6 | Full-sequence test 0001-0432 on an isolated replay: all journeys + 6 concurrency scripts + every rollback round trip, from the deploy branch (head 38b074e5d) | NOT RUN (owner held the production rolled-back test; isolated first) | me |
| R7 | Verified backup (option B): dump + isolated restore + per-table md5 match, taken right before EACH batch | READY: no connection string needed (2026-11-27): `FULL_READ=1 bash scripts/backup/prod-backup-via-login-role.sh` (temporary Supabase role, read-only sessions, deleted after; verified 2026-11-26), then `encrypt-backup.sh`. deploy.js refuses without a verified + encrypted backup < 24 h | your go-ahead per run + the passphrase once |
| R8 | 0348 sequence (approved 2026-10-29): you sign in on the website (Coastal Coffee) + open the five tabs + save a profile change BEFORE 0348; right after 0348 the `get_my_profile()` check (own / cross-user / signed out + catalog); then you repeat the website pass. Any failure = stop | READY | both |
| R9 | Edge functions in step: `moderate-photo` redeploy right after 0349 (`delete-account` stays held), `report-presence` after 0363, `screen-business-content` at 0372 from the 0415 branch or later | READY in the deploy branch | me, each with your approval |
| R10 | Privacy Policy sentences for 0355 + 0357 published with them | DRAFTED, not published | you approve |
| R11 | Per-migration approval code (sha256) for each of the 25, issued after R1-R7 pass | Batch 1 codes listed in 8.1; 0355-0372 to list | you |
| R12 | Post-deploy real-API checks with the dedicated test account: profile privacy (N6), suspension incl. the old-token case, rate limits (0358/0362), 0364 server-only grants plan | WRITTEN, run after each batch | me |

Known effects you will see on build 87 after Batches 1-5 (by design, not defects): the outlook business account has no
verified phone, so after 0352 it can do business things only (no social actions); new gatherings limited to 5 per
24 h (0362); the sign-up hook (0367) and photo detection (0368) install OFF; hand-written offers still fail without
Anthropic credit (as today).

Clearing 0348-0372 does not need build 88. 0373 onward does (8.4, 8.5).

### 8.7 Isolated testing plan (no production writes)
1. R5 drift check (read-only catalog dump of production vs replay at 0347).
2. Replay 0001-0347 -> apply 0348-0372 one by one from the deploy branch -> R4's build-87 compatibility journey +
   all journeys + concurrency -> roll back 0372 -> 0348 newest first -> schema == 0347 replay -> re-apply identical.
3. Continue 0373-0432 on the same replay (R6) so the later batches are proven too, without deploying them.
4. Logs to `/workspaces/.nearby-verify/catchup/`; commit before each long run (codespace restarts every ~20 min).
5. Only then: R7 backup, then your approval of Batch 1.

### 8.8 Isolated testing results (2026-11-25, local only, nothing deployed)
Full record: `PRODUCT_AUDIT/MIGRATION_CATCHUP_ISOLATED_TEST_PROGRESS_2026-11-25.md` on `deploy/catchup-0348-0432` (7c43fa135).
- R4 DONE: build 87 journey 12/12 at 0372, 6/6 at 0432; build 87 + published website call check 324/324 at both.
- R5 DONE: no functional drift (prod CRLF line endings, one redundant column grant, extension schemas).
- R6 DONE: 85/85 apply; all journeys pass (incl. the new build87Compatibility at its fixed commit); 31/31 concurrency;
  rollback 0432 -> 0348 = 0347 behaviour (ACL order + whitespace only); re-apply identical; Jest 604/604 suites.
- R7 script FIXED (3 bugs found by the dry run) and dry-run PASS (306 tables identical); still needs `.claude/prod-db-url`.
- R9 READY: live versions + rollback references recorded; all three functions type-check.
- R11: codes for 0355-0372 computed (`/workspaces/.nearby-verify/catchup/codes-0348-0372.txt`); listing is not approval.
- Pre-existing bug found (on prod today, not migration-related): Friends discovery can't read `friend_discovery_swipes`.

### 8.9 Preparation finished (2026-11-25, nothing deployed, nothing merged into main)
- Batch 1 approval packet (codes, deploy + verification + rollback per migration, `moderate-photo` redeploy, the exact
  Tier 1 list, Phase 1 Privacy Policy wording): `PRODUCT_AUDIT/BATCH1_APPROVAL_PACKET_2026-11-25.md` on
  `deploy/catchup-0348-0432` (28c5d34be).
- Backup credential: `scripts/backup/set-prod-db-url.py` on the deploy branch (hidden input, file 0600 from the first byte,
  refuses to overwrite, prints checks only). Checked here: a 0600 create really stays 0600 under this workspace's ACLs, and
  `.claude/prod-db-url` is gitignored. The owner runs it in their own terminal (not `!`, so nothing can echo into the chat).
- Friends swipe-history fix: 20270433 on `fix/friend-swipe-history` (525e2afe3), server only, build 87 benefits with no
  new build; sha256 2c858e95a804873a957b281eb529f1006463b9b724ff57e3741180d67bfdcb41. Number order puts it after 0432
  unless the owner asks for it to be renumbered into Phase 1.
- Build 88 integration: `integ/build-88` (97d50372e) = deploy branch + `release/website-option-a-src`. Every line Option A
  added is present (diffed line by line); Jest 604/604 suites, 8139 tests; web + iOS exports clean (2026-11-25).
- 0373 vs build 87, reconciled: the "passes at 0432" results were (a) the call check, which proves only that each RPC
  exists with the arguments sent, and (b) `build87Compatibility`, which at 0432 PASSES BY ASSERTING THE REFUSAL (42501,
  hint `screening_required`). End to end at 0373+, build 87 can't save text on profiles (so new sign-ups get stuck),
  gatherings, communities, gathering/community chat, gathering questions, photo comments, social invites, business
  requests or partnership requests, and it has no handling for `screening_required` (it shows a generic error). Wall B
  stands: 0373 onward only after build 88 is on every device + Anthropic credit.
- Also fixed: `.claude/live-test-account.json` and `.claude/mcp.json` were mode 666; now 600.
