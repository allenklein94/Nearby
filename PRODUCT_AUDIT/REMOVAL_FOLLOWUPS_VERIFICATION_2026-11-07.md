# 0394 + 0395 local verification progress (2026-11-07)

Codespace restarts about every 20 minutes, so verification runs in short steps and each result is recorded here as it lands.
Branch `post-tier1/removal-followups`. Staged only: nothing merged, deployed, or changed in build 87.

## Done
- Jest 546/546 suites (7389 tests + 11 todo)
- Fresh replay 519/519 migrations (real Auth first, fixtures applied)
- Journeys before concurrency: 1164/1164
- Concurrency pass 1 (earlier session, before a restart): 22/22

## Found 2026-11-07 13:45 (one full concurrency pass, then journeys)
- Journeys after concurrency: 15-19 failures, all in suites that depend on rate limits: `private.rate_limit_rules` was left EMPTY
  by some script (test state, not a migration defect; being pinpointed by a per-script rule-count run).
- `gated-perk-legal-hold-concurrency.js` (new) crashed in section 3: a refused report insert was read as a row. Fixed:
  report() now throws the server's reason.
- The runner's log line printed date's exit code, not the script's (all said 0); fixed (rc captured first).
- Also FAILED in that pass: friend-request + screening-single-use (likely knock-on of the missing rules), booking-capacity
  (one deadlock; to recheck).

- CAUSE of all of the above except the crash (13:48): an earlier background run (3 passes) was still running on the SAME
  database while the second run started, so scripts overlapped (shared phone numbers, one script's emptied rate-limit
  rules seen by another). Not a code defect. Rerunning alone on a fresh replay, one runner only.

## Clean run, 13:49-14:05 (one runner only, fresh replay)
- Replay 519/519; 22/22 concurrency scripts rc=0, 0 FAIL lines, rate-limit rules 32 / md5 6984d2e0 unchanged after every script
- Journeys after: 1164/1164
- Rollback 0395 + 0394 = fresh 0393 replay (worktree at e4be8225): pg_dump 0 diff lines (65,647); re-apply 0 diff lines (66,039)
- On the pre-0394 DB: gatedPerkCancel + legalHolds fail 17/17, other 1147 pass

DONE. Recorded in CLAUDE.md + CLAUDE_HISTORY.md.
