const { runSql, runSqlAs } = require('/workspaces/Nearby/scripts/live-verify/lib/db.js');

const ALLEN = 'ee74f1a9-9996-465d-a674-c60bc63fbfca';
const CLAUDE = '0d7cecd9-721f-4632-8b1f-44b866d1892b';
const GVOICE = 'e9f74b5a-d1df-4a82-968c-a0f6a73c128a';
const ALLEN_KLEIN = 'd15758e7-63d0-450c-9475-9188f26a50ec';
const PARTNER = '67dd3d6d-f36b-4b20-8a80-ac980baecc30';

const results = {};

async function cleanup() {
  await runSql(`delete from business_request_offers where offer_description like 'V2AUDIT%' or offer_description like 'v2audit%';`);
  await runSql(`delete from business_requests where raw_text like 'V2AUDIT%';`);
  await runSql(`delete from intent_submissions where raw_text like 'V2AUDIT%';`);
  await runSql(`update brand_partners set latitude = null, longitude = null where id = '${PARTNER}';`);
  const check = await runSql(`
    select
      (select count(*) from business_requests) as business_requests,
      (select count(*) from business_request_offers) as offers,
      (select count(*) from intent_submissions) as intent_submissions;
  `);
  results.postCleanupBaseline = check;
}

(async () => {
  try {
    await runSql(`update brand_partners set latitude = 40.0, longitude = -75.0 where id = '${PARTNER}';`);

    // ================= TEST 3: trigger fire-once-at-crossing =================
    const pushBefore1 = await runSql(`select count(*) from net._http_response;`);
    const r1 = await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date)
      values ('${CLAUDE}', 'V2AUDIT trig req1', 'Music', 'open', now() + interval '1 day', 40.001, -75.001, 15, current_date + 1)
      returning id;
    `);
    const pushAfter1 = await runSql(`select count(*) from net._http_response;`);
    results.pushCount_after1stRequest_shouldBeUnchanged = { before: pushBefore1, after: pushAfter1 };

    // 2nd connected requester crosses group-intent AND aggregated-demand thresholds -> both triggers should fire (2 pushes: 1 to the connected friend, 1 to the business owner).
    const r2 = await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date)
      values ('${GVOICE}', 'V2AUDIT trig req2', 'Music', 'open', now() + interval '1 day', 40.002, -75.002, 15, current_date + 2)
      returning id;
    `);
    const pushAfter2 = await runSql(`select count(*) from net._http_response;`);
    results.pushCount_after2ndRequest_crossing_shouldIncreaseBy2 = pushAfter2;

    // 3rd request in same category -> should NOT fire again (no re-notify past the crossing).
    const r3 = await runSql(`
      insert into business_requests (requester_id, raw_text, category, status, expires_at, latitude, longitude, radius_miles, date)
      values ('${ALLEN_KLEIN}', 'V2AUDIT trig req3 unconnected', 'Music', 'open', now() + interval '1 day', 40.003, -75.003, 15, current_date + 1)
      returning id;
    `);
    const pushAfter3 = await runSql(`select count(*) from net._http_response;`);
    results.pushCount_after3rdRequest_shouldBeUnchangedFromAfter2 = pushAfter3;

    const lastResponses = await runSql(`select id, status_code, content from net._http_response order by id desc limit 3;`);
    results.lastPushResponses = lastResponses;

    // ================= TEST 4: marketplace reliability rankings =================
    // Non-admin should be rejected.
    let nonAdminRejected = null;
    try {
      await runSqlAs(CLAUDE, `select * from get_marketplace_reliability_rankings();`);
      nonAdminRejected = 'DID NOT REJECT -- BUG';
    } catch (e) {
      nonAdminRejected = e.message;
    }
    results.marketplaceRankings_nonAdminRejected = nonAdminRejected;

    // Below threshold (partner has 0 real offers) -> empty.
    const rankingsEmpty = await runSqlAs(ALLEN, `select * from get_marketplace_reliability_rankings();`);
    results.marketplaceRankings_belowThreshold_shouldBeEmpty = rankingsEmpty;

    // Build 5 disposable offers spanning the funnel for Coastal Coffee, need a real business_requests row per offer (offers reference request_id).
    const reqIds = [];
    for (let i = 0; i < 5; i++) {
      const rr = await runSql(`
        insert into business_requests (requester_id, raw_text, category, status, expires_at, date, latitude, longitude, radius_miles)
        values ('${CLAUDE}', 'V2AUDIT rank req ${i}', 'Coffee', 'open', now() + interval '1 day', current_date + 1, 40.0, -75.0, 15)
        returning id;
      `);
      reqIds.push(rr[0].id);
    }
    // 1 pending (no response), 1 declined, 1 accepted, 2 completed -> matches CLAUDE.md's own hand-checked scenario shape.
    await runSql(`
      insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description, created_at, responded_at)
      values ('${reqIds[0]}', '${PARTNER}', 'pending', 'standard', 'V2AUDIT offer pending', now(), null);
    `);
    await runSql(`
      insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description, created_at, responded_at)
      values ('${reqIds[1]}', '${PARTNER}', 'declined', 'standard', 'V2AUDIT offer declined', now() - interval '10 minutes', now());
    `);
    await runSql(`
      insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description, created_at, responded_at, accepted_at)
      values ('${reqIds[2]}', '${PARTNER}', 'accepted', 'standard', 'V2AUDIT offer accepted', now() - interval '10 minutes', now(), now());
    `);
    await runSql(`
      insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description, created_at, responded_at, accepted_at, completed_at)
      values ('${reqIds[3]}', '${PARTNER}', 'completed', 'standard', 'V2AUDIT offer completed 1', now() - interval '10 minutes', now(), now(), now());
    `);
    await runSql(`
      insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description, created_at, responded_at, accepted_at, completed_at)
      values ('${reqIds[4]}', '${PARTNER}', 'completed', 'standard', 'V2AUDIT offer completed 2', now() - interval '10 minutes', now(), now(), now());
    `);

    const rankingsPopulated = await runSqlAs(ALLEN, `select * from get_marketplace_reliability_rankings();`);
    results.marketplaceRankings_afterRealFunnel_handCheck = rankingsPopulated;
    // Expected hand-check: total=5, response_rate=80.0 (4/5 responded), acceptance_rate=75.0 (3 accepted+completed / 4 responded), completion_rate=66.7 (2 completed / 3 accepted+completed)

    // ================= TEST 5: cross-user intent patterns -- threshold + timezone bucketing =================
    let nonAdminRejected2 = null;
    try {
      await runSqlAs(CLAUDE, `select * from get_cross_user_intent_patterns();`);
      nonAdminRejected2 = 'DID NOT REJECT -- BUG';
    } catch (e) {
      nonAdminRejected2 = e.message;
    }
    results.crossUserPatterns_nonAdminRejected = nonAdminRejected2;

    // Timezone test: insert a submission with a created_at that is 8:00 PM
    // US-Eastern (a real "evening" ask by any real user's own local clock)
    // -- expressed here as its UTC equivalent (00:00 UTC the next day, UTC-4
    // in August/EDT). If the RPC buckets by UTC wall-clock instead of the
    // user's own local time, this will show up as "morning" (hour<12 UTC),
    // not "evening" -- proving the bucketing does NOT match getTimePeriod()'s
    // real local-time rule despite the migration's own comment claiming it does.
    // Use a real weekday (Wednesday) in both timezones to isolate the
    // hour-bucketing effect specifically (not the weekend edge case).
    // 2026-08-19 is a Wednesday. 8:00 PM EDT Wed = 00:00 UTC Thu (still a
    // weekday in UTC too, Thursday) -- extract(hour)=0 -> 'morning' in UTC
    // vs 'evening' in real US-Eastern local time.
    for (let i = 0; i < 10; i++) {
      const uid = i < 3 ? CLAUDE : i < 6 ? GVOICE : i < 9 ? ALLEN_KLEIN : ALLEN;
      await runSql(`
        insert into intent_submissions (user_id, raw_text, category, created_at)
        values ('${uid}', 'V2AUDIT tz test ${i}', 'Wine', '2026-08-20T00:15:00Z');
      `);
    }
    const tzResult = await runSqlAs(ALLEN, `select * from get_cross_user_intent_patterns();`);
    results.crossUserPatterns_timezoneBucketing_10submissions_4distinctUsers = tzResult;
    // These were inserted at 8:15 PM EDT on a real Wednesday (Aug 19 local) --
    // a real US user's own device-local getTimePeriod() would bucket this as
    // 'evening' on a weekday. If the RPC returns period:'morning' here (UTC
    // hour=0), that proves the SQL bucketing is UTC-based, not local-time-based.

  } catch (e) {
    results.ERROR = { message: e.message, body: e.body };
  } finally {
    await cleanup();
  }
  console.log(JSON.stringify(results, null, 2));
})();
