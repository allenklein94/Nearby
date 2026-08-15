#!/usr/bin/env node
// 10/10 roadmap Part 8 (see CLAUDE.md's "10/10 roadmap" plan): technical
// validation. Real, repeatable live-verify script for the "double-accept
// race" failure mode on accept_business_offer() -- the exact race Part 3's
// architecture-hardening pass fixed (20260815_architecture_hardening_
// race_fixes.sql). A second accept on the same offer, after the first has
// already fulfilled the parent request, must be rejected -- never allowed
// to silently "succeed" a second time.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/business-offer-double-accept.js
const { runSql, runSqlAs, assert, summarize } = require('./lib/db');

async function main() {
  console.log('business-offer-double-accept: verifying accept_business_offer() rejects a second accept...');

  const [partnerRow] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [requester] = await runSql(`select id from profiles where id <> '${partnerRow?.id ?? ''}' order by created_at limit 1;`);
  if (!requester || !partnerRow) {
    throw new Error('Needs at least one real profile and one real profile managing a business in this environment.');
  }
  const requesterId = requester.id;
  const partnerId = partnerRow.managed_partner_id;

  let requestId, offerId;
  try {
    const [inserted] = await runSql(`
      insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
      values ('${requesterId}', 'live-verify: double-accept test', 'Coffee', 2, 40.0, -75.0, 15, now() + interval '2 hours', 'open')
      returning id;
    `);
    requestId = inserted.id;

    const [offer] = await runSql(`
      insert into business_request_offers (request_id, partner_id, offer_type, status, offer_description)
      values ('${requestId}', '${partnerId}', 'standard', 'offered', 'live-verify test offer')
      returning id;
    `);
    offerId = offer.id;

    const first = await runSqlAs(requesterId, `select accept_business_offer('${offerId}') as result;`);
    assert(first?.[0]?.result?.success === true, 'first accept_business_offer() call succeeds');

    const [afterFirst] = await runSql(`select status from business_requests where id = '${requestId}';`);
    assert(afterFirst?.status === 'fulfilled', 'parent request flips to fulfilled after the first accept');

    let secondRejected = false;
    let secondMessage = '';
    try {
      await runSqlAs(requesterId, `select accept_business_offer('${offerId}') as result;`);
    } catch (e) {
      secondRejected = true;
      secondMessage = e.message;
    }
    assert(secondRejected, `second accept_business_offer() call on the same offer is rejected (got: ${secondRejected ? secondMessage : 'no error -- this is the bug'})`);

    const [afterSecond] = await runSql(`select status from business_request_offers where id = '${offerId}';`);
    assert(afterSecond?.status === 'accepted', 'offer status is still exactly "accepted", not corrupted by the rejected second call');
  } finally {
    if (offerId) await runSql(`delete from business_request_offers where id = '${offerId}';`).catch(() => {});
    if (requestId) await runSql(`delete from business_requests where id = '${requestId}';`).catch(() => {});
    console.log('  (cleanup) test request/offer rows deleted');
  }

  summarize('business-offer-double-accept');
}

main().catch((e) => {
  console.error('business-offer-double-accept: script itself failed to run:', e.message);
  process.exitCode = 1;
});
