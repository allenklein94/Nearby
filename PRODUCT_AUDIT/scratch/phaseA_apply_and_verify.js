const fs = require('fs');
const { runSql, runSqlAs } = require('/workspaces/Nearby/scripts/live-verify/lib/db.js');

const ALLEN = 'ee74f1a9-9996-465d-a674-c60bc63fbfca'; // owns Coastal Coffee
const CLAUDE = '0d7cecd9-721f-4632-8b1f-44b866d1892b';
const GVOICE = 'e9f74b5a-d1df-4a82-968c-a0f6a73c128a';
const PARTNER = '67dd3d6d-f36b-4b20-8a80-ac980baecc30';

const results = {};

async function cleanup() {
  await runSql(`delete from business_requests where raw_text like 'V2PHASEA%';`);
  await runSql(`update brand_partners set latitude = null, longitude = null where id = '${PARTNER}';`);
  const check = await runSql(`select count(*) from business_requests;`);
  results.postCleanupBaseline = check;
}

(async () => {
  try {
    const sql = fs.readFileSync('/workspaces/Nearby/supabase/migrations/20260815_v3_aggregated_demand_time_window.sql', 'utf8');
    await runSql(sql);
    results.applied = true;

    const grants = await runSql(`
      select has_function_privilege('anon', 'get_aggregated_demand_for_partner(uuid)', 'EXECUTE') as anon_exec,
             has_function_privilege('authenticated', 'get_aggregated_demand_for_partner(uuid)', 'EXECUTE') as auth_exec;
    `);
    results.grants = grants;

    await runSql(`update brand_partners set latitude = 40.0, longitude = -75.0 where id = '${PARTNER}';`);

    // 3 requests: 2 with a real evening time window, 1 with a real morning
    // time window, all Coffee, all near the partner. Expect: request_count 3,
    // dominant_period 'evening', dominant_period_count 2.
    await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date, time_window_start, time_window_end)
      values ('${CLAUDE}', 'V2PHASEA req1 evening', 'Coffee', 'open', now() + interval '1 day', 40.001, -75.001, 15, current_date + 1, '19:00', '21:00');
    `);
    await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date, time_window_start, time_window_end)
      values ('${GVOICE}', 'V2PHASEA req2 evening', 'Coffee', 'open', now() + interval '1 day', 40.002, -75.002, 15, current_date + 2, '19:30', '21:30');
    `);
    await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date, time_window_start, time_window_end)
      values ('${CLAUDE}', 'V2PHASEA req3 morning', 'Coffee', 'open', now() + interval '1 day', 40.003, -75.003, 15, current_date + 3, '08:00', '10:00');
    `);
    const demand1 = await runSqlAs(ALLEN, `select * from get_aggregated_demand_for_partner('${PARTNER}');`);
    results.demand_3requests_2evening1morning = demand1;
    // EXPECT: request_count 3, dominant_period 'evening', dominant_period_count 2

    // 4th request, no time window specified at all -- should count toward
    // request_count/total_party_size but not shift the dominant period.
    await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date)
      values ('${GVOICE}', 'V2PHASEA req4 no time', 'Coffee', 'open', now() + interval '1 day', 40.004, -75.004, 15, current_date + 4);
    `);
    const demand2 = await runSqlAs(ALLEN, `select * from get_aggregated_demand_for_partner('${PARTNER}');`);
    results.demand_4requests_oneWithNoTimeWindow = demand2;
    // EXPECT: request_count 4, dominant_period still 'evening', dominant_period_count still 2

    // Non-owner should still get nothing.
    const nonOwner = await runSqlAs(CLAUDE, `select * from get_aggregated_demand_for_partner('${PARTNER}');`);
    results.demand_nonOwner_shouldBeEmpty = nonOwner;

    // A category with zero time-windowed requests at all -> dominant_period should be null.
    await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date)
      values ('${CLAUDE}', 'V2PHASEA req5 music no time', 'Music', 'open', now() + interval '1 day', 40.001, -75.001, 15, current_date + 1);
    `);
    const demand3 = await runSqlAs(ALLEN, `select * from get_aggregated_demand_for_partner('${PARTNER}');`);
    results.demand_categoryWithNoTimeWindowedRequests_dominantPeriodShouldBeNull = demand3;

  } catch (e) {
    results.ERROR = { message: e.message, body: e.body };
  } finally {
    await cleanup();
  }
  console.log(JSON.stringify(results, null, 2));
})();
