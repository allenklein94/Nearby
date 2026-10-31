#!/usr/bin/env node
// Post-deploy verification for the staged trust & safety work (owner, 2026-10-30): ONE place that says, for every staged
// migration (0348-0366) and edge function, how to roll it back and what to run right after deploying it. READ-ONLY on
// production: journeys run in rolled-back transactions WITHOUT a prelude (so they test what is really live), live tests
// only read through the real API with the dedicated test account, SQL checks are SELECTs.
//   node scripts/live-verify/post-deploy.js --list               the whole plan, nothing run
//   node scripts/live-verify/post-deploy.js 20270364             ledger row present, then that step's checks
// Then always: the full `npm run journeys` without prelude (every earlier journey still passes on the live database).
// A failure = STOP and report; rollback is the owner's decision (never automatic).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

// journeys = src/journeys/<name>.journey.js; live = src/qa/<file>; sql = scripts/live-verify/<file>; node = scripts/...;
// manual = what a person checks (a phone, the website). edge = edge-function deploys that belong with the step.
const STEPS = {
  20270348: { journeys: ['profileColumnPrivacy', 'appVersionCompatibility', 'datingConsent', 'friendDiscoveryChoice', 'pushTokenPrivacy'],
    live: ['profileColumnPrivacySignedIn.live.js', 'pushTokenPrivacySignedIn.live.js'],
    manual: ['N6 sequence: get_my_profile() own/cross-user/signed-out check, then the owner repeats the website pass (PRODUCT_AUDIT/N6_PROFILE_PRIVACY_PROGRESS_2026-10-28.md)'] },
  20270349: { journeys: ['photoScreeningBinding', 'trustSafety'], node: ['scripts/replay/photo-storage-api.js (against prod storage, read-only)'],
    edge: ['moderate-photo (right after)'] },
  20270350: { journeys: ['datingConsent', 'appVersionCompatibility'], live: ['verificationSelfGrantSignedIn.live.js (NEARBY_POST_DEPLOY_0350=1; dedicated test account: own id_verified / photo_verified / is_admin / approved submission / approve RPC all refused or unchanged; any write = STOP)'] },
  20270351: { journeys: ['friendDiscoveryChoice', 'trustSafety'] },
  20270352: { journeys: ['gatheringCreationLimits', 'trustSafety'], manual: ['run order Tier 1 item 0(f): a real phone sign-up can still verify and act'] },
  20270353: { journeys: ['sightingExpiry'] },
  20270354: { journeys: ['trustSafety', 'trustSafetyI123'] },
  20270355: { journeys: ['trustSafetyI123'],
    manual: ['two accounts on prod (owner): long-press a message -> Report; delete that message; the admin queue still shows its exact text + sent/captured times (the app has no message editing, so deletion is the case to test). Controlled test messages between the two test accounts only, never a private conversation; afterwards remove only the test messages/chat, never the report or its evidence (kept for auditing; reports are retained by 0355/0357 rules)'] },
  20270356: { journeys: ['forgedFlagLimits', 'trustSafetyI123'] },
  20270357: { journeys: ['trustSafetyI123'] },
  20270358: { journeys: ['trustSafetyI123', 'trustedWriteScope'] },
  20270359: { journeys: ['trustedWriteScope'] },
  20270360: { journeys: ['trustedWriteScope', 'forgedFlagLimits'] },
  20270361: { journeys: ['forgedFlagLimits', 'trustSafetyI123'] },
  20270362: { journeys: ['gatheringCreationLimits'] },
  20270363: { journeys: ['behaviorReviewSignals'], edge: ['report-presence (records rejected jumps; safe in either order)'] },
  20270364: { journeys: ['serverOnlyFunctionGrants'], sql: ['server-only-grants-post-deploy.sql (now, and after the next 12:00 UTC cron run)'],
    live: ['serverOnlyGrantsSignedIn.live.js (NEARBY_POST_DEPLOY_0364=1)'] },
  20270365: { journeys: ['behaviorSignalThresholds', 'behaviorReviewSignals'] },
  20270366: { journeys: ['intentionCountPrivacy'] },
  20270367: { journeys: ['signupPhoneOnlyHook'] }, // installs the hook only; the gap closes with signup-hook-settings below
  // detects nothing until the owner approves distances (separate migration); moderate-photo redeploy carries the hashing
  20270368: { journeys: ['reviewCaseHistory', 'trustSafetyI123'], edge: ['moderate-photo (right after; safe in either order: it skips the hashes while the function is missing)'] },
  20270369: { journeys: ['reviewCaseHistory', 'trustSafetyI123', 'behaviorReviewSignals'], live: ['reviewCaseAdminSignedIn.live.js (NEARBY_POST_DEPLOY_0369=1)'],
    manual: ['website (unpublished build, owner approval to publish): admin signs in, Admin review lists the queue; a non-admin account sees "Admins only" and every call refused'] },
  // before the deploy: node scripts/replay/report-reason-backfill.js <prelude 0348-0369> (rolled back on prod)
  20270370: { journeys: ['reportReasonCodes', 'trustSafetyI123', 'reviewCaseHistory'], sql: ['report-reason-codes-post-deploy.sql'],
    node: ['scripts/replay/report-reason-backfill.js (BEFORE the deploy, rolled back)'] },
  // Verified Business: no business is verified by the deploy (0 events); the badge shows only after an admin review
  20270371: { journeys: ['businessVerification'], live: ['businessVerificationSignedIn.live.js (NEARBY_POST_DEPLOY_0371=1; dedicated non-admin test account: verify / revoke / list refused, record unchanged; any write = STOP)'],
    manual: ['read-only: select count(*) from private.business_verification_events = 0 right after the deploy; get_verified_business_ids(every business) = {}',
      'ACTIVATION (owner, 2026-10-31; separate from the deploy, each step reported on its own): (1) the real-API anti-forgery test above passes;',
      '(2) a real admin (not the business\'s manager) records a legitimate review of one test business with all four checks: badge appears; then revokes with a reason: badge gone, history keeps both events;',
      '(3) badge visibility: shown ONLY on the business preview sheet + Business Profile (never offer cards, replies, Opportunities, request screens, rankings), signed in + signed out, on build 87+ and the re-exported website;',
      '(4) native review of ui.businessSheet.verifiedBusiness* + ui.businessProfile.verifiedBusiness* (10 languages) before public release'] },
};

// Edge functions and Auth settings staged alongside (not migrations): rollback + check for each.
const OTHERS = {
  'review-login': { rollback: 'redeploy the live v6 bundle (git show fd484fcc:supabase/functions/review-login/index.ts, with REVIEWER_EMAIL set)',
    check: 'REVIEWER_EMAIL set FIRST; App Review number signs in once with the PIN; 6 wrong PINs from one address = the 6th refused (429); src/utils/reviewLoginConcurrency.test.js covers parallel guesses' },
  'report-presence': { rollback: 'redeploy the live bundle as recovered (git show 582c727e^:supabase/functions/report-presence/index.ts)',
    check: 'a normal presence report still 200; behaviorReviewSignals location block on prod' },
  'moderate-photo': { rollback: 'redeploy the live bundle recovered 2026-10-28 (or the 0349 version)', check: 'journey photoScreeningBinding; a real photo upload on the phone is screened; with 0368 live, private.photo_perceptual_hashes gets 6 rows for that photo (read-only count)' },
  'b5-auth-settings': { rollback: 'PATCH the "rollback:" values the apply prints', check: 'node scripts/trust-safety/b5-auth-settings.js verify, then the live sign-in tests' },
  'captcha-settings': { rollback: 'NEARBY_CAPTCHA_APPROVAL=captcha-off node scripts/trust-safety/captcha-settings.js disable (instant)',
    check: 'fresh sign-in by phone code on every installed build (shows no error; the code arrives); live sign-in tests (link path); website sign-in' },
  'signup-hook-settings': { rollback: 'NEARBY_SIGNUP_HOOK_APPROVAL=signup-hook-off node scripts/trust-safety/signup-hook-settings.js disable (instant; BEFORE any rollback of 0367)',
    check: 'own approval, only after 0367 is live: npx jest -c jest.live.config.js src/qa/signupPhoneOnlyAuthApi.live.js (fails while off; shared checks proven by scripts/replay/signup-hook-auth-local.js); a NEW phone account by real SMS on the phone (Tier 1 item 0(f))' },
};

function rollbackFile(version) {
  return fs.readdirSync(path.join(ROOT, 'scripts/rollback')).find((f) => f.startsWith(`${version}_`)) || null;
}

function plan() {
  return Object.entries(STEPS).map(([v, s]) => ({ version: Number(v), rollback: rollbackFile(v), ...s }));
}

function run(cmd, args, env = {}) {
  console.log(`$ ${[cmd, ...args].join(' ')}`);
  execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, JOURNEY_PRELUDE_FILE: '', ...env } });
}

function main(argv) {
  if (argv.includes('--list') || !argv.length) {
    for (const p of plan()) console.log(`${p.version}  rollback: ${p.rollback}\n  journeys: ${p.journeys.join(', ')}${p.live ? `\n  live: ${p.live.join(', ')}` : ''}${p.sql ? `\n  sql: ${p.sql.join(', ')}` : ''}${p.node ? `\n  node: ${p.node.join(', ')}` : ''}${p.edge ? `\n  edge: ${p.edge.join(', ')}` : ''}${p.manual ? `\n  manual: ${p.manual.join(' | ')}` : ''}`);
    for (const [k, o] of Object.entries(OTHERS)) console.log(`${k}\n  rollback: ${o.rollback}\n  check: ${o.check}`);
    return 0;
  }
  const version = Number(argv[0]);
  const step = STEPS[version];
  if (!step) { console.error(`no post-deploy plan for ${argv[0]}`); return 2; }
  run('node', ['scripts/migrations/status.js', '--target=prod']);
  run('npx', ['jest', '--testMatch', '**/*.journey.js', '--runInBand', ...step.journeys.map((j) => `src/journeys/${j}.journey.js`)]);
  for (const l of step.live || []) {
    const [file] = l.split(' ');
    run('npx', ['jest', '-c', 'jest.live.config.js', `src/qa/${file}`], file.startsWith('serverOnly') ? { NEARBY_POST_DEPLOY_0364: '1' } : {});
  }
  if (step.sql || step.node || step.edge || step.manual) {
    console.log('also (by hand):', JSON.stringify({ sql: step.sql, node: step.node, edge: step.edge, manual: step.manual }));
  }
  console.log('then: npm run journeys (no prelude)');
  return 0;
}

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error(`FAILED: ${e.message}`); process.exit(1); }
}
module.exports = { STEPS, OTHERS, plan, rollbackFile };
