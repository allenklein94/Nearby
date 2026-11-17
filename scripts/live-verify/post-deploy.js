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
  20270350: { journeys: ['datingConsent', 'appVersionCompatibility'] },
  20270351: { journeys: ['friendDiscoveryChoice', 'trustSafety'] },
  20270352: { journeys: ['gatheringCreationLimits', 'trustSafety'], manual: ['run order Tier 1 item 0(f): a real phone sign-up can still verify and act'] },
  20270353: { journeys: ['sightingExpiry'] },
  20270354: { journeys: ['trustSafety', 'trustSafetyI123'] },
  20270355: { journeys: ['trustSafetyI123'] },
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
  20270418: { journeys: ['webBusinessClaim', 'trustSafety'],
    manual: ['website (unpublished build, owner approval to publish): a new phone account with an approved web application signs in, finishes its profile on the website, and lands on that business; an account without an approved application is linked to nothing'] },
  20270419: { journeys: ['businessServiceArea', 'locationProvenance'],
    manual: ['read-only: 0 rows with location_source = service_area before the first new build; after a test sign-up as "We go to customers": its request + business rows have a 2-decimal point, address null, place ID null; it is absent from the Discover map but listed; no Go now / directions on its preview', 'rollback refuses while any service_area row exists (hint service_area_present): relabel with the owner first'] },
  20270420: { journeys: ['offerScreeningRetry', 'offerJourney'],
    manual: ['deploy screen-business-content from this commit or later together with 0420 (the new code needs _record_offer_screening_unavailable; without it it falls back to plain unavailable = Try again only)',
      'read-only: cron job retry-offer-screening exists, schedule * * * * *; vault service_role_key present (same key the push outbox uses)',
      'on a NON-production project only (a real provider outage cannot be produced on demand): a dedicated test business sends an offer; set that submission to unavailable with next_retry_at in the past; within ~1 min the job publishes it (one result push to the business, one reply push to the customer, one offer row)',
      'with Anthropic credit at 0 (a 400): the submission stays unavailable with Try again, next_retry_at null (never retried)',
      'rollback: unschedules the job; pending tries become plain Try again; redeploy the previous screen-business-content with it'] },
  20270421: { journeys: ['pushTokenInvalidation'],
    edge: ['send-push from this commit or later, right after 0421 (before it the ticket bookkeeping fails quietly and the push is unaffected)'],
    manual: ['read-only: cron job check-push-receipts exists, schedule */5 * * * *; private.push_receipt_checks has no anon/authenticated grant',
      'a normal push to the owner\'s iPhone still arrives; one push_receipt_checks row appears, and is gone ~15-20 min later with the token kept (receipt ok)',
      'on a NON-production project only: a test business owner with a verified email, app deleted from a test phone (Expo reports DeviceNotRegistered only after Apple/Google do, can take minutes to hours); send a business alert: token cleared + exactly ONE email for that alert; the next alert goes straight to email (skipped: no_token)',
      'rollback: unschedules the job, drops the table; cleared tokens stay cleared (re-registered when the app is opened); redeploy the previous send-push with it'] },
  20270422: { journeys: ['businessOfferViewPrivacy', 'offerJourney'],
    manual: ['GATE before deploy: every installed build is newer than 87 (build 87 prints "{viewedCount} viewed" on Offer Performance without the field) AND the business website is re-exported + published from this branch or later',
      'read-only: count(*) from business_request_offers where viewed_at is not null = 0; business_offer_views rows = the receipts moved; constraint business_request_offers_viewed_at_moved present; business_offer_views has no insert/update/delete grant for anon/authenticated',
      'real API (dedicated test accounts): the test business reads its offer row via REST = viewed_at null, business_offer_views = [], get_business_opportunities has no viewed_at key, get_partner_offer_performance has no viewed_count; the test customer reads their own receipt',
      'phone: the customer opens a reply, the business dashboard open on the website shows nothing change (no realtime reload); the customer\'s arrival pill + first-reply wording still behave',
      'rollback: puts every receipt back on the offer row (businesses can read it again) and restores the three functions; build 87-era clients keep working either way'] },
  20270423: { journeys: ['businessProfileAuthorization', 'businessApplication', 'businessServiceArea'],
    manual: ['no build gate: builds <= 87 never read or write the new table or functions; the Phone + website row needs a build after 0423 (or the re-exported website)',
      'read-only: private.business_contact_details has no anon/authenticated grant; count of backfilled rows = businesses with exactly ONE approved application carrying a usable phone/website (Coastal Coffee today: check its application first); brand_partners has no phone/website column',
      'real API (dedicated test accounts): the test business manager saves + re-reads phone/website via get/set_business_contact_details; another signed-in account gets 42501 not_business_manager on both and on update_business_profile / set_business_operating_hours / set_business_location for that business; a direct REST PATCH of brand_partners changes 0 rows; the business rows are byte-identical after the refused calls',
      'website + phone: Profile > Business Profile > Phone + website saves, survives a reload, and shows the same values on the other client',
      'rollback refuses while any contact row exists (hint contact_details_present): export the rows and get the owner\'s approval first (the application copies stay on business_partner_requests)'] },
  20270428: { journeys: ['businessMessageAlerts', 'planMessagePush', 'notificationAction'],
    manual: ['order: number order (after 0427 on the combined tree); redeploy send-push from that tree RIGHT AFTER (new EMAIL_TYPES entry, priority + Reply button, conversation link); without the redeploy the push still goes out (priority medium, no Reply button) but no email is sent for it',
      'no build gate: builds <= 87 show the push and a tap stays where the owner is (unknown type); opening the exact conversation needs a build after 0428 (or the re-exported website)',
      'read-only: trigger zz_alert_business_message on public.business_messages; private.business_message_alert_windows has no anon/authenticated grant; notification_type_groups has business_message_received -> owner_requests',
      'real API (dedicated test customer + test business with two managers, one muted): the customer sends 3 messages in a row through REST -> push_outbox has exactly ONE business_message_received row per unmuted manager, none for the muted one or the customer, data = type + message_id + partner_id only, no text; all 3 messages readable by the business',
      'push on the phone: the manager\'s phone shows "New message from a customer"; the tap (build after 0428) opens Business Mode > Messages on that conversation; Back returns',
      'email WITH Resend configured: a manager with no app (or the website-only test owner) with a verified address gets the email once, link = BUSINESS_WEB_URL?n=business_message_received&r=<message id>&b=<location>; it opens that conversation after sign-in; another account opening the same link sees the plain inbox',
      'email WITHOUT Resend (secrets unset): the push is still queued and delivered; send-push logs "business email alert NOT sent (not_configured)"; the customer\'s message is unaffected',
      'second message within 5 minutes: no new push/email; after 5 minutes: one again',
      'cleanup by recorded ids (messages, followers, outbox rows, test accounts); rollback = scripts/rollback/20270428 (drops trigger + windows table, messages untouched)'] },
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
