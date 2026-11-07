# 0394 + 0395 local verification progress (2026-11-07)

Codespace restarts about every 20 minutes, so verification runs in short steps and each result is recorded here as it lands.
Branch `post-tier1/removal-followups`. Staged only: nothing merged, deployed, or changed in build 87.

## Done
- Jest 546/546 suites (7389 tests + 11 todo)
- Fresh replay 519/519 migrations (real Auth first, fixtures applied)
- Journeys before concurrency: 1164/1164
- Concurrency pass 1 (earlier session, before a restart): 22/22

## Still to do (each step < 15 min)
1. Concurrency: 22 scripts, run in batches (record each batch here)
2. Journeys after concurrency
3. Rollback 0395 + 0394 on the replay; compare pg_dump with a fresh replay from a worktree at e4be8225 (0393 only); re-apply
4. CLAUDE.md + CLAUDE_HISTORY.md entries
