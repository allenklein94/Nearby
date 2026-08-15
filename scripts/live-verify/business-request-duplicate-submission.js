#!/usr/bin/env node
// 10/10 roadmap Part 8: real, repeatable live-verify script for the
// "duplicate submission" failure mode -- create_business_request()'s own
// spam guard (20260814_business_fulfillment_spam_guard.sql): a second,
// literal-duplicate ask from the same requester while the first is still
// open must return the SAME request id, not create a second row and
// re-run the fan-out a second time.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/business-request-duplicate-submission.js
const { runSql, runSqlAs, assert, summarize } = require('./lib/db');

async function main() {
  console.log('business-request-duplicate-submission: verifying create_business_request() dedupes a repeat ask...');

  const [requester] = await runSql(`select id from profiles order by created_at limit 1;`);
  if (!requester) throw new Error('Needs at least one real profile in this environment.');
  const requesterId = requester.id;
  const rawText = 'live-verify: duplicate submission test ' + Date.now();

  let firstRequestId;
  try {
    const first = await runSqlAs(
      requesterId,
      `select create_business_request('${rawText}', 40.0, -75.0, 'Coffee', 2, null, null, null, null, null, 15) as result;`
    );
    firstRequestId = first?.[0]?.result?.requestId;
    assert(!!firstRequestId, 'first create_business_request() call creates a real request');
    assert(first?.[0]?.result?.duplicate !== true, 'the first call is not itself flagged as a duplicate');

    const second = await runSqlAs(
      requesterId,
      `select create_business_request('${rawText}', 40.0, -75.0, 'Coffee', 2, null, null, null, null, null, 15) as result;`
    );
    assert(second?.[0]?.result?.duplicate === true, 'an identical second ask is flagged duplicate: true');
    assert(second?.[0]?.result?.requestId === firstRequestId, 'the duplicate call returns the SAME request id, not a new one');
    assert(second?.[0]?.result?.notifiedCount === 0, 'the duplicate call does not re-run the fan-out (notifiedCount: 0)');

    const [rowCount] = await runSql(`select count(*)::int as n from business_requests where requester_id = '${requesterId}' and raw_text = '${rawText}';`);
    assert(rowCount?.n === 1, 'exactly one real row exists for this requester+text, not two');
  } finally {
    if (firstRequestId) await runSql(`delete from business_request_offers where request_id = '${firstRequestId}';`).catch(() => {});
    if (firstRequestId) await runSql(`delete from business_requests where id = '${firstRequestId}';`).catch(() => {});
    console.log('  (cleanup) test request row (and any real fan-out offers it produced) deleted');
  }

  summarize('business-request-duplicate-submission');
}

main().catch((e) => {
  console.error('business-request-duplicate-submission: script itself failed to run:', e.message);
  process.exitCode = 1;
});
