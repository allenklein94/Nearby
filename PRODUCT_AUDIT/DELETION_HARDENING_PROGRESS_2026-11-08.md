# Deletion / legal-hold hardening pass: progress (2026-11-08)
Branch `post-tier1/deletion-hardening`, worktree `/workspaces/.nearby-verify/wt403`, DB container `nearby-v403` (PG 17.6). Staged only.
- [x] Audit. Flake causes found (reports.created_at frozen by trigger; friend_discovery_rows random tie-break). New orphan: gathering-photos.
- [x] 20270403 migration + rollback
- [x] delete-account generic error
- [x] journey deletionHardening; concurrency; function test
- [x] Admin client: account hold, reference rule, retention line
- [x] wording check; CSAM draft (gitignored: repo is PUBLIC)
- [x] Flake fixes; full verify; docs
Done 2026-11-08; results in `ACCOUNT_DELETION_AUDIT_RETENTION_2026-11-08.md`, last section. Awaiting owner acceptance.
