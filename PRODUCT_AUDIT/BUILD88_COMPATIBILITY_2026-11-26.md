# Build 88 (and build 87) x database compatibility (2026-11-26/27)

LOCAL ONLY: isolated replay databases on the internal docker network (no route out). Nothing deployed, nothing published.
Tools + how to rerun: `scripts/compat/README.md`; process: `RELEASE_COMPATIBILITY_PROCESS_2026-11-26.md`.
Logs: `/workspaces/.nearby-verify/compat/b88-v3/` (build 88), `b87-v3/` (build 87), `mut-dating347/` (mutation check).

## What each checkpoint runs
- **Runtime (15 steps):** the build's REAL service code through a real PostgREST (v13.0.7) as real signed-in users
  (`authenticated` role, RLS on): sign-up + profile creation + start-up read, the 0373 rollout gate, profile bio save,
  link screening (0396), Friends (request -> pending -> accept -> both see it), Dating Browse (the screen's own
  `getBrowseMatches`, paged), gathering (create -> found by a friend -> join -> host sees it), gathering chat, community
  (create -> join -> message), the 0391/0423 fallbacks, business request -> reaches the business, Business Mode
  (loads, opportunity listed), offer (business replies, customer sees it), booking (accept -> business sees it), visit
  (customer marks done -> business confirms).
- **Static:** every `.rpc` / `.from` call in the build's `src/` checked against the catalog for `authenticated`.
- **Stand-ins (the only things not real):** Supabase Auth (a signed JWT), device location, the two content-screening
  edge functions (emulated from their source; classifier answers "low"; no Web Risk key), and 0373's language
  calibration (the activation migration the rollout needs; the uncalibrated state has its own step).
- **Not covered:** real SMS / Auth sign-in, push delivery, real Anthropic / Web Risk answers, Storage uploads, screen
  rendering. Those stay on the device checklist (`BUILD88_DEVICE_CHECKLIST_2026-11-26.md`).

## Build 88 (main, cf90f3ad1): PASS everywhere
Checkpoints = production today (0347) + every proposed batch boundary + the three the owner named:
0347, 0354, 0362, 0366, 0369, 0372, 0373, 0381, 0396, 0398, 0406, 0417, 0429, 0432, 0433.
**Runtime 15/15 at all 15.** Static flags fall 65 -> 2; every flag was triaged (below).

### Found and fixed in this run
1. **Dating Browse + Crossed Paths empty on a database before 0348 (= production today).** Production's
   `dating_candidates_visible_to_me` has no hide-switch columns (checked read-only 2026-11-27: `birthdate, ethnicity`
   only); the pre-0348 read asked for them -> 42703 -> empty list. Fixed in `services/peopleRead.js`: switches read
   from `people_visible_to_me` for those people; a person whose switches can't be read is treated as having hidden
   both (never shown by default). Unit tests in `peopleRead.test.js`. Mutation check: with the fix removed, build 88
   fails the Dating step at 0347; with it, passes.
2. **The runner's Dating step was weaker than the app** (it read 2 columns instead of the screen's list, which is why
   the earlier runs passed). Now it calls the screen's own `getBrowseMatches`.

### Static flags at 0347 that THROW (20), each checked for reachability
- Safe (return nothing / behind a switch the old DB never shows / admin-only website screens): account deletion impact
  (null = no extra line), step-up begin (`unavailable` before 0375; complete only after begin), familiar hosts (empty),
  ID-verification open (true), crossed-paths switch (no switch shown before 0384), business contact + locations
  (proved by runtime steps), the 10 `admin_*` calls (website Admin Review, link shown only when the server answers).
- **One real gap: "Set as main photo"** (`swap_main_photo`, from 0349) fails on production today, for build 87 AND 88.
  No safe client fallback: the old client copy never worked (profile_photos refused it) and copying screening flags
  client-side is what 0349 forbids. Fixed by Batch 1, not by weakening it. Recorded for Tier 1 as expected.
- At 0433 two flags remain, both pre-0348-only fallbacks (`preferencePolls.js:87`, `peopleRead.js:56`).

## Build 87 (tag build-87-ios): see below
BUILD87_PENDING

## Circular dependencies: none
Build 88 passes at 0347, i.e. it needs NO pending migration. So no migration can be in a cycle with it: every
"needs build 88" migration simply waits for build 88 on every device (Wall rule).

## Live defects on production today (build 87 x 0347), found by this run
| Defect | Cause | Fixed by |
|---|---|---|
| Dating Browse + Crossed Paths empty | pre-0348 read asks for hide switches the Dating view lacks | Batch 1 (0348) or build 88 |
| Set as main photo fails | `swap_main_photo` arrives with 0349 | Batch 1 (0349) |
| Friends crossed paths may show people already passed | `friend_discovery_swipes.to_user` not readable; error ignored | 20270433 |
