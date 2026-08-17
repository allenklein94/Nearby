#!/usr/bin/env node
// "The Offer System" Phase 2 (see CLAUDE.md's own plan, Gap 2). Real,
// repeatable live-verify script for business_fulfillment_policies and the
// new _match_request_to_policy() matching pass wired into
// create_business_request()/create_business_request_for_gathering():
//   - upsert_business_fulfillment_policy() is real, owner-only, and
//     genuinely upserts (one row per partner).
//   - a request at or under a policy's real auto_accept_party_size_max
//     (and within its party-size/hours bounds) gets a real, immediate
//     'offered' row -- no manual business step, the actual "Level 1 --
//     automatic" mechanism for every future request, not a one-time
//     posting.
//   - a request OVER auto_accept_party_size_max still lands as 'pending'
//     for manual review, exactly per the plan's own checkpoint text.
//   - an inactive policy (active=false) never auto-accepts anything.
//
// Coastal Coffee's coordinates are temporarily set for this test (same
// established convention as every other live-verify script touching this
// partner) and reverted to null afterward.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/business-fulfillment-policy-auto-accept.js
const { runSql, runSqlAs, assert, summarize } = require('./lib/db');

async function main() {
  console.log('business-fulfillment-policy-auto-accept: verifying business_fulfillment_policies and the real auto-accept matching pass...');

  const [partnerRow] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  if (!partnerRow) {
    throw new Error('Needs at least one real profile managing a business in this environment.');
  }
  const ownerId = partnerRow.id;
  const partnerId = partnerRow.managed_partner_id;

  const others = await runSql(`select id from profiles where id <> '${ownerId}' order by created_at limit 2;`);
  if (!others || others.length < 2) {
    throw new Error('Needs at least two other real profiles in this environment.');
  }
  const requester4Id = others[0].id;
  const requester6Id = others[1].id;

  const [beforeCoords] = await runSql(`select latitude, longitude from brand_partners where id = '${partnerId}';`);

  let request4Id, offer4Id, request6Id, offer6Id, requestInactiveId, offerInactiveId;

  try {
    await runSql(`update brand_partners set latitude = 40.0, longitude = -75.0 where id = '${partnerId}';`);

    // ---------- ownership + upsert shape ----------
    let strangerUpsertRejected = false;
    try {
      await runSqlAs(requester4Id, `select upsert_business_fulfillment_policy('${partnerId}', 2, 8, '17:00', '22:00', 40, 15, 4, 50, 2) as result;`);
    } catch (e) {
      strangerUpsertRejected = true;
    }
    assert(strangerUpsertRejected, 'upsert_business_fulfillment_policy() rejects a caller who does not manage this business');

    let badDiscountRejected = false;
    try {
      await runSqlAs(ownerId, `select upsert_business_fulfillment_policy('${partnerId}', 2, 8, '17:00', '22:00', 40, 150, 4, 50, 2) as result;`);
    } catch (e) {
      badDiscountRejected = true;
    }
    assert(badDiscountRejected, 'a max_discount_pct over 100 is rejected');

    const upsertResult = await runSqlAs(ownerId, `select upsert_business_fulfillment_policy('${partnerId}', 2, 8, '17:00', '22:00', 40, 15, 4, 50, 2) as result;`);
    assert(upsertResult?.[0]?.result?.success === true, 'the real owner can set a real fulfillment policy (party size 2-8, 5-10 PM, auto-accept <=4)');

    const [policyRow] = await runSql(`select party_size_min, party_size_max, auto_accept_party_size_max, active, deposit_amount from business_fulfillment_policies where partner_id = '${partnerId}';`);
    assert(!!policyRow, 'a real business_fulfillment_policies row now exists');
    assert(policyRow?.auto_accept_party_size_max === 4, 'the real auto_accept_party_size_max is stored correctly (4)');
    assert(Number(policyRow?.deposit_amount) === 50, 'deposit_amount is stored honestly (real column, not yet collected -- Phase 1\'s inert Payment seam)');

    // upserting again for the SAME partner should update the same row, not create a second one
    await runSqlAs(ownerId, `select upsert_business_fulfillment_policy('${partnerId}', 2, 8, '17:00', '22:00', 40, 15, 4, 50, 2) as result;`);
    const [policyCount] = await runSql(`select count(*)::int as c from business_fulfillment_policies where partner_id = '${partnerId}';`);
    assert(policyCount?.c === 1, 'a repeat upsert for the same partner is a real update, not a second row (count stays 1)');

    // ---------- a 4-person request auto-accepts ----------
    const create4Result = await runSqlAs(requester4Id, `select create_business_request('live-verify: fulfillment policy auto-accept test (4)', 40.0, -75.0, 'Coffee', 4, null, 60, null, '18:00', '20:00', 15, null) as result;`);
    request4Id = create4Result?.[0]?.result?.requestId;
    assert(!!request4Id, 'create_business_request() with party_size=4 succeeds');

    const [offer4Row] = await runSql(`select id, status, offer_type, offer_description from business_request_offers where request_id = '${request4Id}' and partner_id = '${partnerId}';`);
    offer4Id = offer4Row?.id;
    assert(!!offer4Row, 'a real business_request_offers row exists for the policy-matched partner');
    assert(offer4Row?.status === 'offered', `a 4-person request (at the auto_accept_party_size_max=4 boundary) is genuinely auto-offered, not left pending (got: ${offer4Row?.status})`);
    assert(offer4Row?.offer_description?.includes('policy'), 'the auto-generated offer description honestly names the policy, not a fabricated human-written offer');

    // ---------- a 6-person request (over the auto-accept bound, but within the policy's own party-size range) stays pending ----------
    const create6Result = await runSqlAs(requester6Id, `select create_business_request('live-verify: fulfillment policy auto-accept test (6)', 40.0, -75.0, 'Coffee', 6, null, 60, null, '18:00', '20:00', 15, null) as result;`);
    request6Id = create6Result?.[0]?.result?.requestId;
    assert(!!request6Id, 'create_business_request() with party_size=6 succeeds');

    const [offer6Row] = await runSql(`select id, status from business_request_offers where request_id = '${request6Id}' and partner_id = '${partnerId}';`);
    offer6Id = offer6Row?.id;
    assert(!!offer6Row, 'a real business_request_offers row still exists for the 6-person request (the plain fan-out still ran)');
    assert(offer6Row?.status === 'pending', `a 6-person request (over auto_accept_party_size_max=4, even though within party_size_max=8) correctly stays 'pending' for manual review, not auto-offered (got: ${offer6Row?.status})`);

    // ---------- an inactive policy never auto-accepts anything ----------
    await runSqlAs(ownerId, `select upsert_business_fulfillment_policy('${partnerId}', 2, 8, '17:00', '22:00', 40, 15, 4, 50, 2, false) as result;`);
    const createInactiveResult = await runSqlAs(requester4Id, `select create_business_request('live-verify: fulfillment policy inactive test (4)', 40.0, -75.0, 'Coffee', 4, null, 60, null, '18:00', '20:00', 15, null) as result;`);
    requestInactiveId = createInactiveResult?.[0]?.result?.requestId;
    const [offerInactiveRow] = await runSql(`select id, status from business_request_offers where request_id = '${requestInactiveId}' and partner_id = '${partnerId}';`);
    offerInactiveId = offerInactiveRow?.id;
    assert(offerInactiveRow?.status === 'pending', `a real 4-person request against a genuinely inactive (active=false) policy correctly stays 'pending', not auto-offered (got: ${offerInactiveRow?.status})`);
  } finally {
    if (offer4Id) await runSql(`delete from business_request_offers where id = '${offer4Id}';`).catch(() => {});
    if (request4Id) await runSql(`delete from business_requests where id = '${request4Id}';`).catch(() => {});
    if (offer6Id) await runSql(`delete from business_request_offers where id = '${offer6Id}';`).catch(() => {});
    if (request6Id) await runSql(`delete from business_requests where id = '${request6Id}';`).catch(() => {});
    if (offerInactiveId) await runSql(`delete from business_request_offers where id = '${offerInactiveId}';`).catch(() => {});
    if (requestInactiveId) await runSql(`delete from business_requests where id = '${requestInactiveId}';`).catch(() => {});
    await runSql(`delete from business_fulfillment_policies where partner_id = '${partnerId}';`).catch(() => {});
    await runSql(`update brand_partners set latitude = ${beforeCoords?.latitude === null ? 'null' : beforeCoords.latitude}, longitude = ${beforeCoords?.longitude === null ? 'null' : beforeCoords.longitude} where id = '${partnerId}';`).catch(() => {});
    console.log('  (cleanup) all test request/offer/policy rows deleted, partner coordinates reverted');
  }

  const [finalCheck] = await runSql(`select (select count(*) from business_fulfillment_policies) as policies, (select count(*) from business_requests) as requests, (select count(*) from business_request_offers) as offers;`);
  assert(finalCheck?.policies === 0 && finalCheck?.requests === 0 && finalCheck?.offers === 0, `production is back to its exact pre-test baseline (0 policies, 0 requests, 0 offers) -- got ${JSON.stringify(finalCheck)}`);

  summarize('business-fulfillment-policy-auto-accept');
}

main().catch((e) => {
  console.error('business-fulfillment-policy-auto-accept: script itself failed to run:', e.message);
  process.exitCode = 1;
});
