#!/usr/bin/env node
// Phase 1 item 2 of the "Scorecard to 10" plan (see CLAUDE.md): the
// concurrent counterpart to business-offer-double-accept.js. That script
// already proves the invariant holds under a *sequential* replay (call,
// await, call again) -- this one uses the real concurrency harness
// (lib/concurrency.js) to force two accept_business_offer() calls on the
// exact same offer to genuinely overlap in Postgres, not just run close
// together in wall-clock time, and proves the row lock the Aug 15 2026
// architecture-hardening pass added actually serializes them.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/business-offer-double-accept-concurrent.js
const { runSql, runSqlAs, assert, summarize } = require('./lib/db');
const { runOverlapping, asUser } = require('./lib/concurrency');

async function main() {
  console.log('business-offer-double-accept-concurrent: verifying accept_business_offer()\'s row lock serializes two genuinely concurrent accepts...');

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
      values ('${requesterId}', 'live-verify: concurrent double-accept test', 'Coffee', 2, 40.0, -75.0, 15, now() + interval '2 hours', 'open')
      returning id;
    `);
    requestId = inserted.id;

    const [offer] = await runSql(`
      insert into business_request_offers (request_id, partner_id, offer_type, status, offer_description)
      values ('${requestId}', '${partnerId}', 'standard', 'offered', 'live-verify concurrent test offer')
      returning id;
    `);
    offerId = offer.id;

    // Holder: explicitly takes the same row lock accept_business_offer()
    // itself takes internally, sleeps while holding it (its own later
    // call to the real RPC is reentrant -- same transaction, no
    // self-block), then commits. Racer: calls the real RPC directly,
    // fired mid-sleep, so its own internal `for update` on the same row
    // is genuinely blocked by Postgres until the holder commits.
    //
    // Real, disclosed correction, found while verifying "The Offer
    // System" Phase 1 (see CLAUDE.md): this script originally locked
    // business_request_offers (the offer row) as its own hold point --
    // but accept_business_offer()'s real first lock, pulled fresh from
    // its live body, is on business_requests (the PARENT request row,
    // `select ... from business_requests where id = v_offer.request_id
    // for update`), not the offer row itself, which the function never
    // explicitly locks at all until its own UPDATE statement touches it.
    // Locking the wrong resource first produced a real Postgres deadlock
    // (40P01) once Phase 1's changes lengthened the transaction slightly
    // (two new INSERTs before commit) -- the racer would acquire the
    // request lock first (since the holder was still asleep), then block
    // on the offer-row UPDATE (held by the holder); the holder would then
    // wake and block trying to acquire the now-racer-held request lock --
    // a classic reversed-lock-order deadlock, the exact same shape
    // already documented and fixed once for confirm_group_plan_offer in
    // the "Aug 17 2026 -- closing the last concurrency gap" section of
    // CLAUDE.md. Fixed the same way: lock the actual first row the
    // function's own body locks, in the same order it acquires locks in.
    const holderQuery = asUser(requesterId, `
      begin;
      select id from business_requests where id = '${requestId}' for update;
      select pg_sleep(2);
      select accept_business_offer('${offerId}') as result;
      commit;
    `);
    const racerQuery = asUser(requesterId, `
      select accept_business_offer('${offerId}') as result;
    `);

    const { holder, racer } = await runOverlapping({ holderQuery, racerQuery, racerDelayMs: 900 });

    assert(holder.ok, `holder's accept call succeeded (${holder.ok ? '' : holder.error?.message})`);
    assert(!racer.ok, `racer's genuinely-concurrent accept call on the same already-locked offer was rejected, not silently re-processed (${racer.ok ? 'it succeeded -- this is the bug' : racer.error?.message})`);
    assert(
      racer.elapsedMs > 1500,
      `racer's call was genuinely blocked at the Postgres level (took ${racer.elapsedMs}ms total wall time from test start, ` +
      `well past its own ~900ms fire time -- proving it queued behind the holder's lock)`
    );
    if (!racer.ok) {
      assert(
        /already been resolved|no longer available/i.test(racer.error?.message || ''),
        `racer's rejection message is the real "already resolved"/"no longer available" guard, not some unrelated error (got: ${racer.error?.message})`
      );
    }

    const [afterOffer] = await runSql(`select status from business_request_offers where id = '${offerId}';`);
    assert(afterOffer?.status === 'accepted', `offer status is exactly "accepted", not corrupted by the blocked racer (got: ${afterOffer?.status})`);

    const [afterRequest] = await runSql(`select status from business_requests where id = '${requestId}';`);
    assert(afterRequest?.status === 'fulfilled', `parent request flipped to fulfilled exactly once (got: ${afterRequest?.status})`);
  } finally {
    if (offerId) await runSql(`delete from business_request_offers where id = '${offerId}';`).catch(() => {});
    if (requestId) await runSql(`delete from business_requests where id = '${requestId}';`).catch(() => {});
    console.log('  (cleanup) test request/offer rows deleted');
  }

  summarize('business-offer-double-accept-concurrent');
}

main().catch((e) => {
  console.error('business-offer-double-accept-concurrent: script itself failed to run:', e.message, e.body ? JSON.stringify(e.body) : '');
  process.exitCode = 1;
});
