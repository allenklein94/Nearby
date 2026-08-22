#!/usr/bin/env node
// 10/10 roadmap Part 8: runs every scripts/live-verify/*.js check in
// sequence (not in parallel -- several of these scripts touch the same
// small set of real profiles/tables, and running them one at a time
// avoids any cross-script race on the shared live database). Exits
// non-zero if any script reported a failure.
const { spawnSync } = require('child_process');
const path = require('path');

const SCRIPTS = [
  'business-offer-double-accept.js',
  'business-offer-double-accept-concurrent.js',
  'gathering-approve-double-review.js',
  'gathering-approve-double-review-concurrent.js',
  'business-request-expiry-and-decline.js',
  'business-request-duplicate-submission.js',
  'friend-discovery-swipe-race-concurrent.js',
  'is-blocked-hides-blocker-from-blocked-party.js',
  'group-plan-confirm-offer-quorum-race-concurrent.js',
  'group-plan-cross-proposal-exclusivity-concurrent.js',
  'business-acquisition-funnel-e2e.js',
  'business-acquisition-unauthorized-access.js',
  'offer-reservation-payment-seam.js',
  'business-fulfillment-policy-auto-accept.js',
  'social-offer-group-plan.js',
  'date-proposal-business-request.js',
  'offer-system-prove-the-loop.js',
  'intent-match-business-discovery.js',
  'match-contacts-rate-limit.js',
];

// A real, empirically-hit gotcha, not a guess: running the full suite back-to-back with no
// gap between scripts started returning `ThrottlerException: Too Many Requests` from the
// Management API partway through a 12-script run (the suite's own cumulative request volume,
// not any single script) -- found while adding the two Business Partner acquisition scripts.
// A short pause between scripts avoids it without weakening any individual script's own
// checks.
//
// Bumped from 2000ms -> 4000ms after adding a 13th script
// (offer-reservation-payment-seam.js, "The Offer System" Phase 1): the 12-script suite's own
// cumulative request volume was already right at the throttle's edge, and this script's own
// ~25 sequential queries pushed a full run-all.js pass over it, confirmed live (the 13-script
// run threw ThrottlerException on this exact script, twice, at 2000ms spacing; standalone runs
// of the same script also throttled until a real ~30s wait was given). Real, disclosed residual
// gap, not fixed this pass: each script's own `finally` cleanup wraps every delete in
// `.catch(() => {})` (matching this codebase's own "cleanup failure is non-fatal" convention),
// so if a throttle exception lands mid-cleanup, the swallowed delete leaves a real orphaned
// test row behind -- happened once, live, during this exact throttled run (3 disposable
// business_requests/business_request_offers rows survived a throttled offer-reservation-
// payment-seam.js pass and had to be found and deleted by hand). A future throttled run could
// do the same; the fix here (a longer gap) reduces how often that can happen but doesn't make
// cleanup itself throttle-proof.
//
// Bumped again, 4000ms -> 6000ms, after adding two more scripts (intent-match-business-
// discovery.js, match-contacts-rate-limit.js) pushed the suite to 19 scripts: a full run-all.js
// pass threw ThrottlerException starting at date-proposal-business-request.js (script #17),
// confirmed live -- and hit the exact disclosed residual gap named above for real, not just in
// theory: a throttled cleanup left one real orphaned date_proposals row behind, found and
// deleted by hand afterward. Same fix as last time, same disclosed limitation still standing.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runAll() {
  let anyFailed = false;
  for (const script of SCRIPTS) {
    console.log(`\n=== ${script} ===`);
    const result = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit' });
    if (result.status !== 0) anyFailed = true;
    await sleep(6000);
  }

  if (anyFailed) {
    console.error('\nrun-all: one or more live-verify scripts failed.');
    process.exitCode = 1;
  } else {
    console.log('\nrun-all: all live-verify scripts passed.');
  }
}
runAll();
