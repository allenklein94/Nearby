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
      '(4) native review of ui.businessProfile.verifiedBusiness + verifiedBusinessExplanation (10 languages) before public release (the ui.businessSheet keys were removed 2026-11-02)',
      'RELEASE VERIFICATION for the badge explanation (owner, 2026-11-02; accepted as built, no further changes): (a) iOS bundle export clean from the build commit that carries it; (b) on a real iPhone: tap the badge on the preview sheet + Business Profile = the explanation in place, tap again = hidden, VoiceOver says button + expanded/collapsed, nothing navigates; (c) business website re-exported from that commit and checked in a browser (publish = separate owner approval); the badge ships only in a build made after its branch merges (NOT build 87)'] },
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
    manual: ['BEFORE the deploy approval: a build whose Dating Browse calls browse_dating_candidates on EVERY device (older builds fail closed: Browse shows only people already readable); 0352 + 0363 live; numbers as approved 2026-11-01 (page_max 50, daily_new_profiles 300 distinct new strangers / 24 h, grant_days 7, max_buckets 9; signal settings stay null unless separately approved); prod journeys with the 0348-0382 prelude + an aborted rollback round trip on prod; grants vs prod; website re-exported if any business screen reads people',
      'read-only right after: private.profile_read_limits has one row with the approved numbers; profiles read policy calls viewer_may_read_profile; private.people_rows / dating_candidate_rows / profile_served: no client role; cron job purge-profile-served scheduled',
      'controlled check (owner, dedicated test accounts only): a stranger\'s profile by id = no row; after Browse shows them = readable; Browse page larger than page_max returns page_max; Friends, Dating, contacts and suggested friends still show people on the phone',
      'a stranger readable by id without a reason, a page above page_max, or any account restricted by the limit = security defect: STOP, report'] },
  // Crossed paths only between two people who both chose the same pool (idea 10 follow-up): write guard + read rule + purge
  20270383: { journeys: ['crossedPathsConsent', 'storySightingLocation', 'datingConsent', 'trustSafety', 'profileAntiScraping'],
    manual: ['BEFORE the deploy approval: 0339 + 0352 + 0353 live (0382 before it, in order); prod journeys with the 0348-0383 prelude + an aborted rollback round trip on prod; grants vs prod; count sightings the one-off purge would delete (read-only, rolled back) and report it',
      'read-only right after: trigger aa_sighting_consent_guard on sightings (BEFORE insert/update); sightings read policy calls sighting_pair_visible; private.crossed_paths_pair_allowed EXECUTE: no client role; sighting_pair_visible EXECUTE: authenticated only; cron purge-expired-sightings still scheduled',
      'controlled check (owner, dedicated test accounts only, two phones): both in Dating and near each other = Crossed Paths shows each other + one push each; one account switches to friends-only = the row disappears for both at once and no new crossing is recorded',
      'a sighting readable by someone outside the pair, or a crossing recorded for a person who never opted in = security defect: STOP, report'] },
  // Crossed paths safeguards: own Crossed Paths switch (off by default), crossings grant a profile read only while live and
  // allowed, presence-probe limits; report-presence redeployed WITH it (no matchedCount)
  20270384: { journeys: ['crossedPathsSafeguards', 'crossedPathsConsent', 'sightingExpiry', 'storySightingLocation', 'datingConsent', 'trustSafety', 'profileAntiScraping'],
    manual: ['BEFORE the deploy approval: 0383 live (in order); probe numbers approved by the owner 2026-11-02 as initial values (new cell at most every 30 s, 20 an hour, eligible 10 min; one encounter per pair until its 48 h expiry, never refreshed); a build with the Settings Crossed Paths switch on the phone (older builds have no switch, so nobody can opt in and Crossed Paths records nothing); Privacy Policy paragraph approved by the owner (exact wording, PRODUCT_AUDIT/CROSSED_PATHS_LOCATION_TRUST_2026-11-02.md section 3) and published in the same release; prod journeys with the 0348-0384 prelude + an aborted rollback round trip on prod; grants vs prod; report-presence redeploy ready (same release)',
      'read-only right after: private.crossed_paths_consent / _log / _probe: no client role; set_crossed_paths_sharing + get_my_crossed_paths_sharing EXECUTE: authenticated only; trigger zz_presence_probe_record on presence_reports; viewer_may_read_profile body has the expires_at + crossed_paths_pair_allowed clause; 0 sightings (the one-off purge); report-presence answers {"ok":true} without matchedCount',
      'controlled check (owner, dedicated test accounts only, two phones): both in Dating, only one switch on = nothing recorded; both on and near = Crossed Paths shows each other + one push each; one turns the switch off = the row disappears for both at once and the other can no longer open that profile through it',
      'a crossing recorded or a profile readable through a crossing for someone whose switch is off, or a presence report refused because of the probe record = security defect: STOP, report'] },
  // Gathering review signals (owner idea 11, 2026-11-02): detectors installed, all OFF
  20270385: { journeys: ['gatheringReviewSignals', 'reviewCaseHistory', 'behaviorReviewSignals', 'behaviorSignalThresholds', 'gatheringCreationLimits'],
    manual: ['BEFORE the deploy approval: 0384 live (in order); prod journeys with the 0348-0385 prelude + an aborted rollback round trip on prod; grants vs prod',
      'BEFORE the deploy approval (owner 2026-11-02, after the closed-case fix): the rolled-back state = the pre-0385 originals ITEM FOR ITEM, compared again on a fresh replay AND in the prod aborted rollback (sorted snapshot): private.behavior_evaluate_case byte-identical to 0382\'s, the purge = 0363\'s, the 0382 / 0363 constraints, case_alone_kinds order; any difference = do not deploy, report',
      'read-only right after: a closed behaviour case is never written to by a signal (no new_evidence event on behaviour cases created after the deploy); fresh qualifying signals after a close open a new case with previous_case_id (journey gatheringReviewSignals)',
      'read-only right after: private.gathering_signal_settings all null; private.gathering_cancel_log + gathering_size_marks: no client role, 0 rows; triggers zz_gathering_signal_capacity / _cancel on gatherings, zz_gathering_signal_join on gathering_interest',
      'a gathering create / join / cancel refused or failing because of a detector = defect: STOP, report'] },
  // ... and switched on with the owner's approved starting numbers (2026-11-02, provisional)
  20270386: { journeys: ['gatheringSignalThresholds', 'gatheringReviewSignals'],
    manual: ['BEFORE the deploy approval: 0385 live; 0365 live (review cases on); own approval',
      'read-only right after: gathering_signal_settings = 15 / 60 / 0.5, 3 / 7 / 48, 50 / 25 / 90; case_alone_kinds includes attendee_surge_new, create_cancel, large_public_gathering (not attendee_surge)',
      'rollback = scripts/rollback/20270386_gathering_review_signal_thresholds.rollback.sql (instant, back OFF; cases kept)'] },
  20270387: { journeys: ['screeningOutageAlerts'],
    order: 'D0 screen-business-content (reporting version, with 0372) -> D1 send-push -> D2 0387 -> D3 the other 3 classifier functions -> D4 end-to-end proof (owner approval) -> D5 build with Review Content; see PRODUCT_AUDIT/OFFER_SCREENING_ACTIVATION_CHECKLIST_2026-11-02.md section 7',
    node: ['scripts/replay/screening-outage-concurrency.js (replay only, before the deploy)'],
    edge: ['the screening functions that import _shared/contentClassifier.ts (screen-business-content, resweep-business-content, rewrite-offer-plain-language, create-sponsored-checkout) only report health once redeployed with this code; before 0387 is live a report is a swallowed 404, after it a report opens / closes outages. screen-business-content ships with 0372\'s coordinated release; the others = their own approval',
      'send-push redeploy (new type admin_screening_outage: priority medium + action review_content; until then the type falls back to medium with no action button)'],
    manual: ['read-only right after the deploy: private.screening_outages = 0 rows, private.screening_service_failures = 0 rows; anon / authenticated have no EXECUTE on record_screening_service_result',
      'with 0372 Phase A (owner-approved real screening call): one success records nothing; if screening is still failing, the admin gets ONE "Offer screening is unavailable" push with the right reason, tap opens the held-content queue; the first success sends ONE "working again"',
      'rollback = scripts/rollback/20270387_screening_outage_alerts.rollback.sql (monitoring only; the edge functions keep working: a report becomes a swallowed 404)'] },
  // Business video paused for the first launch (owner 2026-11-02, Option A, temporary): server enforcement on all four tables
  20270388: { journeys: ['businessVideoPaused', 'offerSafety', 'offerJourney', 'gatheringMemory'],
    edge: ['screen-business-content ships in 0372\'s coordinated release; it tolerates 0388 not being live yet (PGRST202 = no early refusal) and the database stays the authority either way'],
    manual: ['BEFORE the deploy approval: 0387 live (in order); prod journeys with the 0348-0388 prelude + an aborted rollback round trip on prod; grants vs prod',
      'read-only right after: private.business_video_settings = one row, enabled false, no client role; business_video_enabled EXECUTE: service_role only; trigger aa_business_video_paused on business_request_offers, business_creatives, business_experiences, stories',
      'REQUIRED BEFORE ANY OUTSIDE BUSINESS IS ONBOARDED (owner 2026-11-02): through the real API, dedicated test business, signed in as its manager, a modified-client call with media_type video to submit_business_offer, the creative path and a direct insert into stories with partner_id = refused with hint business_video_paused and nothing written; the same calls with a photo succeed. A checklist entry alone never counts as the restriction',
      're-enabling = a separate owner-approved migration, only after real video moderation is built and tested (PRODUCT_AUDIT/OFFER_SCREENING_ACTIVATION_CHECKLIST_2026-11-02.md section 8); never by editing the row by hand',
      'rollback = scripts/rollback/20270388_video_offers_paused.rollback.sql (removes the enforcement; defect only, owner decides)',
      'any business video accepted while the switch is off = security defect: STOP, report'] },
  // Business Moments paused for the first launch (owner 2026-11-05, temporary): photos too, server enforced
  20270389: { journeys: ['businessMomentsPaused', 'businessVideoPaused', 'storySightingLocation'],
    manual: ['BEFORE the deploy approval: 0388 live (in order); prod journeys with the 0348-0389 prelude + an aborted rollback round trip on prod; grants vs prod',
      'read-only right after: private.business_moments_settings = one row, enabled false, no client role; trigger ab_business_moments_paused on stories; 0 stories with partner_id and expires_at > now()',
      'REQUIRED BEFORE ANY OUTSIDE BUSINESS IS ONBOARDED (owner 2026-11-05): through the real API, dedicated test business on a plan with Moments, signed in as its manager, a direct insert into stories with partner_id and an image = refused with hint business_moments_paused and nothing written; a person\'s own story still saves',
      're-enabling = a separate owner-approved migration, only after media screening for moments is built and tested; never by editing the row by hand',
      'rollback = scripts/rollback/20270389_business_moments_paused.rollback.sql (moment photos accepted again, unscreened; defect only, owner decides)',
      'any Business Moment accepted while the switch is off = security defect: STOP, report'] },
  // Stories security + launch media policy (owner 2026-11-05): ownership, expiry, types, phone; public + friends-only + video Stories off; covers host-only
  20270390: { journeys: ['storiesSecurity', 'gatheringMemory', 'storySightingLocation'],
    manual: ['BEFORE the deploy approval: 0389 live (in order); prod journeys with the 0348-0390 prelude + an aborted rollback round trip on prod; grants vs prod; read-only: 0 stories with gathering_id set and a non-image media_type (the migration refuses otherwise)',
      'read-only right after: private.story_media_settings = one row, all three false, no client role; triggers ac_story_rules + zz_require_verified_phone on stories; no client UPDATE on stories; both buckets 10 MB, photo types only; 0 personal stories with expires_at > now()',
      'REQUIRED BEFORE EXTERNAL USERS (owner 2026-11-05), through the real API + real Storage API with dedicated test accounts: a story naming another account\'s file = refused (story_media_not_yours) and that file stays unreadable; a sent expires_at is ignored (24 h); public, friends-only and video stories refused; a non-host can\'t sign a cover and sees the category image in the app',
      'friends-only Story photos stay OFF until a separate owner-approved migration, after these checks pass AND a working Story report path exists; public Stories + covers for viewers only after image screening exists; all Story video only after video moderation exists; never by editing the row by hand',
      'build 87 after this deploy: posting a Story fails with a generic error, and the host still sees their own cover while others see the category image; a later build fixes the wording (PRODUCT_AUDIT/PUBLIC_MEDIA_AUDIT_2026-11-05.md section 4)',
      'rollback = scripts/rollback/20270390_stories_security.rollback.sql (reopens the ownership and expiry defects; defect only, owner decides)',
      'any refused case accepted, or any cover or foreign file readable = security defect: STOP, report'] },
  20270391: { journeys: ['mediaReports', 'storiesSecurity', 'gatheringMemory', 'reportReasonCodes'],
    manual: ['Deploy approval must name migration sha256 fc6ab9c7256a7df8d974294ce3469da3d74802a2348d151eac87e7d015e1da8d (accepted as staged only at 0b274052, owner 2026-11-06); a different hash needs a new acceptance', 'BEFORE the deploy approval: 0390 live (in order); prod journeys with the 0348-0391 prelude + an aborted rollback round trip on prod; grants vs prod; Privacy Policy sentence (PRODUCT_AUDIT/PUBLIC_MEDIA_AUDIT_2026-11-05.md section 6) approved, published in the same release',
      'BEFORE the deploy approval, MANDATORY (owner 2026-11-05): inventory every stories file with no row (2 on 2026-11-05), read-only: path, owner folder, size, created_at. The migration queues all of them for PERMANENT deletion on the next hourly run, so deploying IS the deletion. Confirm none is evidence that must be preserved; the owner approves the list; repeat the inventory right before the deploy. Any file that must be kept = STOP: it needs its own preservation step first',
      'BEFORE the deploy approval, MANDATORY (owner 2026-11-05): legal review of evidence retention. The 12-month rule must not automatically apply to suspected child sexual abuse material or content under a legal preservation requirement; those need a specialized, legally reviewed procedure + admin runbook (none exists). Required before outside users',
      'BEFORE the deploy approval, read-only: postgres still has BYPASSRLS, SELECT on storage.objects and net._http_response (checked 2026-11-05: pg_net 0.20.3, all true). Without them "no object row" could read true for a file that exists; the response check still stops a false completion, but deletion would then be reported as failing',
      'read-only right after: content_type check includes story; triggers capture_report_content_story, hold_reported_story_media, report_media_follow_outcome, queue_story_file; the 4 private tables have no client role; private.story_media_settings.storage_url = production\'s /storage/v1; policy "Admins can view reported media"; delete_expired_stories executable by service_role only; admin_story_file_cleanup_status + admin_retry_story_file_cleanup refuse a non-admin',
      'MANDATORY right after deploy (owner 2026-11-05), a migration result proves nothing here: the hourly job really deletes a Storage object on production. With a dedicated test account, post a memory, remove it, wait for two hourly runs (one sends, the next reads the answer), confirm in net._http_response that the DELETE returned 200, the object is gone from storage.objects AND its row left private.story_file_cleanup. Any other status = deletion is not working: STOP, report (the file stays queued and unreadable, nothing leaks). The local fault tests do NOT close this: production Storage accepting the job\'s key has never been exercised',
      'MANDATORY in the first days after deploy: read private.story_file_cleanup_log and private.story_file_cleanup (attempts > 0, gave_up_at); nothing else watches the cron job itself: if the hourly job stops, no alert fires, so check cron.job_run_details for delete_expired_stories at the same time. REQUIRED BEFORE OUTSIDE USERS (owner 2026-11-06): operational monitoring that notices the job has stopped, not only this manual check',
      'REQUIRED BEFORE EXTERNAL USERS, through the real API + real Storage API with dedicated test accounts: a stranger reporting a memory = refused; an attendee report names the poster whatever was sent; the poster can\'t overwrite, delete or move the held file; after the poster removes it only the admin can sign it; a non-host can\'t remove a memory; a no_action resolve closes the file to the admin and it is then deleted',
      'a build with Report + host Remove only AFTER this is live: on an older database the host\'s Remove fails with Try Again (the report itself is kept, filed about the person). Check on a real iPhone + the website after re-export: Report and Remove in the memories viewer, Report on a Story, the photo + Remove Photo on the admin report',
      'friends-only Story photos still need their own owner-approved migration, after these checks pass; public Stories need image screening too; Story video needs video moderation',
      'rollback = scripts/rollback/20270391_media_reports.rollback.sql (a photo report stays as a plain report about the poster; held files stay in the bucket, listed in each report\'s details; the job stops deleting again); defect only, owner decides',
      'any refused case accepted, any held file changed, or any file readable by a non-admin = security defect: STOP, report'] },
  20270392: { journeys: ['objectReports', 'impersonationBusinessReports', 'reportReasonCodes', 'mediaReports'],
    manual: ['read-only right after: content_type check includes gathering + community; trigger capture_report_content_object; private._capture_report_object has no client EXECUTE',
      'REQUIRED BEFORE EXTERNAL USERS, through the real API with dedicated test accounts: a public gathering + community reported without joining; an invite-only gathering, a private community, a fabricated id and your own = refused, and the refusal for a hidden object is identical to an unknown id; a sent reported_id / content_excerpt is replaced; a second report = report_duplicate; edit + delete the object: the admin still reads the original copy',
      'DEPLOY GATE: this migration live + verified BEFORE any build with Report Gathering / Report Community reaches users; on an older database the report files about the host with only the id in its details',
      're-export + publish the business website only with its own approval (Admin Reports + Admin Review show the new types)',
      'a real iPhone: the link on GatheringDetail + CommunityDetail, absent for the host / creator, the sheet offers report only, the already-reported message; native review of ui.reportBlock.reportGathering / reportCommunity / alreadyReported (10 languages machine-authored)',
      'rollback = scripts/rollback/20270392_gathering_community_reports.rollback.sql (each report stays a plain report about the owner, copy kept, id in its details); defect only, owner decides',
      'a hidden object reportable, a forged copy kept or a report changing anything about the host = security defect: STOP, report'] },
  20270393: { journeys: ['contentRemoval', 'objectReports', 'gatheringRowPrivacy', 'mediaReports'],
    manual: ['read-only right after: private.content_removals has no client grants; admin_remove_reported_content + admin_get_report_objects execute for authenticated only; private.content_remove_* and private.refuse_removed_series have no client EXECUTE; cron job purge-content-removal-snapshots listed',
      'REQUIRED BEFORE EXTERNAL USERS, through the real API with dedicated test accounts: an attendee, a community member, an invitee and a stranger each refused for a removal; an admin removes a test gathering + community from a report: all of them, the host and a signed-out invite link get nothing (row, chat, meet-up point, join, check-in); the report keeps its copy; the record says who, when, why; a repeating test gathering stays gone after the generator next runs',
      'a real iPhone: Remove Gathering + Remove Community on Admin Reports, the reason form, the status line afterwards; an attendee with the screen already open: what they see until it reloads, and that its chat refuses a new message; the removal push opens Discover; native review not needed (English admin screen; push words English like the other pushes)',
      're-export + publish the business website only with its own approval (Admin Reports)',
      'rollback = scripts/rollback/20270393_admin_content_removal.rollback.sql: removed objects stay removed; who / when / why goes into each report\'s details; copy private.content_removals out first if the snapshots are still needed; defect only, owner decides',
      'a non-admin able to remove, a removed object reachable by anyone, or a report copy changed = security defect: STOP, report'] },
  20270394: { journeys: ['gatedPerkCancel', 'contentRemoval', 'perkRedemption'],
    manual: ['read-only right after: brand_offers.gate_removed_at exists; brand_offers_unlock_shape_check accepts a gated perk without its id only when gate_removed_at is set; triggers on_community_deleted_deactivate_offer + brand_offer_gate_removed_guard present; authenticated still has UPDATE on brand_offers (active) only',
      'scripts/replay/gated-perk-legal-hold-concurrency.js sections 1-2 passed on a fresh replay before deploy (local only)',
      'through the real API with dedicated test accounts: a host cancels a test gathering with a gated test perk attached (succeeds; the perk is off and stays off); a creator deletes a test community with a gated test perk (succeeds); the paid / unpaid booking rules on cancel unchanged',
      'rollback = scripts/rollback/20270394_gated_perk_gate_removed.rollback.sql: marked perks stay off with their gate cleared; deleting a gathering / community with a gated perk fails again; defect only, owner decides',
      'a cancel or account deletion still refused because of a perk, or a perk active again after its gathering went = defect: STOP, report'] },
  20270395: { journeys: ['legalHolds', 'contentRemoval', 'mediaReports', 'reviewCaseHistory', 'trustSafetyI123'],
    manual: ['read-only right after: private.legal_holds has no client grants; admin_place_legal_hold / admin_release_legal_hold / admin_list_legal_holds execute for authenticated only (anon none); private.report_on_legal_hold / removal_on_legal_hold / case_on_legal_hold / legal_hold_lock have no client EXECUTE; the 3 purge jobs still scheduled',
      'scripts/replay/gated-perk-legal-hold-concurrency.js sections 3-5 passed on a fresh replay before deploy (local only)',
      'through the real API with dedicated test accounts: a non-admin is refused all three functions; an admin places a hold on a test report and releases it with a reason',
      'LEGAL REVIEW (not done): which matters need a hold, who may place and release one, how long the ordinary 12-month periods should be; the mechanism decides none of this and holds nothing by itself',
      'the hold control is in Admin Reports (a later build, not build 87); until that build is on the admin\'s device, holds are placed by an admin calling the functions (signed in as that admin); procedure DRAFT PRODUCT_AUDIT/LEGAL_HOLD_PROCEDURE_2026-11-07.md',
      'rollback = scripts/rollback/20270395_legal_holds.rollback.sql: the hold records go with the table (copy them out first); held evidence becomes purgeable on the next nightly runs; defect only, owner decides',
      'held evidence purged, a hold placed or released by a non-admin, or a hold rewritten = defect: STOP, report'] },
  20270396: { journeys: ['linkSafety', 'ugcModeration'],
    manual: ['BEFORE deploy (owner): a Google Cloud project with billing, the Web Risk API enabled, a NEW API key restricted to the Web Risk API only, set as the edge secret GOOGLE_WEB_RISK_API_KEY (never in chat or Git); a budget alert on that project',
      'deploy together: this migration + the screen-user-content version with the link check (supabase/functions/_shared/linkSafety.ts); 20270373 + its gates first (this changes nothing until 0373 is live)',
      'read-only right after: ugc_links_for_check / claim_link_checks / find_ugc_link_screening / record_ugc_link_screening execute for service_role only; private.link_check_usage + private.ugc_links have no client access; cron job purge-link-check-usage listed',
      'scripts/replay/link-check-budget-concurrency.js passed on a fresh replay before deploy (local only)',
      'through the real API with a dedicated test account: (1) a test gathering whose description has a link and NO screening, written directly = refused link_check_required, nothing written; (2) the same through screen-user-content with a harmless link (e.g. https://example.org) = published; (3) Google\'s own Web Risk test URL (testsafebrowsing.appspot.com/s/phishing.html) = refused link_not_allowed; (4) a bit.ly link = refused (never visited); (5) https://www.google.com/url?q=<the test URL, encoded> = refused link_not_allowed (embedded destination looked up); (6) with the secret unset = 503 link_check_unavailable and a text-only gathering still publishes; then restore the secret; (7) lookup budget forced to 0 for the test account (claim_link_checks refuses) = a link save refused, a text-only save publishes; budget restored',
      'no request to user links (Option B): during (2)-(5) the edge function\'s outbound requests go only to webrisk.googleapis.com (check the function logs / Supabase network logs if available; code guard linkSafetyGuard.test.js); any request to a user-supplied destination = security defect: STOP, report',
      'reconfirm Web Risk pricing + free quota on Google\'s page when the key is created (as of 2026-11-07: 100k Lookup calls/month free, then $0.50 per 1000)',
      'Privacy Policy sentence (links in public text are sent to Google Web Risk to check them) approved + published with the deploy; legal review',
      'rollback = deploy the previous screen-user-content first, then scripts/rollback/20270396_link_safety.rollback.sql: linked text needs only the word screening again; defect only, owner decides',
      'a linked public text published without a link-checked result, a client able to record or find a result, or a URL in a log = security defect: STOP, report'] },
  20270397: { journeys: ['reportFeedback', 'objectReports', 'mediaReports'],
    manual: ['read-only right after: get_my_report_updates() executes for authenticated only (not anon/public); private.report_reporter_status has no client grant; triggers report_status_received + report_status_completed present on public.reports',
      'backfill check: one status row per existing non-automated report with a reporter; resolved reports have completed_at, open ones do not',
      'through the real API with two dedicated test accounts + an admin: (1) A reports B (profile) = "Report received" toast and an Activity row "Report received"; (2) B and a third account see no row; (3) admin resolves it = A\'s Activity shows "Review completed. Thank you for helping keep Nearby safe." and nothing about the outcome, note or B; (4) resolve retry / reopen + resolve again = still ONE completion row, completed time unchanged; (5) no push sent to A for either status',
      'phone (a build with the Activity rows): both statuses render in Activity > Earlier, no tap destination, VoiceOver reads the title + time; native review of ui.activity.reportReceived / reviewCompleted + the reworded ui.reportBlock.reportSubmitted (10 languages)',
      'rollback = scripts/rollback/20270397_report_feedback.rollback.sql: reporters\' statuses go with their table; reports, evidence and the admin workflow untouched; defect only, owner decides',
      'a status readable by anyone but its reporter, any outcome/note/reported account reaching the reporter, or a second completion for one report = defect: STOP, report'] },
  20270398: { journeys: ['unsafeReportReason', 'impersonationBusinessReports', 'reportReasonCodes', 'reportFeedback', 'objectReports'],
    manual: ['DEPLOY GATE: 0398 live + verified BEFORE any app build offering "Unsafe activity or situation" reaches users (on 0370-0397 the database refuses that value: the report would fail with a generic error)',
      'read-only right after: reports_reason_code_check lists unsafe_situation; private.is_urgent_report_reason = harassment, underage_user, unsafe_situation; review_priority = 2 for those three, 1 impersonation, 0 else, for existing rows too; no client grant on the private functions',
      'urgent cap unchanged (private.rate_limit_rules urgent_report 30 / 24 h, new + established) and shared: one dedicated test account files 3 urgent reports of different reasons with a temporary cap of 3 in a rolled-back transaction = the 4th refused',
      'through the real API with dedicated test accounts: the sheet offers the reason on a profile, a message, a gathering, a community, a business and an offer (never on a photo); a report saves as unsafe_situation, the reporter sees "Report received"; Admin Reports shows it "· Urgent" above impersonation, oldest urgent first; nobody is suspended, hidden or notified',
      'native review of ui.reportBlock.reason.unsafe (10 machine-authored languages); phone: the sheet still fits (8 reasons for people)',
      'rollback = scripts/rollback/20270398_unsafe_report_reason.rollback.sql: unsafe_situation rows become "other" with the original reason in details; harassment / underage return to the ordinary queue order; defect only, owner decides',
      'an urgent reason that suspends, hides, removes or notifies anyone, a second urgent allowance per reason, or a client able to set a priority = defect: STOP, report'] },
  20270399: { journeys: ['adminAccountRestrictions', 'trustSafety', 'friendRequestBurstLimit', 'gatheringCreationLimits', 'linkSafety', 'offerSafety'],
    edge: ['screen-business-content right after the migration (asks get_my_account_restriction before screening or queuing; before 0399 the call fails and is ignored, so the function tolerates either order; the database refuses the write either way)'],
    manual: ['read-only right after: 27 zz_refuse_restricted_* triggers; private.account_restrictions + private.account_restriction_events have no client grant; admin_restrict_account / admin_lift_account_restriction / admin_list_account_restrictions execute for authenticated only (not anon/public), the private helpers for nobody; cron job purge-ended-account-restrictions scheduled; 0 restriction rows (nothing is ever created automatically)',
      'through the real API with dedicated test accounts + an admin: (1) a non-admin and the admin on themselves are refused; (2) the admin pauses Messages for 1 day on a test account from a report = that account\'s next message is refused and the app says "Nearby paused this on your account after a review. Available again: <date>. Everything else works as usual."; it can still join a gathering, react, report, block; (3) another account messages it normally; (4) Lift Pause with a reason = the next message goes through; (5) a second Lift = "Already ended"; (6) no push to anyone; (7) the record shows both events with the admin and reasons',
      'each other capability once on a test account (invitations, friend request + Connect, a notice + a wave, create gathering + community, a NEW link in the bio while an existing one may stay, business: post availability as the manager) = refused with the same message; a customer\'s request to a paused business still succeeds (automatic replies keep working: known, documented)',
      'business reply (needs the screen-business-content redeploy, SAME release, deployed right after 0399): the paused manager sends a reply from Make an Offer = told at once with the same message, BEFORE any "sent for review" toast; no screening call spent (check_and_increment_ai_use count unchanged), no business_offer_submissions row, the request row stays pending; after Lift Pause the same reply goes out',
      'legal hold: a restriction decided from a review case or report under an active legal hold is not purged after 12 months (journey adminAccountRestrictions covers it; on prod: read-only check that purge-ended-account-restrictions runs and no held-source restriction was deleted)',
      'Admin Reports (phone + website re-export): Pause Actions on an open report\'s person and on a review case member; the six actions, 1/3/7/14/30 days, reason required (10+); active pauses listed with Lift Pause; nothing shown for a suspended account; native review of ui.shared.errors.accountRestricted (10 machine-authored languages)',
      'rollback = scripts/rollback/20270399_admin_account_restrictions.rollback.sql: every active pause ends at once and the record goes with its tables (copy them out first if needed); nothing else changes; defect only, owner decides',
      'a pause created by anything but an admin\'s call, one that outlives its end, silences or hides anyone, or refuses an action outside its capability = defect: STOP, report'] },
  20270400: { journeys: ['idDocumentRetention', 'legalHolds', 'trustSafety', 'mediaReports'],
    edge: ['delete-account ONLY AFTER the migration is live (the new version no longer removes ID files itself: the database queues them; before 0400 nothing would delete them). Rollback of 0400 = redeploy the previous delete-account FIRST'],
    manual: ['read-only right after: private.id_document_settings.uploads_enabled = false (uploads stay CLOSED: opening them is a separate admin migration with its own approval); private.id_document_cleanup / _cleanup_log / _deletion_log have no client grant; cron job id-document-retention scheduled (41 * * * *); the 4 triggers on id_verification_submissions + profiles exist; id_verification_open / admin_id_document_visible / admin_id_document_cleanup_status / admin_retry_id_document_cleanup execute for authenticated only; production had 0 submissions on 2026-11-07 (re-check: any existing decided row got documents_delete_after from its decision)',
      'through the real API with a dedicated test account: an upload to id-verification is refused while closed (Storage answers 4xx), the submission insert says "ID verification isn\'t available right now"; the app shows that message (no generic error)',
      'real Storage deletion on prod (same gate as 20270391: the job\'s key accepted by prod Storage): only after uploads are opened in a controlled test, an approved test submission past its 7 days (dates moved by a service-role statement) leaves Storage on the next run and the queue only after Storage confirms; a held test submission\'s files stay; release = gone next run (scripts/replay/id-document-storage-api.js proves the same locally)',
      'admin legal hold on an ID submission (Admin Reports > Other legal holds): placing it answers "held" when nothing is on its way, "deleting" when the job already sent the DELETE (pg_net can\'t recall it); scripts/replay/id-document-concurrency.js covers the race locally',
      'reported Story photo (0391 path, send step redefined by 0400): a legal hold on a released reported photo answers "held" with no DELETE then or on a later run, or "deleting" only after the job really sent one; proven locally by scripts/replay/media-report-concurrency.js step 8 (20/20 both orders on a fresh replay), never run on prod; a "held" answer followed by a DELETE = defect: STOP, report',
      'rollback = scripts/rollback/20270400_id_document_retention.rollback.sql (refuses while an id_submission hold is active; released hold records stay); redeploy the previous delete-account first; queued deletions stop with it',
      'a file deleted while pending, held or inside its period, a queue row removed without Storage confirming, or an upload accepted while closed = defect: STOP, report'] },
  20270401: { journeys: ['adminAccountFacts', 'sharedReviewCases'],
    edge: [],
    manual: ['read-only right after: public.admin_get_account_facts(uuid) exists; EXECUTE = authenticated (+ service_role per defaults), never anon; no other object changed',
      'through the real API with a dedicated test account + an admin: a non-admin is refused (admin only); the admin opens a test review case and sees, per account, age + phone verified + New/Established + reports split by state; never a phone number, reporter or report text',
      'website re-export + browser check (Admin Review case) + a later build for Admin Reports (phone): the Account facts block shows, the case actions below it are unchanged; with the function missing (older database) the block is simply absent',
      'rollback = scripts/rollback/20270401_admin_account_facts.rollback.sql (no data involved)',
      'STOP + report: anything written by the read, an account outside the case returned, a non-admin served, or a score / verdict appearing anywhere'] },
  20270402: { journeys: ['heldAccountEvidence', 'legalHolds', 'suspendedNumberRetention'],
    edge: ['delete-account (right AFTER 20270402; this version refuses to delete without the migration, so never deploy it first). ALSO the version to use for 20270400: the copy on the 0400 branch throws after the account is deleted (verificationPaths)'],
    manual: ['before deploy: prod journeys with the 0348-0402 prelude, prod aborted rollback, grants vs prod; Auth role can run the auth.users trigger (as 20270374)',
      'read-only right after: both a_preserve_held_evidence triggers exist; private.held_account_evidence has no client grant; cron purge-held-account-evidence scheduled; private.held_evidence_retention_policy is EMPTY unless a decision from counsel is recorded; the hold-protection trigger on storage.objects exists and Storage API can still delete an unheld file; EXECUTE on account_deletion_preserve_held_evidence = service_role only',
      'read-only right after: report_on_legal_hold + purge_suspended_account_records are the 20270402 versions, and purge-suspended-account-records still runs',
      'controlled test with dedicated test accounts, through the real delete-account function: a held account deletes and its evidence is stored; an unheld account deletes and nothing is stored; the app says the same in both cases',
      'controlled test: a held file survives byte for byte and opens only after admin_open_held_file; a failed removal retries; voice messages and chat photos leave with the account','rollback = redeploy the previous delete-account FIRST, then scripts/rollback/20270402_held_account_evidence.rollback.sql, which refuses while evidence exists: export it and get the owner + counsel decision',
      'STOP + report: a held account deleted with no copy, an unheld account refused or copied, or anything revealing a hold to the person'] },
  20270403: { journeys: ['deletionHardening', 'heldAccountEvidence', 'legalHolds', 'suspendedNumberRetention', 'unsafeReportReason', 'profileAntiScraping'],
    edge: ['delete-account unchanged from the 20270402 step (this branch\'s copy, with generic errors, is the one to deploy there)'],
    manual: ['before deploy: prod journeys with the 0348-0403 prelude, prod aborted rollback, grants vs prod; production\'s Storage version really does skip a row the hold guard refuses and keeps the file (controlled test: the local image is a stand-in)',
      'read-only right after: a_queue_gathering_cover_files + held_evidence_minimize triggers exist; legal_hold_object_guard covers gathering-photos; private.account_deletion_report_files + held_evidence_purge_log have no client grant; held_evidence_retention_policy is EMPTY unless a decision from counsel is recorded',
      'controlled test with dedicated test accounts, through the real delete-account function: a gathering cover leaves with the gathering (cancel + account deletion); a voice message, chat photo, voice intro and replaced photo all leave; a held file stays byte for byte',
      'LAUNCH GATE, not a deploy step: a retention decision is recorded with private.set_held_evidence_retention (first run private.held_evidence_purge_preview with the proposed period), or the owner + counsel record why not. "Kept with no decision" is not a final policy',
      'rollback = scripts/rollback/20270403_deletion_hardening.rollback.sql (refuses while an account hold, a logged purge or a kept/waiting cover exists: export + a decision first); then covers stay behind again',
      'STOP + report: a file removed under an active hold, an unheld cover or personal file kept past the hourly run, a phone number or reporter id in a copy, or anything revealing a hold to the person'] },
  20270404: { journeys: ['adminCaseLinkCount'],
    edge: [],
    manual: ['read-only right after: public.admin_get_case_link_count(uuid) exists; EXECUTE = authenticated (+ service_role per defaults), never anon; no other object changed',
      'through the real API with a dedicated test account + an admin: a non-admin is refused; the admin opens a test review case with a linked reported message and sees the count',
      'website re-export + browser check (Admin Review case): the line + note show above Linked reports; a case with no reported text shows no line',
      'rollback = scripts/rollback/20270404_admin_case_link_count.rollback.sql (no data involved)',
      'STOP + report: anything written by the read, a link or text returned by the function, a non-admin served, or a score / label appearing anywhere'] },
  // Account deletion never refused, never takes other people's plans or the money records with it (owner, 2026-11-08)
  20270405: { journeys: ['accountDeletionBlockers', 'groupBookingLifecycle', 'offerJourney', 'adminAccountRestrictions', 'heldAccountEvidence', 'deletionHardening'],
    node: ['scripts/replay/account-deletion-sweep.js + account-deletion-concurrency.js + held-evidence-function-local.js section F (replay only, before the deploy)'],
    edge: [],
    manual: ['before deploy: prod journeys with the 0348-0404 prelude, prod aborted rollback, grants vs prod; counsel has answered the retention questions in PRODUCT_AUDIT/ACCOUNT_DELETION_BLOCKERS_2026-11-08.md (kept payments are kept with no end date until then)',
      'read-only right after: no no-action or restrict foreign key from any table a deleted account cascades to (query in journey step no_refusing_keys_left); b_account_deletion_release_plans on profiles; a_business_payment_partner + z_business_payment_detached on business_payments; every payment row has partner_id',
      'controlled test with dedicated test accounts, through the real delete-account function + real Stripe test mode: a customer with a real captured test payment deletes; the payment row stays, no person on it; a refund in Stripe test mode still lands on it. An organizer of a booked group plan deletes on a phone: the next person gets the push, opens the plan, the booking is there',
      'rollback = scripts/rollback/20270405_account_deletion_blockers.rollback.sql (refuses while kept payments or cleared rows exist: they record real deletions; export + a decision first)',
      'STOP + report: an account deletion refused for any reason but a recorded hold-copy failure, a captured payment gone, a person\'s id, location or dietary need left on anything kept, or a plan with nobody organizing it'] },
  // An account deleted with an unresolved report, open case or active pause keeps one limited record; the number or device coming back opens a private case (owner, 2026-11-08)
  20270406: { journeys: ['deletedAccountUnresolved', 'suspendedNumberRetention', 'reviewCaseHistory', 'heldAccountEvidence', 'deletionHardening', 'sharedDeviceSignal'],
    node: ['scripts/replay/deleted-account-concurrency.js + held-evidence-function-local.js section G (replay only, before the deploy)'],
    edge: [],
    manual: ['BEFORE final deploy approval: counsel has approved the 90-day period and the Privacy Policy wording (PRODUCT_AUDIT/DELETED_ACCOUNT_RETENTION_2026-11-08.md); a different period = private.set_unresolved_account_retention with the decision\'s reference, right after the deploy and before any deletion',
      'BEFORE final deploy approval: private.phone_match_secret in the same secret review as 20270374 (this keeps number keys for more accounts)',
      'website re-export + browser check (Admin Review): a test case about a deleted account shows Deleted account + what was kept; a returned-account case shows the note; an open report about a deleted account offers What was kept',
      'read-only right after: 0 unresolved_account_records; cron job purge-unresolved-account-records active; no client grant on the 4 private tables; admin_get_deleted_account_record EXECUTE = authenticated (+ service_role per defaults), never anon',
      'controlled test with dedicated test accounts + a real phone number: an account with an open report deletes through the real function; the deletion looks the same; the number signs up again through real SMS; within 10 minutes one private case; the person sees nothing',
      'rollback = scripts/rollback/20270406_deleted_account_unresolved_records.rollback.sql (refuses while records or kept cases exist: they record real deletions; export + a decision first)',
      'STOP + report: a deletion that fails or looks different because of a record; a number, email, name, attendee or message in a record; a returning person restricted, refused or told; a record or key past its date without a hold'] },
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
