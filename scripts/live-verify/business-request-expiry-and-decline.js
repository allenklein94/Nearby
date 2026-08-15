#!/usr/bin/env node
// 10/10 roadmap Part 8: real, repeatable live-verify script covering two
// of the named critical-path failure modes at once (they share the same
// disposable request/offer fixture, so one script covers both cleanly):
//
//   1. expire_stale_business_requests() -- the hourly cron job -- actually
//      expires a genuinely stale open request and its pending/offered
//      offspring, not just rows that happen to already be terminal.
//   2. decline_business_offer() correctly transitions a pending offer to
//      'declined' and rejects a second decline attempt.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/business-request-expiry-and-decline.js
const { runSql, runSqlAs, assert, summarize } = require('./lib/db');

async function main() {
  console.log('business-request-expiry-and-decline: verifying expiry + decline paths...');

  const [partnerRow] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [requester] = await runSql(`select id from profiles where id <> '${partnerRow?.id ?? ''}' order by created_at limit 1;`);
  if (!requester || !partnerRow) {
    throw new Error('Needs at least one real profile and one real profile managing a business in this environment.');
  }
  const requesterId = requester.id;
  const partnerId = partnerRow.managed_partner_id;

  // ---- Part 1: expiry ----
  let expiredRequestId, expiredOfferId;
  try {
    const [req] = await runSql(`
      insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
      values ('${requesterId}', 'live-verify: expiry test', 'Coffee', 2, 40.0, -75.0, 15, now() - interval '1 hour', 'open')
      returning id;
    `);
    expiredRequestId = req.id;
    const [offer] = await runSql(`
      insert into business_request_offers (request_id, partner_id, offer_type, status)
      values ('${expiredRequestId}', '${partnerId}', 'standard', 'pending')
      returning id;
    `);
    expiredOfferId = offer.id;

    await runSql(`select public.expire_stale_business_requests();`);

    const [afterExpiry] = await runSql(`select status from business_requests where id = '${expiredRequestId}';`);
    assert(afterExpiry?.status === 'expired', 'a stale open request (expires_at in the past) is flipped to "expired" by the cron function');

    const [offerAfterExpiry] = await runSql(`select status from business_request_offers where id = '${expiredOfferId}';`);
    assert(offerAfterExpiry?.status === 'expired', 'its pending offer is also flipped to "expired", not left dangling');
  } finally {
    if (expiredOfferId) await runSql(`delete from business_request_offers where id = '${expiredOfferId}';`).catch(() => {});
    if (expiredRequestId) await runSql(`delete from business_requests where id = '${expiredRequestId}';`).catch(() => {});
  }

  // ---- Part 2: decline ----
  let declineRequestId, declineOfferId;
  try {
    const [req] = await runSql(`
      insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
      values ('${requesterId}', 'live-verify: decline test', 'Coffee', 2, 40.0, -75.0, 15, now() + interval '2 hours', 'open')
      returning id;
    `);
    declineRequestId = req.id;
    const [offer] = await runSql(`
      insert into business_request_offers (request_id, partner_id, offer_type, status)
      values ('${declineRequestId}', '${partnerId}', 'standard', 'pending')
      returning id;
    `);
    declineOfferId = offer.id;

    const [ownerId] = await runSql(`select id from profiles where managed_partner_id = '${partnerId}' limit 1;`);

    const first = await runSqlAs(ownerId.id, `select decline_business_offer('${declineRequestId}') as result;`);
    assert(first?.[0]?.result?.success === true, 'decline_business_offer() succeeds for the real business owner');

    const [afterDecline] = await runSql(`select status from business_request_offers where id = '${declineOfferId}';`);
    assert(afterDecline?.status === 'declined', 'offer status correctly transitions to "declined"');

    const [requestAfterDecline] = await runSql(`select status from business_requests where id = '${declineRequestId}';`);
    assert(requestAfterDecline?.status === 'open', 'the parent request stays "open" after a decline (a decline is not a resolution -- other businesses can still respond)');

    let secondRejected = false;
    try {
      await runSqlAs(ownerId.id, `select decline_business_offer('${declineRequestId}') as result;`);
    } catch (e) {
      secondRejected = true;
    }
    assert(secondRejected, 'a second decline_business_offer() call on the same already-declined offer is rejected');
  } finally {
    if (declineOfferId) await runSql(`delete from business_request_offers where id = '${declineOfferId}';`).catch(() => {});
    if (declineRequestId) await runSql(`delete from business_requests where id = '${declineRequestId}';`).catch(() => {});
    console.log('  (cleanup) all test request/offer rows deleted');
  }

  summarize('business-request-expiry-and-decline');
}

main().catch((e) => {
  console.error('business-request-expiry-and-decline: script itself failed to run:', e.message);
  process.exitCode = 1;
});
