#!/usr/bin/env node
// Phase 1 item 2 of the "Scorecard to 10" plan (see CLAUDE.md): the
// concurrent counterpart to gathering-approve-double-review.js. That
// script proves the invariant under a *sequential* replay; this one uses
// the real concurrency harness (lib/concurrency.js) to force two
// approve_gathering_interest() calls on the exact same interest row to
// genuinely overlap in Postgres, proving the row lock actually
// serializes them rather than merely being present in the SQL text.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/gathering-approve-double-review-concurrent.js
const { runSql, assert, summarize } = require('./lib/db');
const { runOverlapping, asUser } = require('./lib/concurrency');

async function main() {
  console.log('gathering-approve-double-review-concurrent: verifying approve_gathering_interest()\'s row lock serializes two genuinely concurrent approves...');

  const profiles = await runSql(`select id from profiles order by created_at limit 2;`);
  if (!profiles || profiles.length < 2) {
    throw new Error('Needs at least two real profiles in this environment.');
  }
  const [host, attendee] = profiles;
  const userA = host.id < attendee.id ? host.id : attendee.id;
  const userB = host.id < attendee.id ? attendee.id : host.id;

  // Same "restore, don't blindly delete" caution as the sequential
  // script -- see that file's own comment for the real prior incident
  // this guards against.
  const [preExisting] = await runSql(`select id, source_gathering_id from matches where user_a = '${userA}' and user_b = '${userB}';`);

  let gatheringId, interestId;
  try {
    const [gathering] = await runSql(`
      insert into gatherings (title, area, scheduled_at, host_id, capacity, is_public, interest_tag, precise_lat, precise_lng)
      values ('live-verify: concurrent double-review test', 'test-area', now() + interval '2 hours', '${host.id}', 2, false, 'Coffee', 40.0, -75.0)
      returning id;
    `);
    gatheringId = gathering.id;

    const [interest] = await runSql(`
      insert into gathering_interest (gathering_id, user_id, status)
      values ('${gatheringId}', '${attendee.id}', 'pending')
      returning id;
    `);
    interestId = interest.id;

    const holderQuery = asUser(host.id, `
      begin;
      select id from gathering_interest where id = '${interestId}' for update;
      select pg_sleep(2);
      select approve_gathering_interest('${interestId}') as result;
      commit;
    `);
    const racerQuery = asUser(host.id, `
      select approve_gathering_interest('${interestId}') as result;
    `);

    const { holder, racer } = await runOverlapping({ holderQuery, racerQuery, racerDelayMs: 900 });

    assert(holder.ok, `holder's approve call succeeded (${holder.ok ? '' : holder.error?.message})`);
    assert(!racer.ok, `racer's genuinely-concurrent approve call on the same already-locked interest row was rejected, not silently re-processed (${racer.ok ? 'it succeeded -- this is the bug' : racer.error?.message})`);
    assert(
      racer.elapsedMs > 1500,
      `racer's call was genuinely blocked at the Postgres level (took ${racer.elapsedMs}ms total wall time from test start, ` +
      `well past its own ~900ms fire time -- proving it queued behind the holder's lock)`
    );
    if (!racer.ok) {
      assert(
        /already been reviewed/i.test(racer.error?.message || ''),
        `racer's rejection message is the real "already been reviewed" guard, not some unrelated error (got: ${racer.error?.message})`
      );
    }

    const [afterInterest] = await runSql(`select status from gathering_interest where id = '${interestId}';`);
    assert(afterInterest?.status === 'approved', `interest row is exactly "approved", not demoted/corrupted by the blocked racer (got: ${afterInterest?.status})`);

    const [matchCount] = await runSql(`select count(*) as c from matches where user_a = '${userA}' and user_b = '${userB}';`);
    assert(String(matchCount?.c) === '1', `exactly one match row exists for this pair, not duplicated by the race (got count: ${matchCount?.c})`);
  } finally {
    if (preExisting) {
      await runSql(`update matches set source_gathering_id = ${preExisting.source_gathering_id ? `'${preExisting.source_gathering_id}'` : 'null'} where id = '${preExisting.id}';`).catch(() => {});
    } else {
      await runSql(`delete from matches where user_a = '${userA}' and user_b = '${userB}';`).catch(() => {});
    }
    if (interestId) await runSql(`delete from gathering_interest where id = '${interestId}';`).catch(() => {});
    if (gatheringId) await runSql(`delete from gatherings where id = '${gatheringId}';`).catch(() => {});
    console.log('  (cleanup) test gathering/interest rows deleted; match row restored to its pre-test state');
  }

  summarize('gathering-approve-double-review-concurrent');
}

main().catch((e) => {
  console.error('gathering-approve-double-review-concurrent: script itself failed to run:', e.message, e.body ? JSON.stringify(e.body) : '');
  process.exitCode = 1;
});
