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
];

let anyFailed = false;
for (const script of SCRIPTS) {
  console.log(`\n=== ${script} ===`);
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], { stdio: 'inherit' });
  if (result.status !== 0) anyFailed = true;
}

if (anyFailed) {
  console.error('\nrun-all: one or more live-verify scripts failed.');
  process.exitCode = 1;
} else {
  console.log('\nrun-all: all live-verify scripts passed.');
}
