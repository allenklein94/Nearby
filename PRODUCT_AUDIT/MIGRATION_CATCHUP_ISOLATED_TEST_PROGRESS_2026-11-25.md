# Migration catch-up: isolated test progress (2026-11-25)

LOCAL ONLY (isolated Docker network, never production). Nothing deployed, build 87 unchanged. Logs: `/workspaces/.nearby-verify/catchup/out` (run 1, with journey fixtures) and `out2` (run 2, fresh, clean round trip). Deploy branch head at run time: 50ff361a3.

| Step | Result |
|---|---|
| Replay 0001-0347 (PG 17.6.1.003 = prod engine) | 471/471 apply, twice; the two 0347 dumps identical (0 lines) |
| R5 drift: prod (read-only catalog) vs replay@0347 | NO FUNCTIONAL DRIFT. 26 function fingerprints differ only by prod's CRLF line endings (bodies identical after stripping `\r`; the 4 that seemed to differ are 0359's own edits, compared at 0432). `live_tracking_sessions`: prod has redundant column-level SELECT grants on top of the table-level SELECT both sides have (no-op; no migration 0348-0432 touches the table). Extensions: btree_gist / pg_trgm in `public` on prod vs `extensions` on replay (known; 0357 resolves pg_trgm's location at runtime); pg_graphql absent on prod |
| Apply 0348-0372, 0373-0432 | all 85 apply in order; two independent runs give byte-identical 0432 dumps |
| R4 build 87 compatibility (`build87Compatibility` + `appVersionCompatibility`) | 12/12 at 0372; build87 6/6 at 0432 (fresh run) |
| R4 static check of build 87's 6,497 call sites vs catalog | no real failure at 0372 or 0432: the admin RPC "args-mismatch" lines are scanner noise (arg names checked by hand = DB); the one new no-privilege line (`preferencePolls.js:87` direct read of dining columns) is a fallback reached only when `get_friend_dining_preferences` is missing, which 0348 creates |
| All journeys at 0432 (run 1, fixtures) | 1576/1578; the 2 failures were build87Compatibility at an earlier commit, both fixed by 50080304c / 50ff361a3 and passing in run 2 |
| Concurrency scripts at 0432 | 31/31 pass |
| Rollback 0432 -> 0348 (run 2, no fixture data) | all 85 rollbacks run; schema vs 0347: only (a) ACL entry ORDER on 6 objects (same grants) and (b) 5 function bodies differing in whitespace only (identical ignoring whitespace). Behaviour = 0347 |
| Rollback with data (run 1) | 0406's rollback REFUSES while dependent rows exist (designed data guard) |
| Re-apply 0348-0432 after rollback | identical to first 0432 dump (0 lines) |
| Precise call check at 0372 + 0432, build 87 (2a28c8e8) AND the published website source (`release/website-option-a-src` 1b8f0b7dd, 857 files): every RPC exists with the keys sent | 324/324 calls OK on both, at both states (3 scanner flags = object values, checked by hand). Table reads: the dining fallback above, plus `friend_discovery_swipes` select = PRE-EXISTING (also at 0347, i.e. on prod today; not caused or fixed by any migration): Friends discovery can't read its own swipe history, so already-swiped people can reappear. Separate bug, not a catch-up blocker |
| Roll 0432 -> 0373 back, re-apply | identical to the first 0432 dump (0 lines), second time |
| Jest on the deploy branch | 604/604 suites, 8132 tests (after adding 0417's missing post-deploy step; it had joined the branch as files only) |
| Backup script (option B) dry run on the local replay | FOUND + FIXED 3 bugs: dump was root-owned 666 (chmod failed; now runs as this user, 0600 from the first byte, deleted if not 0600); restore raced the image's first-time setup (now waits for the health check); source fingerprint had no stdin (`docker run -i`; an empty fingerprint now FAILS). Re-run: PASS, 306 tables identical row counts + md5. Remaining: 10 trigram indexes not rebuilt on the restored copy when pg_trgm lives outside the dumped schemas (replay: `extensions`; prod: `public`, so it should be dumped; confirm on the first real run, rows unaffected) |

## Edge functions for Phase 1 (live versions read-only 2026-11-25; live bundles saved to `/workspaces/.nearby-verify/catchup/edge-rollback/` as rollback references)

| Function | Live | Live source = | Deploy from | When | Type check |
|---|---|---|---|---|---|
| moderate-photo | v17, 2026-08-01 | commit 806d524ef (byte match) | deploy branch (= main: 0349 file-version binding, 0357 SHA-256, 0368 dHash/pHash) | right after 0349 | Deno 2.1.4 OK (newest Deno flags 2 type-only Uint8Array errors) |
| report-presence | v13, 2026-10-28 | commit 806d524ef (byte match) | deploy branch | right after 0363 | OK |
| screen-business-content | v47, 2026-10-28 | no commit matches (recovered source + key helper); saved bundle = rollback reference | deploy branch (0372 + 0415 + 0420 code) | at 0372 | OK |
| delete-account | v9 | | HELD (unchanged decision) | | |

Each redeploy also bundles the current `_shared/` (incl. the JWT-rotation helper whose legacy fallback is removed in code): the first redeploy is also the first live use of that change. Rollback = `supabase functions deploy <name>` from commit 806d524ef (moderate-photo, report-presence); screen-business-content has no source commit for its live version, so extract its index.ts from the saved bundle BEFORE its redeploy (do this once the deploy is approved).

## Build 88 checklist (Phase 2, 0373-0432): what must be true

1. Integration branch = deploy branch + `release/website-option-a-src` (REQUIRED: otherwise the next website export undoes the published Option A pickers) + the owner's chosen post-tier1 branches (list in the plan §8.4); full Jest + iOS/web exports + journeys on a replay at 0432.
2. Edge functions changed on the deploy branch vs main, deployed with their migrations: `screen-user-content` (NEW, not on prod; before 0373), `screen-business-content` (0420), `send-push`, `business-email`, `submit-business-application`, `business-ai-assistant`, `_shared`; `delete-account` held.
3. Production Anthropic credit (separate org decision) before 0373; Google Web Risk key before 0396; STAGING credit for 0414's real two-business upload gate.
4. Staging iPhone build of the integration branch first (Expo staging project exists; iOS credentials + staging Maps key still open), then production build 88 on every device before 0373.
5. Website re-export from the integration branch + publish approval at the step where its migrations land.
6. Privacy Policy sentences for the staged disclosures (0355/0357 in Phase 1; 0413/0414 and others in Phase 2) reviewed + published with their migrations.
