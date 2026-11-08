# Deletion / legal-hold hardening pass: progress (2026-11-08)
Branch `post-tier1/deletion-hardening`, worktree `/workspaces/.nearby-verify/wt403`, DB container `nearby-h17` (PG 17.6). Staged only.
- [x] Audit. Flake causes found (reports.created_at frozen by trigger; friend_discovery_rows random tie-break). New orphan: gathering-photos.
- [ ] 20270403 migration + rollback
- [ ] delete-account generic error
- [ ] journey deletionHardening; concurrency; function test
- [ ] Admin client: account hold, reference rule, retention line
- [ ] wording check; CSAM draft (gitignored: repo is PUBLIC)
- [ ] Flake fixes; full verify; docs
