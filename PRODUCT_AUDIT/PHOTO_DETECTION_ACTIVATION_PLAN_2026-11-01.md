# Duplicate-photo detection: activation plan (2026-11-01)

Owner (2026-11-01): "I want duplicate-photo detection activated before public launch, not deferred indefinitely. Prepare
the activation work now on a separate staged branch ... Do not deploy or enable anything in production yet."

Status: **activation work BUILT + TESTED locally, STAGED on `post-tier1/photo-detection-activation`** (stacked on
`post-tier1/shared-case-links`, so it carries 0377-0379 underneath), **NOT merged, NOT deployed, nothing enabled**. Build 87
unchanged (server + scripts only). Production is still on 0347: none of the photo detection exists there yet.

## Two kinds of detection, two switches

| Kind | Rule (unchanged, owner-approved) | Turned on by | Today |
|---|---|---|---|
| Exact copies (0357) | the same file (SHA-256) in use on >= 3 accounts, or on 2+ accounts whose names are >= 0.5 similar | **0358** (thresholds migration; sets 3 / 0.5) | staged |
| Near-duplicates (0368) | resized / re-saved / filtered / mirrored / centrally trimmed copies, BOTH dHash <= 10 AND pHash <= 10, then the SAME account rules as exact copies | **0380** (this work; sets 10 / 10) | staged, off |

Either kind only opens ONE private admin review case per photo cluster (0369: a closed case never reopens by itself, new
accounts are recorded as new evidence; an admin decides). Nothing bans, suspends, hides, restricts, scores or notifies
anyone. No new data: the hashes are what `moderate-photo` already records (it records them while detection is off too).

## What was built (this branch)

- `supabase/migrations/20270380_photo_detection_activation.sql`: refuses unless 0357 / 0368 / 0369 are installed AND the
  exact-copy rules are exactly 3 / 0.5; sets near-duplicate distances to 10 / 10; adds
  `private.evaluate_existing_photo_signals()` (no client role, not service_role; idempotent; counts only) and runs it once,
  so photos fingerprinted before activation are judged the same way as new ones.
- `scripts/rollback/20270380_photo_detection_activation.rollback.sql`: near-duplicates off + drops the function; cases
  already opened are KEPT (audit trail; they never restricted anyone).
- `scripts/trust-safety/photo-detection-switch.js` (owner approval per run):
  - `status --target=prod`: read-only (numbers, counts of fingerprinted / hashed photos and cases; never ids or hashes),
    prints the `on` codes.
  - `off [--all]` with `NEARBY_PHOTO_DETECTION_APPROVAL=photo-detection-off`: **instant disable**. Near-duplicates only;
    `--all` also stops exact copies. Open cases stay for review.
  - `on [--all]` with the code from `status` (bound to 0380's exact text and the approved numbers): back to exactly the
    approved numbers, COMMITTED, then a separate re-judgement of existing photos. Refuses before 0380 is deployed or when
    the exact rules differ (unless `--all`).
  - `sweep` with `photo-detection-sweep`: the re-judgement alone (needed once right after the 0380 deploy, see the race).
- `scripts/trust-safety/fingerprint-existing-photos.js` now also records near-duplicate hashes for photos uploaded before
  the `moderate-photo` redeploy (same shared hash module; JPEG only like the function; skipped while 0368 is missing).
  Before, it recorded exact fingerprints only, so older photos would never have been checked for near-copies.
- `scripts/live-verify/post-deploy.js`: step 20270380 + the switch's rollback/check.

## Found and fixed while preparing: the activation race

A photo recorded WHILE the activation transaction is open reads "detection off" (the new numbers aren't committed yet) and
isn't visible to the migration's own sweep (its row isn't committed yet). It would stay unjudged until a later matching
upload pulled it in. Shown deterministically by `scripts/replay/review-case-concurrency.js` step 6 (3/3 runs: two parallel
copies left out). Fix: `on` commits the numbers first and re-judges in a separate transaction; after the 0380 deploy the
plan runs `sweep` once. Step 6 then shows ONE open case with all six accounts, also with a sixth copy recorded during the
sweep.

## Verification (local only; nothing touched production)

- Fresh from-scratch replay (real Auth first): **504/504** migrations.
- Journey `photoDetectionActivation` **8/8** (approved numbers; off --all records but opens nothing; on --all + sweep
  judges earlier photos: 3 accounts unrelated names = case, a 2-account household = nothing, 2 similar names = case, an
  identical file on 3 = case; sweep twice = no second case, no extra history; new upload joins; near off = no new near
  match while exact copies still match; a dismissed case stays closed when it comes back on; no account changed or
  notified; clients can't read cases or run the sweep). **Fails 8/8 with 0380 rolled back.** The switch's own UPDATE
  statements are imported and run verbatim.
- `reviewCaseHistory` adjusted (defaults = 10/10 once 0380 is installed, null before); all journeys **951/951** before and
  after the concurrency scripts.
- All **14** concurrency scripts pass (incl. the new step 6).
- Rollback round trip: 882 -> 881 -> 882 functions, definitions + ACLs + settings identical.
- 0380 refuses with exact rules 4 / 0.5 and without 0369 (rolled-back checks).
- Switch run against the replay: refusals send nothing; off --all -> on --all restores the activated state exactly.
- Jest **540/540** suites (7321 tests).

NOT run (deploy gates): prod journeys with the 0348-0380 prelude, an aborted rollback round trip on prod, grants vs prod,
real uploads through `moderate-photo` on prod.

## Controlled activation sequence (each step its own approval)

1. **Build 87 + Tier 1 on the iPhone** (owner order: first).
2. Deploy 0348 -> 0379 in number order through `deploy.js`, each with its own approval and post-deploy checks. Along the way:
   - `moderate-photo` redeployed (with 0349, and its current code carries the 0357 + 0368 hashing).
   - after **0357**: `fingerprint-existing-photos.js --dry-run`, then the real run (exact fingerprints of earlier photos).
   - **0358** turns exact-copy detection ON (3 / 0.5). This is already the first activation; plan it as such.
   - after **0368** (+ `moderate-photo`): run `fingerprint-existing-photos.js` again (near-duplicate hashes of earlier photos).
   - website re-exported + published with `AdminReviewScreen` (0369 / 0379), so an admin can actually review a case;
     at least one admin account.
3. Before 0380's approval: prod journeys with the 0348-0380 prelude + an aborted rollback round trip on prod + grants vs
   prod; the 0368 version of the photo Privacy Policy sentence approved + published (below).
4. Deploy **0380** (approval `NEARBY_PROD_APPROVAL=20270380:<sha256 of the committed file>`; currently
   `8e40401ac31e79de804b220b8619295816ea751da31b791a563eb72ba4afa6dc`, recompute at approval time), then at once
   `photo-detection-switch.js sweep --target=prod` (approval `photo-detection-sweep`), then `status`.
5. Controlled check with dedicated test accounts only: the same test photo on 3 test accounts = ONE case in the admin
   queue; an admin closes it "No action needed"; no account hidden, suspended or notified; delete the test accounts (the
   case stays as history).
6. Monitoring: a weekly look at photo cases (how many, how many closed "No action needed"). Many legitimate matches =
   `off` and report; the numbers change only by an approved migration.

**Disable at any time:** `NEARBY_PHOTO_DETECTION_APPROVAL=photo-detection-off node scripts/trust-safety/photo-detection-switch.js off --target=prod`
(add `--all` to stop exact copies too). Instant, touches no case or account. Full rollback of 0380 =
`scripts/rollback/20270380_photo_detection_activation.rollback.sql` (before rolling back anything older).

## What remains before it can safely be turned on

1. Build 87 + Tier 1 (owner priority).
2. 0348-0379 deployed + verified in order (each its own approval), incl. the `moderate-photo` redeploy and both backfill
   runs. Exact copies come on at 0358.
3. Website with the admin review screen published (own approval) + an admin account, so cases can be reviewed.
4. Privacy Policy: publish the **0368 version** of the photo sentence (drafted in `TRUST_SAFETY_FIXES_2026-10-27.md`,
   "Privacy Policy sentences"; owner + counsel approve). The SHA-256-only version becomes untrue once 0368 is live.
5. Prod-equivalent checks for 0380: prod journeys with the 0348-0380 prelude, prod aborted rollback, grants vs prod.
6. 0380's own deploy approval, then the sweep, status and the controlled check above.
7. Recommended, owner's call: re-run `calibrate-photo-hashes.js` on a larger, more realistic photo set (selfies, group
   photos) before switching near-duplicates on. The 314-photo set had 0 false matches at 10/10, but the closest unrelated
   pair was at 13, so the margin is thin.

## Known limits (unchanged, accepted)

Photos taken from outside Nearby aren't detected; heavy crops, corner crops, rotations, collages and photos of a screen
aren't caught; only JPEG gets near-duplicate hashes (the app always uploads JPEG); matching scans in-use hashes (fine now,
needs an index structure before many thousands of accounts).
