# Release compatibility process (owner, 2026-11-26: never another 86-migration backlog)

Proposed standing process, for the owner's approval. Tools: `scripts/compat/` (README there). Nothing here deploys anything:
every production step keeps its own approval.

## The rules
1. **Old app keeps working.** A migration must keep the app build people have (today: build 87) working, or it is marked
   "needs build N" in its header AND in the approval packet, and waits for that build to be on every device (Wall rule).
2. **New app never needs the migration to work.** A build's new feature reads its server piece through a fallback
   (missing function / column = the old behaviour or nothing shown), so the build can ship before the migration.
   This is what keeps the order one-way (build first, migration after) and rules out circular dependencies.
3. **Test both builds at every batch boundary.** Before a batch is approved: `release-compat.sh` for the NEXT build (this
   checkout) and for the RELEASED build (`APP_ROOT=<worktree of its tag>`), from production's current version through every
   batch boundary. Runtime must pass; every static flag at the latest version must be a deliberate fallback.
   Build 87 is the one exception: its tag predates the runner, so `node scripts/compat/make-build87-runner.js <worktree>`
   writes an adapted copy into a worktree of `build-87-ios` first. Every tag from build 88 on carries the runner itself.
   A runtime step that the released build CAN'T pass at a version (e.g. build 87 from 0373) is listed, by migration, as
   that migration's "needs build N" gate; it is never a reason to weaken the migration.
4. **Off until ready.** A feature whose server, client, provider key or legal sentence isn't all in place stays switched
   off (a server switch or the missing-function fallback), never half on.
5. **Integrate weekly.** Approved work merges into main within a week of approval (behind a switch if needed). No feature
   branch older than 14 days without a dated reason in CLAUDE.md.
6. **A path to production for every migration.** When a migration is merged it gets its packet row (generated:
   `node scripts/catchup/approval-packets.js`) with batch, gate, checks and rollback. A migration merged > 30 days without
   being deployed is reported to the owner at the next session start.
7. **Backups.** A verified backup the same day as every batch (`FULL_READ=1 bash scripts/backup/prod-backup-via-login-role.sh`,
   PASS line), encrypted (`encrypt-backup.sh`) and downloaded off the Codespace by the owner.
8. **Policy with the change.** A migration or build that adds processing ships with its Privacy Policy sentence published
   the same day (staged in `staged-docs/`).

## Owner's six release rules (2026-11-27) -> where each lives above
| Owner rule | Rule(s) here |
|---|---|
| Database compatibility with the distributed app | 1 (+ "needs build N" gates, listed per migration) |
| Automated testing of the current app and the upcoming build against each migration | 3 (`release-compat.sh` x both builds x every batch boundary) |
| Feature activation only when client + server are ready | 2 + 4 |
| Branch consolidation | 5 |
| Deployment discipline (dev -> staging -> production path) | 6 + "Per release" below |
| Encrypted, verified off-Codespace backups | 7 |

**No circular dependencies, by construction.** A cycle would be "migration M needs build N" AND "build N needs M".
Rule 2 forbids the second half: build N must pass the runtime run at production's CURRENT version (before M). So the
order is always build first, then migration. The compatibility run proves it each release: build N passing at the
oldest checkpoint = no migration it depends on.

## Per release, in order
1. Build N source frozen on main -> tag `build-N-ios` + branch `release/build-N` (as build 87).
2. `release-compat.sh` with build N against production's version + every planned batch boundary; record the summary in
   the batch's approval packet.
3. Build N on TestFlight -> device checklist -> on every device (App Store Connect checked).
4. Batches in number order, each: backup -> packet checks -> deploy -> post-deploy checks -> next.
5. After the last batch: `migration:status` = repo; no migration on main without a ledger row.

## Session start check (rule 6, so the backlog can't build up silently)
`npm run migration:status -- --target=prod` (read-only) + `git branch -r --no-merged main`: report the number of
migrations on main without a production ledger row, the oldest one's age, and branches older than 14 days.

## Status of this process
- APPROVED as standing requirements (owner, 2026-11-27): rules 1-8 and the six release rules. Recorded in CLAUDE.md
  ("Release process" under Standing conventions).
- Enforced by code (production `deploy.js` refuses; `scripts/migrations/releaseGates.js`, tests `releaseGates.test.js`):
  rule 1 + 3 (committed compat evidence for the next AND released build through the version, app source unchanged since;
  client floor "needs build N" from 0373: live session read + distribution + website lines), rule 7 (verified + encrypted
  backup < 24 h), rule 8 (Privacy sentence on published main, marker `<!-- nearby-processing: <version> -->`).
  Rule 6: every pending migration has a rollback + packet row (test), every edge function an inventory row
  (`releaseInventory.test.js`, `RELEASE_INVENTORY_2026-11-27.md`). Rules 5 + 6 reported by `npm run release:status`.
- Enforced by process only: rule 2 (proved per release by the compat run at production's current version), rule 4
  (feature switches), rule 5's merging itself. No CI exists; the checks run in a session.

## Returning older installs (owner, 2026-11-27): audit + what the 0373 gate now requires
Audit: Nearby has NO minimum-supported-version mechanism (no version check in the app, database, pre-request hook or edge
functions). Each build's native HTTP stack sends `Nearby/<build>` as its user agent; Auth stores it per session.
Production Auth: sessions never expire (`sessions_timebox` 0, `sessions_inactivity_timeout` 0); live sessions today:
1 x `Nearby/87` (owner's iPhone, active 2026-11-26), 5 browser.

| Who | Visible to the live-session read? | What stops them after 0373 |
|---|---|---|
| Build 87, still signed in, used daily | yes | gate refuses until they're on build 88 or signed out |
| Build 87, signed in, dormant for weeks | yes (sessions never expire, so the row stays) | same |
| Build 87, signed out | no | only: the build can't be opened (TestFlight build expired) |
| Build 87, session ended (refresh token revoked, password/number change, admin sign-out) | no | same |
| Build 87 installed, never signed in | no | same |
| Any build ever released on the App Store | no | nothing: it stays installed and launchable forever |

So from 0373 the distribution line must say `testflight-older: expired appstore-older: never-released` (deploy.js refuses
otherwise; tests in `releaseGates.test.js`). An expired TestFlight build won't launch, which covers every row above.
If App Store Connect shows ANY App Store release below build 88, the gate can't pass and 0373 needs a server-side
minimum-version refusal first. That refusal is now BUILT + STAGED as 20270434 (`release/version-policy`; see "Minimum
supported version" below), NOT deployed, enforcement off.
Order: expire build 86 and older now (0348 already breaks build 86); expire build 87 only after build 88 is installed on
every device and Tier 1 is done.
Web: a business-website tab left open keeps the old JavaScript until reloaded; the website line requires the re-export,
and a reload picks it up (one business account today).

## Minimum supported version (20270434, owner 2026-11-27; STAGED, NOT deployed, enforcement OFF everywhere)
What it is: a per-project server policy (`private.app_version_policy`, one row each for ios / android / web: minimum
supported build, latest build, update link, enforced yes/no), plus a record of which builds people can actually get
(`private.app_build_availability`: testflight, staging_internal, app_store, google_play, website) and an append-only change
log. Staging and production each have their own rows, so a staging setting can't affect production. Only the owner-run
`scripts/release/app-version-policy.js` changes the rows (status / record-available / plan / set / off).

| Build state | Server (once enforced) | App (build 88+) |
|---|---|---|
| >= latest | passes | opens normally |
| >= minimum, < latest | passes | opens + one dismissible "A new version of Nearby is available." notice (once per newer build) |
| < enforced minimum, 88+ | every PostgREST request refused (P0001, hint `app_update_required`) | "Time for an update" screen instead of the app: Update Nearby (the policy's link) + "Already updated? Check again" |
| <= 87 (no mechanism) | refused the same way, identified by its `Nearby/<build> CFNetwork` user agent | no update screen: the old screens show their ordinary errors |

Safeguards:
- **Nothing enforced points at an unavailable build.** The database refuses enforcing a minimum (or announcing a latest)
  above the newest build recorded as available on that platform, and a store link (App Store / Google Play / TestFlight)
  unless that store carries the build. Testers are never sent to a public listing that doesn't have it.
- **Emergency recovery.** Lowering the minimum, clearing it or `off` (fixed production code `version-off`) is never blocked
  and takes effect on the next request; no app release is needed.
- **Fail open.** A fault in the check (bad row, unreadable headers) lets the request through. Offline, an unreachable
  policy, an unknown version, signed out or an expired session never lock a supported user out; the app keeps the last
  policy it read, and the policy read itself is signed out with a 10 s limit.
- **Not a security boundary.** A client can claim any build. The header can only make the server refuse, never grant
  anything; permissions stay with RLS and the server functions. Unidentified clients (browsers without the header,
  scripts, service-role calls, Android builds before this mechanism) pass.
- **Not covered:** Auth (sign-in still works; every REST call after it is refused), Storage, Realtime, edge functions.
- **Checks run** at start-up, sign-in, return to the foreground, "Check again", and whenever the server refuses a request
  as too old.

Build 87 and the catch-up: build 87 has no update screen, but its requests ARE refused once a minimum >= 88 is enforced.
0434 is numbered after 0373 and `deploy.js` deploys in number order, so it can't protect build 87 during the 0348-0433
catch-up: until 0434 is live and enforced, 0373+ still need the distribution line (older TestFlight builds expired, no App
Store release below 88) and no live sessions below the floor. Once 0434 is live with iOS enforced at >= the floor (and that
build recorded available) and Android enforced or recorded `android: never-released` on the distribution line,
`deploy.js` accepts it in place of "older builds unlaunchable" and live old sessions (`releaseGates.js`
`serverFloorCovers`). Moving 0434 ahead of 0373 would need a renumber (owner decision). The website still needs its
re-export line.

Enforcing in production is a SEPARATE owner approval from deploying 0434. Order: record the build as available
(`record-available`, with App Store Connect evidence) -> `plan` -> owner approves the printed code -> `set` -> check a
build below the minimum on a device (device checklist section 7) -> record.
