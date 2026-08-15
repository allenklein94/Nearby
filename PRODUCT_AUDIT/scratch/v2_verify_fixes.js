const { runSql, runSqlAs } = require('/workspaces/Nearby/scripts/live-verify/lib/db.js');

const ALLEN = 'ee74f1a9-9996-465d-a674-c60bc63fbfca';
const CLAUDE = '0d7cecd9-721f-4632-8b1f-44b866d1892b';
const GVOICE = 'e9f74b5a-d1df-4a82-968c-a0f6a73c128a';

const results = {};

async function cleanup() {
  await runSql(`delete from business_requests where raw_text like 'V2FIXVERIFY%';`);
  await runSql(`delete from intent_submissions where raw_text like 'V2FIXVERIFY%';`);
  await runSql(`update profiles set intent_visibility = 'friends_and_matches' where id in ('${CLAUDE}','${GVOICE}');`);
  const check = await runSql(`
    select (select count(*) from business_requests) as business_requests,
           (select count(*) from intent_submissions) as intent_submissions;
  `);
  results.postCleanupBaseline = check;
}

(async () => {
  try {
    // ---- Defect A re-test: same scenario as the audit, Claude opts out ----
    await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date)
      values ('${CLAUDE}', 'V2FIXVERIFY req1', 'Coffee', 'open', now() + interval '1 day', 40.001, -75.001, 15, current_date + 1);
    `);
    await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date)
      values ('${GVOICE}', 'V2FIXVERIFY req2', 'Coffee', 'open', now() + interval '1 day', 40.002, -75.002, 15, current_date + 2);
    `);
    await runSql(`update profiles set intent_visibility = 'nobody' where id = '${CLAUDE}';`);

    const afterFix = await runSqlAs(ALLEN, `select * from get_my_group_intent_signals();`);
    results.defectA_afterFix_ClaudeOptedOut_shouldExcludeClaude = afterFix;
    // EXPECT: either empty (only 1 real-eligible requester left, Google voice,
    // below the 2+ threshold) or a row with request_count:1 and requester_names
    // containing ONLY "Google voice" -- Claude must not appear anywhere.

    const pushBefore = await runSql(`select count(*) from net._http_response;`);
    // A 3rd connected requester (still opted-in) crossing 1->2 with Google
    // voice only (Claude is excluded) should still work normally.
    await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date)
      values ('${CLAUDE}', 'V2FIXVERIFY req3 (still opted out)', 'Coffee', 'open', now() + interval '1 day', 40.003, -75.003, 15, current_date + 3);
    `);
    const pushAfter = await runSql(`select count(*) from net._http_response;`);
    results.defectA_trigger_optedOutRequesterOwnRow_shouldNotFire = { before: pushBefore, after: pushAfter };
    // EXPECT unchanged -- the new row's own requester (Claude) is opted out,
    // so notify_group_intent_threshold should bail immediately for this row.

    await runSql(`update profiles set intent_visibility = 'friends_and_matches' where id = '${CLAUDE}';`);

    // ---- Defect B re-test: local_period stored + grouped correctly ----
    for (let i = 0; i < 10; i++) {
      const uid = i < 3 ? CLAUDE : i < 6 ? GVOICE : i < 9 ? ALLEN : ALLEN;
      await runSql(`
        insert into intent_submissions (user_id, raw_text, category, created_at, local_period)
        values ('${uid}', 'V2FIXVERIFY tz ${i}', 'Wine', '2026-08-20T00:15:00Z', 'evening');
      `);
    }
    const tzFixed = await runSqlAs(ALLEN, `select * from get_cross_user_intent_patterns();`);
    results.defectB_afterFix_shouldReadEvening_notMorning = tzFixed;

    // Old-shape rows (no local_period, pre-fix data) should be silently
    // excluded, not miscounted into a bucket.
    await runSql(`
      insert into intent_submissions (user_id, raw_text, category, created_at)
      values ('${ALLEN}', 'V2FIXVERIFY tz nulllocalperiod', 'Wine', now());
    `);
    const tzStillClean = await runSqlAs(ALLEN, `select * from get_cross_user_intent_patterns();`);
    results.defectB_nullLocalPeriodRow_excludedNotMiscounted = tzStillClean;

    const colCheck = await runSql(`
      select column_name, data_type from information_schema.columns
      where table_name = 'intent_submissions' and column_name = 'local_period';
    `);
    results.local_period_column_exists = colCheck;

    let badValueRejected = null;
    try {
      await runSql(`insert into intent_submissions (user_id, raw_text, local_period) values ('${ALLEN}', 'V2FIXVERIFY bad', 'bogus_period');`);
      badValueRejected = 'DID NOT REJECT -- BUG';
    } catch (e) {
      badValueRejected = e.message;
    }
    results.local_period_check_constraint = badValueRejected;

  } catch (e) {
    results.ERROR = { message: e.message, body: e.body };
  } finally {
    await cleanup();
  }
  console.log(JSON.stringify(results, null, 2));
})();
