#!/usr/bin/env node
// Real, repeatable live-verify script for two of CLAUDE.md's "connect existing
// consumer-intent + business systems" fixes (Section D, C2's `intent_match`
// source bucket, and the follow-up Finding 5 fix -- the `matchedAvailability`
// banner on AskBusinessScreen now actually binding the specific posting it
// shows, via `preferred_availability_id_param`), both applied via ad hoc
// verification the day they landed but never given a permanent script.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/intent-match-business-discovery.js
const { runSql, runSqlAs, assert, summarize } = require('./lib/db');

async function main() {
  console.log('intent-match-business-discovery: verifying the C2 intent_match bucket and the preferred-availability binding fix...');

  const [owner] = await runSql(`select id from profiles where display_name = 'Allen' limit 1;`);
  const [stranger] = await runSql(`select id from profiles where display_name != 'Allen' order by created_at limit 1;`);
  const [partner] = await runSql(`select id, latitude, longitude from brand_partners where name = 'Coastal Coffee' limit 1;`);
  if (!owner || !stranger || !partner) throw new Error('Needs Allen, at least one other real profile, and the Coastal Coffee partner in this environment.');

  const requesterId = stranger.id;
  const partnerId = partner.id;
  let availId1, availId2, requestId1, requestId2, requestId3, requestId4, viewId;

  try {
    // --- C2: intent_match source bucket -------------------------------
    const [view] = await runSqlAs(
      requesterId,
      `insert into business_profile_views (partner_id, viewer_id, source) values ('${partnerId}', '${requesterId}', 'intent_match') returning id;`
    );
    viewId = view?.id;
    assert(!!viewId, 'a real intent_match business_profile_views row inserts cleanly');

    let bogusRejected = false;
    try {
      await runSqlAs(requesterId, `insert into business_profile_views (partner_id, viewer_id, source) values ('${partnerId}', '${requesterId}', 'bogus_source') returning id;`);
    } catch (e) {
      bogusRejected = true;
    }
    assert(bogusRejected, 'a bogus source value is still rejected by the widened CHECK constraint');

    const [ownerStats] = await runSqlAs(owner.id, `select get_business_discovery_stats('${partnerId}') as stats;`);
    assert((ownerStats?.stats?.intent_match_views ?? 0) >= 1, `the real owner sees intent_match_views >= 1 (got ${ownerStats?.stats?.intent_match_views})`);

    const [nonOwnerStats] = await runSqlAs(requesterId, `select get_business_discovery_stats('${partnerId}') as stats;`);
    assert(nonOwnerStats?.stats?.total_views === 0, 'a genuine non-owner still gets zeroed stats, not a leak');
    assert(nonOwnerStats?.stats?.intent_match_views === 0, 'a genuine non-owner sees intent_match_views: 0, not the real count');

    // --- Finding 5 fix: preferred-availability binding ----------------
    await runSql(`update brand_partners set latitude = 40.0, longitude = -74.0 where id = '${partnerId}';`);

    const [avail1] = await runSql(`
      insert into business_availability (partner_id, category, title, description, offer_type, price, starts_at, ends_at, radius_miles, status)
      values ('${partnerId}', 'Music', 'live-verify: mismatched-category posting', null, 'standard', 15, now(), now() + interval '4 hours', 15, 'active')
      returning id;
    `);
    availId1 = avail1.id;

    const [bound] = await runSqlAs(
      requesterId,
      `select create_business_request('live-verify: preferred binding test', 40.0, -74.0, 'Coffee', 2, null, null, null, null, null, 15, null, '${availId1}') as result;`
    );
    requestId1 = bound?.result?.requestId;
    const [offer1] = await runSql(`select status, availability_id from business_request_offers where availability_id = '${availId1}';`);
    assert(offer1?.status === 'offered' && offer1?.availability_id === availId1, 'a mismatched-category request still binds the preferred availability when it is genuinely live and in range');

    const [unbound] = await runSqlAs(
      requesterId,
      `select create_business_request('live-verify: no preferred id, mismatched category', 40.0, -74.0, 'Coffee', 2, null, null, null, null, null, 15, null, null) as result;`
    );
    requestId2 = unbound?.result?.requestId;
    const [regressionCheck] = await runSql(`select count(*)::int as n from business_request_offers where availability_id = '${availId1}' and request_id != '${requestId1}';`);
    assert(regressionCheck?.n === 0, 'without a preferred id, the same mismatched-category posting is still correctly excluded (no regression)');

    await runSql(`update business_availability set status = 'cancelled' where id = '${availId1}';`);
    const [cancelled] = await runSqlAs(
      requesterId,
      `select create_business_request('live-verify: preferred id now cancelled', 40.0, -74.0, 'Coffee', 2, null, null, null, null, null, 15, null, '${availId1}') as result;`
    );
    requestId3 = cancelled?.result?.requestId;
    const [stillOne] = await runSql(`select count(*)::int as n from business_request_offers where availability_id = '${availId1}';`);
    assert(stillOne?.n === 1, 'a preferred id pointing at a no-longer-live posting falls through cleanly, no fabricated offer');

    const [avail2] = await runSql(`
      insert into business_availability (partner_id, category, title, description, offer_type, price, starts_at, ends_at, radius_miles, status)
      values ('${partnerId}', 'Coffee', 'live-verify: radius-test posting', null, 'standard', null, now(), now() + interval '4 hours', 50, 'active')
      returning id;
    `);
    availId2 = avail2.id;
    const [tooFar] = await runSqlAs(
      requesterId,
      `select create_business_request('live-verify: far away, tiny radius', 41.0, -73.0, 'Coffee', 2, null, null, null, null, null, 1, null, '${availId2}') as result;`
    );
    requestId4 = tooFar?.result?.requestId;
    const [zeroOffers] = await runSql(`select count(*)::int as n from business_request_offers where availability_id = '${availId2}';`);
    assert(zeroOffers?.n === 0, 'a preferred id genuinely outside the request\'s own radius is still correctly rejected by distance');
  } finally {
    for (const rid of [requestId1, requestId2, requestId3, requestId4]) {
      if (rid) await runSql(`delete from business_request_offers where request_id = '${rid}';`).catch(() => {});
      if (rid) await runSql(`delete from business_requests where id = '${rid}';`).catch(() => {});
    }
    if (availId1) await runSql(`delete from business_availability where id = '${availId1}';`).catch(() => {});
    if (availId2) await runSql(`delete from business_availability where id = '${availId2}';`).catch(() => {});
    if (viewId) await runSql(`delete from business_profile_views where id = '${viewId}';`).catch(() => {});
    await runSql(`update brand_partners set latitude = null, longitude = null where id = '${partnerId}';`).catch(() => {});
    console.log('  (cleanup) all test rows deleted, Coastal Coffee\'s coordinates reverted to null');
  }

  summarize('intent-match-business-discovery');
}

main().catch((e) => {
  console.error('intent-match-business-discovery: script itself failed to run:', e.message);
  process.exitCode = 1;
});
