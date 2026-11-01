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
  // Offer safety: every screened business write needs its own unconsumed low-risk screening result; contact info refused in offer text
  20270372: { journeys: ['offerSafety', 'offerJourney', 'availabilityNoBroadcast', 'exclusivePostingRequest'],
    edge: ['screen-business-content (right after the migration; until it is live, package saves are refused (the old version has no package branch) and other screened business writes may be refused: check one reply + one posting after both)'],
    node: ['scripts/replay/screening-single-use-concurrency.js + reschedule-reply-concurrency.js (replay only, before the deploy)'],
    manual: ['read-only: 0 screening results consumed right after the deploy; a direct submit_business_offer / post_business_availability call as a business owner (dedicated test account) = refused screening_required, nothing written',
      'Report this offer on a real reply (phone): one report, reported_id = the business manager, content captured'] },
  // User-content screening: public text bound to its screening; held review; group chat screened after sending
  20270373: { journeys: ['ugcModeration', 'gatheringRowPrivacy', 'trustedWriteScope', 'interestedPrivacy'],
    edge: ['screen-user-content BEFORE the migration (until 0373 is live it answers not_installed and the app keeps today\'s check); never after it (the app would refuse every public save as unavailable in between)'],
    node: ['scripts/replay/ugc-moderation-concurrency.js (replay only, before the deploy)',
      'scripts/trust-safety/ugc-calibration.js run (real classifier, controlled environment, owner-approved): its per-language results decide the separate calibration migration; until it runs every language is held for a person'],
    live: ['ugcScreeningSignedIn.live.js (NEARBY_POST_DEPLOY_0373=1)'],
    manual: ['BEFORE: every device on a build that screens through screen-user-content (build 87 does not: its profile / gathering / community / Q&A / comment saves would be refused)',
      'read-only right after: 0 ugc_screenings, 0 held items, cron jobs screen-group-chat + purge-ugc-moderation present; one profile save + one gathering on the phone (dedicated test account) publish or are held as the calibration says',
      'one community chat message from the test account is screened within ~2 minutes (queue row done); a person reviews the admin queue'] },
  // Suspended-number retention: a suspended account's number kept as a keyed hash for 12 months; a re-registration = a private case
  20270374: { journeys: ['suspendedNumberRetention', 'reviewCaseHistory', 'trustSafety', 'signupPhoneOnlyHook'],
    node: ['scripts/replay/suspended-number-concurrency.js + scripts/replay/suspended-number-auth-local.js (replay / isolated real Auth only, before the deploy)'],
    live: ['suspendedNumberSignedIn.live.js (NEARBY_POST_DEPLOY_0374=1; read-only)'],
    manual: ['BEFORE final deploy approval: the focused security review of private.phone_match_secret (roles, exposed APIs, backups, logs; inside vs outside the database) recorded in PRODUCT_AUDIT/TRUST_SAFETY_FIXES_2026-10-27.md',
      'BEFORE: the Privacy Policy sentence (PRODUCT_AUDIT/TRUST_SAFETY_FIXES_2026-10-27.md, last section) approved, published with the deploy',
      'read-only right after: private.phone_match_secret has 1 row of 32 bytes; 0 suspended_account_records (no account has ever been suspended on prod), 0 suspended_number_failures; cron jobs match-suspended-numbers + purge-suspended-account-records present; triggers zz_retain_suspended_account + zz_queue_phone_match on auth.users',
      'a normal phone sign-in on the phone still works (Auth unaffected); the next match run leaves the queue empty',
      'controlled end to end (owner present, two dedicated test numbers, never a real person\'s): suspend test account A (admin_suspend_user), delete it through the app, sign up again with A\'s number by real SMS: sign-up works as usual, the account is NOT restricted, within 10 minutes one prior-suspension case appears for an admin on the website with the earlier decision and no number; close it; then clean up (the record stays 12 months by design: record its id)',
      'any failure row, any visible difference at sign-up, or any client read that answers = security defect: STOP, report'] },
  // Account takeover through a phone number: phone-only accounts never gain a password/email; number change waits 24 h after a sign-in; one security notice
  20270375: { journeys: ['accountTakeoverProtection', 'suspendedNumberRetention', 'signupPhoneOnlyHook', 'trustSafety'],
    node: ['scripts/replay/account-takeover-auth-local.js (replay + isolated real Auth only, before the deploy)'],
    live: ['accountTakeoverSignedIn.live.js (NEARBY_POST_DEPLOY_0375=1)'],
    manual: ['BEFORE: every device on a build that asks get_my_phone_change_wait before a number change (older builds still work: the change is simply not saved within 24 h of a sign-in and their code step fails with Auth\'s own error)',
      'read-only right after: triggers aa_account_takeover_guard + zz_account_phone_changed_notice on auth.users, zz_account_new_sign_in on auth.sessions; cron purge-account-security-events present; 0 guard_failure events',
      'on the phone (dedicated test account): sign in by real SMS on a second device while the first is signed in = ONE "New sign-in" push on the first; Settings > Sign Out on the first ends the second (its next refresh fails)',
      'a normal phone sign-in, refresh and sign-out still work; the dedicated email test account still signs in by password; review-login (applereview) still signs in',
      'production sends codes through Twilio Verify (the local test used Auth\'s test OTP): with a dedicated test phone account, Settings > change number right after signing in = the wait message, no code sent; and (owner present, two test numbers) a number change from an account signed in > 24 h works and sends ONE "number changed" push',
      'any guard_failure row, any phone-only account that gains a password or email, or a client read that answers = security defect: STOP, report'] },
  // Shared device notification token across accounts: keyed hash only, private admin-review case, never restricts; OFF until a separate activation migration
  20270376: { journeys: ['sharedDeviceSignal', 'reviewCaseHistory', 'pushTokenPrivacy', 'suspendedNumberRetention', 'trustSafety'],
    node: ['scripts/replay/shared-device-concurrency.js (replay only, before the deploy)'],
    manual: ['BEFORE final deploy approval: private.device_signal_secret included in the same secret review as 20270374 (who can read the private schema, backups, logs)',
      'BEFORE activation (a separate migration, owner-approved numbers, runs private.backfill_device_sightings() once): the Privacy Policy sentence (PRODUCT_AUDIT/TRUST_SAFETY_FIXES_2026-10-27.md, shared-device section) approved + published',
      'read-only right after: device_signal_secret 1 row of 32 bytes; settings shared_device_min_accounts null + shared_device_suspended_enabled false; 0 device_sightings, 0 suspended_device_keys, 0 device_signal_failures; cron purge-device-sightings present; triggers zz_push_token_sighting (private.push_tokens), zz_suspension_device_check (profiles), zz_keep_suspended_device_keys (auth.users)',
      'push still delivered: one real test push to the owner\'s iPhone arrives after the deploy (the trigger runs after every token write)',
      'after activation: the owner\'s iPhone carries 3 accounts on ONE token = expect ONE many_accounts case if the threshold is 3 (expected, close it as "one person, several accounts"); any failure row or client read that answers = security defect: STOP, report'] },
  // Friend-request burst limit: 5 per rolling 10 minutes at both levels, beside the unchanged 15 per local day; refuses that one request, never restricts
  20270377: { journeys: ['friendRequestBurstLimit', 'trustSafety', 'trustedWriteScope', 'forgedFlagLimits'],
    node: ['scripts/replay/friend-request-concurrency.js (replay only, before the deploy)'],
    manual: ['read-only right after: 2 private.rate_limit_rules rows (friend_request, new + established, 600 s, 5); triggers zz_rate_limit_friend_request (before insert) + zz_log_friend_request + on_friend_request_count_daily (after insert) on friendships; on_friend_request_enforce_limit still enabled; enforce_friend_request_daily_limit raises hint friend_request_daily_limit; 0 friend_request log rows',
      'on the phone: one ordinary friend request from Friends or a profile still sends ("Friend request sent"); a 6th within 10 minutes (dedicated test accounts only, never real people) shows "You\'ve sent several friend requests in a short time. Please wait a few minutes and try again." with no Try Again',
      'on the phone, app set to a non-English language (dedicated test account at 15 today, never real people): the 16th request shows the daily sentence in that language (e.g. es "Puedes enviar hasta 15 solicitudes de amistad por día. Inténtalo de nuevo mañana."), never the English server text, no Try Again; needs a build with the friend_request_daily_limit mapping (NOT build 87: build 87 keeps showing the English text, as today)',
      'any request refused below 5 in 10 minutes, or a refusal that restricts / suspends the account = defect: STOP, report'] },
  // The same public text (bio / public gathering description) on several accounts: keyed hash only, private admin-review case, never restricts; OFF until a separate activation migration
  20270378: { journeys: ['sharedPublicText', 'reviewCaseHistory', 'ugcModeration', 'sharedDeviceSignal', 'trustSafety'],
    node: ['scripts/replay/shared-text-concurrency.js (replay only, before the deploy)'],
    manual: ['BEFORE final deploy approval: private.text_signal_secret included in the same secret review as 20270374 / 20270376 (fingerprints + secret unreachable by any client role, secret outside client-reachable objects); prod journeys with the 0348-0378 prelude + an aborted rollback round trip on prod; grants vs prod',
      'BEFORE activation (a separate migration, owner-approved numbers, runs private.backfill_shared_text_sightings() once): the 5-accounts / 30-days starting point validated against legitimate shared text (recurring meetups, co-organisers, a club\'s standard description); known templates listed with private.exclude_shared_text; the Privacy Policy sentence (PRODUCT_AUDIT/TRUST_SAFETY_FIXES_2026-10-27.md, shared-text section) approved + published',
      'read-only right after: text_signal_secret 1 row of 32 bytes; settings shared_text_min_accounts null (min_chars 80, min_words 12); 0 text_sightings, 0 shared_text_excluded_keys, 0 text_signal_failures; cron purge-text-sightings present; triggers zz_profile_bio_sighting (profiles) + zz_gathering_description_sighting (gatherings)',
      'on the phone: saving a profile bio and publishing a public gathering with a description still work exactly as before (the triggers run after every such write)',
      'any failure row, any restricted / hidden account, or a client read that answers = security defect: STOP, report'] },
  // Shared review cases: read-only admin view of the other existing review cases an account is in (direct links only); stores nothing, changes nothing
  20270379: { journeys: ['sharedReviewCases', 'reviewCaseHistory', 'sharedDeviceSignal', 'sharedPublicText'],
    manual: ['read-only right after: public.admin_get_shared_review_cases(uuid) exists, security definer, stable; EXECUTE = authenticated only (anon + public none)',
      'signed-in real API, dedicated NON-admin test account: admin_get_shared_review_cases refuses with hint admin_only (gated test: NEARBY_POST_DEPLOY_0379=1 npx jest -c jest.live.config.js src/qa/sharedReviewCasesSignedIn.live.js)',
      'on the business website (after the website is re-exported with this screen, own approval): an admin opening a case sees "Shared review cases"; a linked case opens in place; no account changes',
      'any answer to a non-admin, or any row written by the call = security defect: STOP, report'] },
  // Duplicate-photo detection activation: near-duplicates on at the owner's 10/10 (exact copies already on from 0358)
  20270380: { journeys: ['photoDetectionActivation', 'reviewCaseHistory', 'trustSafetyI123'],
    node: ['scripts/replay/review-case-concurrency.js (replay only, before the deploy; step 6 = activation race)',
      'NEARBY_PHOTO_DETECTION_APPROVAL=photo-detection-sweep node scripts/trust-safety/photo-detection-switch.js sweep --target=prod (ONCE, right after: judges photos recorded while the activation transaction was open)'],
    manual: ['BEFORE the deploy approval: 0357 + 0358 + 0368 + 0369 live, moderate-photo redeployed (hashing), fingerprint-existing-photos.js run (dry run first) so photos uploaded earlier are fingerprinted; prod journeys with the 0348-0380 prelude + an aborted rollback round trip on prod; grants vs prod; the photo Privacy Policy sentence approved + published; website re-exported with AdminReviewScreen (0369) so an admin can actually review',
      'read-only right after: node scripts/trust-safety/photo-detection-switch.js status --target=prod = min_accounts 3, name_similarity 0.5, max_dhash 10, max_phash 10, activation_installed true; private.evaluate_existing_photo_signals() EXECUTE: no client role and not service_role',
      'controlled check (owner, test accounts only): the same test photo on 3 dedicated test accounts opens ONE private case in the admin queue; an admin closes it "No action needed"; none of the accounts is hidden, suspended or notified; then delete the test accounts (the case stays as history)',
      'monitoring: a weekly look at the photo cases (count, how many closed "No action needed"); many legitimate matches = turn near-duplicates off (switch "off") and report, never change the numbers without approval',
      'any account restricted / hidden / notified by a photo case, or a client that can read a case = security defect: STOP, switch off, report'] },
  // Impersonation as its own (prioritized, not urgent) report reason + "Report business" (about the business itself, nobody named)
  20270381: { journeys: ['impersonationBusinessReports', 'reportReasonCodes', 'offerSafety', 'reviewCaseHistory'],
    manual: ['BEFORE the deploy approval: 0355 + 0370 + 0372 live; prod journeys with the 0348-0381 prelude + an aborted rollback round trip on prod; grants vs prod; RELEASE GATE (owner 2026-11-01): no app build containing "Report business" is released to users until 0381 is deployed AND this step has passed (older builds keep working: they never send the new reason or type)',
      'read-only right after: reports_reason_code_check includes impersonation; reports_content_type_check includes business; reports.review_priority exists (generated); trigger capture_report_content_business present; private._capture_report_business EXECUTE: no client role',
      'controlled check (owner, dedicated test accounts only): report a test business from the phone = one open report with reported_id NULL and the business copy; the business owner sees nothing and is not suspended; an impersonation report sorts first in the admin queue; resolve both',
      'a business report that names a person, a business owner who can read it, or any automatic restriction = security defect: STOP, report'] },
  // People anti-scraping (idea 9, option B): one profile read rule + capped discovery functions + daily new-profile count
  20270382: { journeys: ['profileAntiScraping', 'profileColumnPrivacy', 'intentionCountPrivacy', 'datingConsent', 'appVersionCompatibility', 'trustSafety'],
    node: ['scripts/replay/profile-serve-concurrency.js (replay only, before the deploy)'],
    manual: ['BEFORE the deploy approval: a build whose Dating Browse calls browse_dating_candidates on EVERY device (older builds fail closed: Browse shows only people already readable); 0352 + 0363 live; numbers approved (page_max, daily_new_profiles, grant_days, max_buckets; signal settings stay null unless separately approved); prod journeys with the 0348-0382 prelude + an aborted rollback round trip on prod; grants vs prod; website re-exported if any business screen reads people',
      'read-only right after: private.profile_read_limits has one row with the approved numbers; profiles read policy calls viewer_may_read_profile; private.people_rows / dating_candidate_rows / profile_served: no client role; cron job purge-profile-served scheduled',
      'controlled check (owner, dedicated test accounts only): a stranger\'s profile by id = no row; after Browse shows them = readable; Browse page larger than page_max returns page_max; Friends, Dating, contacts and suggested friends still show people on the phone',
      'a stranger readable by id without a reason, a page above page_max, or any account restricted by the limit = security defect: STOP, report'] },
};

// Edge functions and Auth settings staged alongside (not migrations): rollback + check for each.
const OTHERS = {
  'review-login': { rollback: 'redeploy the live v6 bundle (git show fd484fcc:supabase/functions/review-login/index.ts, with REVIEWER_EMAIL set)',
    check: 'REVIEWER_EMAIL set FIRST; App Review number signs in once with the PIN; 6 wrong PINs from one address = the 6th refused (429); src/utils/reviewLoginConcurrency.test.js covers parallel guesses' },
  'report-presence': { rollback: 'redeploy the live bundle as recovered (git show 582c727e^:supabase/functions/report-presence/index.ts)',
    check: 'a normal presence report still 200; behaviorReviewSignals location block on prod' },
  'moderate-photo': { rollback: 'redeploy the live bundle recovered 2026-10-28 (or the 0349 version)', check: 'journey photoScreeningBinding; a real photo upload on the phone is screened; with 0368 live, private.photo_perceptual_hashes gets 6 rows for that photo (read-only count)' },
  'photo-detection-switch': { rollback: 'NEARBY_PHOTO_DETECTION_APPROVAL=photo-detection-off node scripts/trust-safety/photo-detection-switch.js off --target=prod (instant; near-duplicates only; add --all to stop exact copies too; open cases stay for review)',
    check: 'status --target=prod shows the numbers off; a new test photo copy opens nothing; back on only with the code from status (own approval), which re-judges existing photos in a separate transaction' },
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
