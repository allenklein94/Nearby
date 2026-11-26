# Release compatibility (scripts/compat)

Proves an app build keeps working on the database at every point of a migration rollout. LOCAL ONLY: isolated replay
databases on the internal docker network; the driver refuses anything else. Process and release rules:
`PRODUCT_AUDIT/RELEASE_COMPATIBILITY_PROCESS_2026-11-26.md`.

| File | What |
|---|---|
| `release-compat.sh` | Driver: at START and each checkpoint, applies migrations in number order (one transaction each), runs the static scan + the runtime runner, writes `$OUT/summary.txt`. |
| `scan-calls.js` | Every `.rpc(name, {args})` and `.from(table).select/insert/update/upsert/delete` in an app source tree (comments ignored, argument names only). |
| `calls-to-sql.js` | Those calls as one catalog query for the `authenticated` role: exists / execute or column privilege / argument names. |
| `../../src/qa/compat/appBuild.compat.js` | Runtime: the build's REAL service code through a real PostgREST (14 steps: sign-up, profile, link screening, friends, dating, gathering + chat, community, business request, Business Mode, offer, booking, visit). |
| `../../jest.compat.config.js` | Jest config for `*.compat.js` (native modules stubbed). |

```
# 1. a replay database at the version production is on (here 0347)
bash /workspaces/.nearby-verify/catchup/run88.sh r347          # or scripts/replay/from-scratch-replay.sh trimmed to START
# 2. the build under test, every batch boundary
DB=nearby-b88 START=20270347 CHECKPOINTS="20270354 20270362 ..." OUT=/workspaces/.nearby-verify/compat/<run> \
  bash scripts/compat/release-compat.sh
# 3. a RELEASED build against newer migrations: a worktree of its tag (it carries its own runner)
APP_ROOT=<worktree of the build tag> MIGRATIONS_FROM=/workspaces/Nearby DB=... START=... bash scripts/compat/release-compat.sh
```

Reading the static result: a flagged call at a version before its migration is fine only if the code handles the missing
function/column (a fallback such as `isMissingFunction`, or a read that degrades to empty) or the screen can't be reached
yet. A call flagged at the LATEST version is a defect unless it is such a fallback.

Stand-ins (the only things not real): Supabase Auth (a signed JWT), the device location, the two content-screening edge
functions (emulated from their source; the classifier answers 'low'; no Web Risk key), and language calibration from 0373
(the activation migration the rollout needs; the uncalibrated state has its own step).
