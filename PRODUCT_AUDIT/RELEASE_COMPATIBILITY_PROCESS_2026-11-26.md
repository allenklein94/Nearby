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
- Tools built and run for build 88 and build 87 (2026-11-26/27): `PRODUCT_AUDIT/BUILD88_COMPATIBILITY_2026-11-26.md`.
- Rules 1-8: PROPOSED, need the owner's approval to become standing conventions (then one line each in CLAUDE.md).
- Not automated: there is no CI (GitHub Actions) in this repo; the checks run in a session. Running them in CI would need
  Docker-capable runners and is a separate decision.
