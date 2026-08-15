#!/usr/bin/env node
// 10/10 roadmap Part 8: real, repeatable live-verify script for the
// "double-review race" on approve_gathering_interest() -- the exact bug
// Part 3's architecture-hardening pass fixed (20260815_architecture_
// hardening_race_fixes.sql). A retried/double-tapped approve on an
// already-approved interest row must be rejected, never silently
// re-processed (which, at exactly-at-capacity, could previously demote an
// already-approved attendee back to 'waitlisted').
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/gathering-approve-double-review.js
const { runSql, runSqlAs, assert, summarize } = require('./lib/db');

async function main() {
  console.log('gathering-approve-double-review: verifying approve_gathering_interest() rejects a second review...');

  const profiles = await runSql(`select id from profiles order by created_at limit 2;`);
  if (!profiles || profiles.length < 2) {
    throw new Error('Needs at least two real profiles in this environment.');
  }
  const [host, attendee] = profiles;
  const userA = host.id < attendee.id ? host.id : attendee.id;
  const userB = host.id < attendee.id ? attendee.id : host.id;

  // Capture whatever match state already exists between this pair BEFORE
  // touching anything -- approve_gathering_interest()'s own `insert ...
  // on conflict (user_a, user_b) do update set source_gathering_id = ...
  // where matches.source_gathering_id is null` can silently adopt a real
  // pre-existing match (one with a null source_gathering_id) into this
  // test run. This file's own history (CLAUDE.md's Capacity/Waitlist
  // section) already documented exactly this mistake once -- a
  // filter-by-source_gathering_id cleanup deleting real production rows
  // it had unintentionally retargeted -- so this script restores the
  // exact prior state instead of a blind delete-by-filter.
  const [preExisting] = await runSql(`select id, source_gathering_id from matches where user_a = '${userA}' and user_b = '${userB}';`);

  let gatheringId, interestId;
  try {
    const [gathering] = await runSql(`
      insert into gatherings (title, area, scheduled_at, host_id, capacity, is_public, interest_tag, precise_lat, precise_lng)
      values ('live-verify: double-review test', 'test-area', now() + interval '2 hours', '${host.id}', 2, false, 'Coffee', 40.0, -75.0)
      returning id;
    `);
    gatheringId = gathering.id;

    const [interest] = await runSql(`
      insert into gathering_interest (gathering_id, user_id, status)
      values ('${gatheringId}', '${attendee.id}', 'pending')
      returning id;
    `);
    interestId = interest.id;

    const first = await runSqlAs(host.id, `select approve_gathering_interest('${interestId}') as result;`);
    assert(first?.[0]?.result?.status === 'approved', 'first approve_gathering_interest() call approves the pending request');

    let secondRejected = false;
    let secondMessage = '';
    try {
      await runSqlAs(host.id, `select approve_gathering_interest('${interestId}') as result;`);
    } catch (e) {
      secondRejected = true;
      secondMessage = e.message;
    }
    assert(secondRejected, `second approve_gathering_interest() call on the same interest row is rejected (got: ${secondRejected ? secondMessage : 'no error -- this is the bug'})`);

    const [afterSecond] = await runSql(`select status from gathering_interest where id = '${interestId}';`);
    assert(afterSecond?.status === 'approved', 'interest row is still exactly "approved", not demoted by the rejected second call');
  } finally {
    // Restore the match row to its exact pre-test state rather than a
    // blanket delete-by-filter -- see the comment above on why.
    if (preExisting) {
      await runSql(`update matches set source_gathering_id = ${preExisting.source_gathering_id ? `'${preExisting.source_gathering_id}'` : 'null'} where id = '${preExisting.id}';`).catch(() => {});
    } else {
      await runSql(`delete from matches where user_a = '${userA}' and user_b = '${userB}';`).catch(() => {});
    }
    if (interestId) await runSql(`delete from gathering_interest where id = '${interestId}';`).catch(() => {});
    if (gatheringId) await runSql(`delete from gatherings where id = '${gatheringId}';`).catch(() => {});
    console.log('  (cleanup) test gathering/interest rows deleted; match row restored to its pre-test state');
  }

  summarize('gathering-approve-double-review');
}

main().catch((e) => {
  console.error('gathering-approve-double-review: script itself failed to run:', e.message);
  process.exitCode = 1;
});
