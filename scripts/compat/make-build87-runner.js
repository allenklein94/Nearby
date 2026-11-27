// Derives the BUILD 87 runtime runner from src/qa/compat/appBuild.compat.js (2026-11-27). Build 87's tag predates the
// runner, so "test the released build" (release process rule 3) needs this one-off adapter; builds from 88 on carry
// the runner in their own tag and need nothing like it.
//   node scripts/compat/make-build87-runner.js <build 87 worktree>
// then: APP_ROOT=<worktree> MIGRATIONS_FROM=/workspaces/Nearby DB=... START=20270347 CHECKPOINTS=... bash scripts/compat/release-compat.sh
//
// Same steps, same stand-ins, same assertions, with build 87's own service code. What differs, and why:
//   - supabase client: build 87 has no acting-business header wrapper (services/actingBusiness is newer) = plain fetch.
//   - content screening: build 87 never calls screen-user-content; its screens write straight away. screenUserContent is
//     replaced by "publish without asking", so from 0373 the database itself decides (expected: refused = Wall B).
//   - the 0373 calibration and 0396 link steps are build 88 behaviour: reported n/a.
//   - Dating Browse: the runner already calls getBrowseMatches (build 87 returns an array; handled in the runner).
//   - the 0391/0423 fallback step and Business Mode's location calls (businessLocations) don't exist in 87: skipped.
//   - the journey harness comes from THIS checkout (actor setup only; never app code).
const fs = require('fs');
const path = require('path');
const target = process.argv[2];
if (!target) { console.error('usage: make-build87-runner.js <build 87 worktree>'); process.exit(2); }
const here = path.resolve(__dirname, '../..');
let s = fs.readFileSync(path.join(here, 'src/qa/compat/appBuild.compat.js'), 'utf8');
const swap = (from, to) => { if (!s.includes(from)) throw new Error(`runner changed, adapter needs updating: ${from.slice(0, 80)}`); s = s.split(from).join(to); };

swap("  const { withActingBusiness } = require('../../services/actingBusiness');\n", '');
swap('global: { fetch: withActingBusiness((...a) => mockFetch(...a)) }, // the app\'s own wrapper (services/supabase.js)',
  'global: { fetch: (...a) => mockFetch(...a) }, // build 87: no acting-business wrapper');
swap("require('../../services/userContentScreening')", "({ screenUserContent: async () => ({ outcome: 'publish', build87: 'never screens' }) })");
swap("require('../../journeys/journeyHarness')", `require(${JSON.stringify(path.join(here, 'src/journeys/journeyHarness'))})`);
swap("    if (!st.calibrationBefore) return { outcome: 'n/a before 0373' };", "    return { outcome: 'n/a: build 87 never screens' };");
swap("    const expected = has(20270396) ? 'unavailable' : 'publish';", "    return { outcome: 'n/a: build 87 never screens' };\n    const expected = 'publish';");
swap("    const { hostMemoryRemovalAvailable } = require('../../services/stories');", "    return { skipped: 'build 87 has neither feature' };\n    const { hostMemoryRemovalAvailable } = require('../../services/stories');");
swap("    const { getMyBusinessLocations, noteLocationAwareSession } = require('../../services/businessLocations');\n", '');
swap('    await getMyBusinessLocations(); await noteLocationAwareSession();\n', '');
swap('app build x database', 'BUILD 87 x database');

fs.mkdirSync(path.join(target, 'src/qa/compat'), { recursive: true });
fs.writeFileSync(path.join(target, 'src/qa/compat/appBuild.compat.js'), s);
fs.copyFileSync(path.join(here, 'jest.compat.config.js'), path.join(target, 'jest.compat.config.js'));
console.log('build 87 runner written to', target);
