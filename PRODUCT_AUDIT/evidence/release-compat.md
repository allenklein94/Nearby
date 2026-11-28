# Release compatibility evidence (read by deploy.js: scripts/migrations/releaseGates.js)

Only the copy committed at HEAD counts. One line per kind; a FAIL line, a duplicate or a malformed line refuses every
production migration. Update after every release-compat run (scripts/compat/README.md). "through" = the highest database
version the run covered; deploy.js refuses a migration above it.

next: PASS build 88 @f2931878b through 20270435 (runtime 15/15 at 0347 and every boundary 0354, 0362, 0366, 0369, 0372, 0373, 0381, 0398, 0406, 0417, 0429, 0432, 0433, 0434, 0435; static at 0435 = the same 2 known fallbacks; re-run after the cuisine-support change and the 0353 move; local replay; 2026-11-28, /workspaces/.nearby-verify/v491/compat, branch fix/device-findings-nov27)
released: PASS build 87 @2a28c8e85 through 20270372 (runtime 15/15 at 0354-0372; 14/15 at 0347 = the live Dating defect, fixed by 0348; fails from 0373 by design = client floor; 2026-11-27, /workspaces/.nearby-verify/compat/b87-v3)

The two lines below are required from 20270373 on (client floor: build 88). Record them only when true:
  (template) distribution: PASS build 88 <date> testflight-older: expired appstore-older: never-released (owner checked App Store Connect)
  Both tokens are required: a signed-out or dormant install isn't in auth.sessions, so only an expired TestFlight build
  (won't launch) and no App Store release below 88, ever, keep it from coming back. Until 20270434 is live with the floor enforced AND strict mode on, nothing else stops it (and migrations listed by `serverFloorGaps` need these lines even then).
  (template) website: PASS build 88 <commit> business website exported from build 88 source + published (owner approved)
