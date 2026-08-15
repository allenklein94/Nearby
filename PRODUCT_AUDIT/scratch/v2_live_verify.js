const { runSql, runSqlAs } = require('/workspaces/Nearby/scripts/live-verify/lib/db.js');

const ALLEN = 'ee74f1a9-9996-465d-a674-c60bc63fbfca'; // admin, manages Coastal Coffee
const CLAUDE = '0d7cecd9-721f-4632-8b1f-44b866d1892b'; // accepted friend of Allen
const GVOICE = 'e9f74b5a-d1df-4a82-968c-a0f6a73c128a'; // matched with Allen
const ALLEN_KLEIN = 'd15758e7-63d0-450c-9475-9188f26a50ec'; // NOT connected to Allen
const PARTNER = '67dd3d6d-f36b-4b20-8a80-ac980baecc30'; // Coastal Coffee

const results = {};
let req1, req2, req3;

async function cleanup() {
  await runSql(`delete from business_requests where raw_text like 'V2AUDIT%';`);
  await runSql(`update profiles set intent_visibility = 'friends_and_matches' where id in ('${CLAUDE}','${GVOICE}');`);
  await runSql(`update brand_partners set latitude = null, longitude = null where id = '${PARTNER}';`);
  await runSql(`delete from business_request_offers where offer_description like 'V2AUDIT%';`);
  const check = await runSql(`
    select
      (select count(*) from business_requests) as business_requests,
      (select count(*) from business_request_offers) as offers;
  `);
  results.postCleanupBaseline = check;
}

(async () => {
  try {
    // ---- SETUP: two connected requesters (Claude, Google voice) both
    // connected to Allen but not to each other. Set Coastal Coffee's
    // coordinates near a test point so radius math has something real to
    // compute against.
    await runSql(`update brand_partners set latitude = 40.0, longitude = -75.0 where id = '${PARTNER}';`);

    // ================= TEST 1: group intent signal + intent_visibility bypass =================
    const r1 = await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date)
      values ('${CLAUDE}', 'V2AUDIT test request 1', 'Coffee', 'open', now() + interval '1 day', 40.001, -75.001, 15, current_date + 1)
      returning id;
    `);
    req1 = r1[0].id;

    // Before the 2nd request, group intent should show nothing (only 1 requester).
    const before2nd = await runSqlAs(ALLEN, `select * from get_my_group_intent_signals();`);
    results.groupIntent_afterOnlyOneRequester = before2nd;

    const r2 = await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date)
      values ('${GVOICE}', 'V2AUDIT test request 2', 'Coffee', 'open', now() + interval '1 day', 40.002, -75.002, 15, current_date + 2)
      returning id;
    `);
    req2 = r2[0].id;

    const afterCross = await runSqlAs(ALLEN, `select * from get_my_group_intent_signals();`);
    results.groupIntent_afterTwoRequesters = afterCross;

    // Non-connected caller (Allen Klein) should see nothing.
    const nonConnected = await runSqlAs(ALLEN_KLEIN, `select * from get_my_group_intent_signals();`);
    results.groupIntent_nonConnectedCaller = nonConnected;

    // ---- Privacy bypass test: set Claude's intent_visibility to 'nobody'
    // (the exact setting that already excludes them from Tier 2's
    // get_connected_open_business_requests) and re-check both RPCs.
    await runSql(`update profiles set intent_visibility = 'nobody' where id = '${CLAUDE}';`);

    const afterPrivacyOptOut_groupIntent = await runSqlAs(ALLEN, `select * from get_my_group_intent_signals();`);
    results.groupIntent_afterClaudeOptedOut = afterPrivacyOptOut_groupIntent;

    const tier2Comparison = await runSqlAs(ALLEN, `
      select * from get_connected_open_business_requests('Coffee', current_date, current_date + 3);
    `);
    results.tier2_afterClaudeOptedOut_forComparison = tier2Comparison;

    await runSql(`update profiles set intent_visibility = 'friends_and_matches' where id = '${CLAUDE}';`);

    // ================= TEST 2: aggregated demand for partner (business-facing, radius) =================
    const demandAsOwner = await runSqlAs(ALLEN, `select * from get_aggregated_demand_for_partner('${PARTNER}');`);
    results.aggregatedDemand_asOwner = demandAsOwner;

    const demandAsNonOwner = await runSqlAs(CLAUDE, `select * from get_aggregated_demand_for_partner('${PARTNER}');`);
    results.aggregatedDemand_asNonOwner_shouldBeEmpty = demandAsNonOwner;

    // Move the partner out of radius and confirm demand drops to nothing.
    await runSql(`update brand_partners set latitude = 41.5, longitude = -76.5 where id = '${PARTNER}';`);
    const demandOutOfRadius = await runSqlAs(ALLEN, `select * from get_aggregated_demand_for_partner('${PARTNER}');`);
    results.aggregatedDemand_afterMovingOutOfRadius_shouldBeEmpty = demandOutOfRadius;
    await runSql(`update brand_partners set latitude = 40.0, longitude = -75.0 where id = '${PARTNER}';`);

    // ================= TEST 3: trigger fire-once-at-crossing (both triggers) =================
    const pushCountBefore = await runSql(`select count(*) from net._http_response;`);
    results.pushCount_beforeThirdRequest = pushCountBefore;

    const r3 = await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date)
      values ('${ALLEN_KLEIN}', 'V2AUDIT test request 3 (no connection to Allen, but connected to nobody -- tests trigger doesn't fire for unconnected requester)', 'Coffee', 'open', now() + interval '1 day', 40.003, -75.003, 15, current_date + 1)
      returning id;
    `);
    req3 = r3[0].id;
    const pushCountAfterThird = await runSql(`select count(*) from net._http_response;`);
    results.pushCount_afterThirdRequest_shouldBeUnchanged_sinceReq3RequesterHasNoConnections = pushCountAfterThird;

  } catch (e) {
    results.ERROR = { message: e.message, body: e.body };
  } finally {
    await cleanup();
  }
  console.log(JSON.stringify(results, null, 2));
})();
