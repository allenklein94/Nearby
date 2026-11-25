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
