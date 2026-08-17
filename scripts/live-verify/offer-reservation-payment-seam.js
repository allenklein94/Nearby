#!/usr/bin/env node
// "The Offer System" Phase 1 (see CLAUDE.md's "The Offer System: Request ->
// Offer -> Commitment" plan, Decisions 2/5/6). Real, repeatable live-verify
// script for the new Reservation + Payment seams and the three Offer-
// lifecycle refinements this phase added:
//   - accept_business_offer() now also creates a real, immediately-
//     confirmed business_reservations row and a real, permanently-inert
//     business_payments row -- "Accepted" on the Offer must never be
//     conflated with "Confirmed" on the Reservation, so both objects are
//     checked independently here, not just the Offer's own status.
//   - withdraw_business_offer() is a real, previously-unrepresentable
//     state (a business rescinding an offer it already sent, before the
//     consumer accepted it) -- distinct from decline (never offered) and
//     cancel (post-hoc). Only valid from 'offered'.
//   - mark_business_offer_viewed() is a real, honest read-receipt --
//     idempotent, and only the actual requester's own call can set it.
//   - complete_business_reservation() now also verifies a confirmed
//     Reservation exists before allowing completion, not just that the
//     Offer itself says 'accepted'.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/offer-reservation-payment-seam.js
const { runSql, runSqlAs, assert, summarize } = require('./lib/db');

async function main() {
  console.log('offer-reservation-payment-seam: verifying the Phase 1 Reservation/Payment seams and Offer-lifecycle refinements...');

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
  const requesterId = others[0].id;
  const strangerId = others[1].id;

  let requestWithdrawId, offerWithdrawId;
  let requestAcceptId, offerAcceptId;
  let requestViewId, offerViewId;
  let reservationId;

  try {
    // ---------- withdraw path ----------
    const [reqW] = await runSql(`
      insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
      values ('${requesterId}', 'live-verify: offer withdraw test', 'Coffee', 2, 40.0, -75.0, 15, now() + interval '2 hours', 'open')
      returning id;
    `);
    requestWithdrawId = reqW.id;
    const [offW] = await runSql(`
      insert into business_request_offers (request_id, partner_id, offer_type, status, offer_description)
      values ('${requestWithdrawId}', '${partnerId}', 'standard', 'offered', 'live-verify test offer (withdraw)')
      returning id;
    `);
    offerWithdrawId = offW.id;

    let strangerWithdrawRejected = false;
    try {
      await runSqlAs(strangerId, `select withdraw_business_offer('${offerWithdrawId}') as result;`);
    } catch (e) {
      strangerWithdrawRejected = true;
    }
    assert(strangerWithdrawRejected, 'withdraw_business_offer() rejects a caller who does not manage a business');

    const withdrawResult = await runSqlAs(ownerId, `select withdraw_business_offer('${offerWithdrawId}') as result;`);
    assert(withdrawResult?.[0]?.result?.success === true, 'the real business owner can withdraw a live offered offer');

    const [afterWithdraw] = await runSql(`select status from business_request_offers where id = '${offerWithdrawId}';`);
    assert(afterWithdraw?.status === 'withdrawn', 'offer status is genuinely "withdrawn", not silently left as "offered"');

    let secondWithdrawRejected = false;
    try {
      await runSqlAs(ownerId, `select withdraw_business_offer('${offerWithdrawId}') as result;`);
    } catch (e) {
      secondWithdrawRejected = true;
    }
    assert(secondWithdrawRejected, 'a second withdraw attempt on an already-withdrawn offer is rejected');

    let completeOnWithdrawnRejected = false;
    try {
      await runSqlAs(requesterId, `select complete_business_reservation('${offerWithdrawId}') as result;`);
    } catch (e) {
      completeOnWithdrawnRejected = true;
    }
    assert(completeOnWithdrawnRejected, 'complete_business_reservation() rejects a withdrawn offer (never accepted, no reservation exists)');

    // ---------- viewed_at path ----------
    const [reqV] = await runSql(`
      insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
      values ('${requesterId}', 'live-verify: offer viewed_at test', 'Coffee', 2, 40.0, -75.0, 15, now() + interval '2 hours', 'open')
      returning id;
    `);
    requestViewId = reqV.id;
    const [offV] = await runSql(`
      insert into business_request_offers (request_id, partner_id, offer_type, status, offer_description)
      values ('${requestViewId}', '${partnerId}', 'standard', 'offered', 'live-verify test offer (viewed)')
      returning id;
    `);
    offerViewId = offV.id;

    await runSqlAs(strangerId, `select mark_business_offer_viewed('${offerViewId}');`);
    const [afterStrangerView] = await runSql(`select viewed_at from business_request_offers where id = '${offerViewId}';`);
    assert(afterStrangerView?.viewed_at === null, 'a non-requester calling mark_business_offer_viewed() is a silent no-op, viewed_at stays null');

    await runSqlAs(requesterId, `select mark_business_offer_viewed('${offerViewId}');`);
    const [afterRealView] = await runSql(`select viewed_at from business_request_offers where id = '${offerViewId}';`);
    assert(afterRealView?.viewed_at !== null, 'the real requester calling mark_business_offer_viewed() genuinely sets viewed_at');
    const firstViewedAt = afterRealView.viewed_at;

    await new Promise((r) => setTimeout(r, 1100));
    await runSqlAs(requesterId, `select mark_business_offer_viewed('${offerViewId}');`);
    const [afterSecondView] = await runSql(`select viewed_at from business_request_offers where id = '${offerViewId}';`);
    assert(afterSecondView?.viewed_at === firstViewedAt, 'a repeat view call is idempotent -- viewed_at does not get overwritten with a later timestamp');

    // ---------- accept -> reservation + payment path ----------
    const [reqA] = await runSql(`
      insert into business_requests (requester_id, raw_text, category, party_size, budget_max, latitude, longitude, radius_miles, expires_at, status)
      values ('${requesterId}', 'live-verify: reservation/payment seam test', 'Coffee', 2, 60, 40.0, -75.0, 15, now() + interval '2 hours', 'open')
      returning id;
    `);
    requestAcceptId = reqA.id;
    const [offA] = await runSql(`
      insert into business_request_offers (request_id, partner_id, offer_type, offer_price, status, offer_description)
      values ('${requestAcceptId}', '${partnerId}', 'standard', 45.00, 'offered', 'live-verify test offer (accept)')
      returning id;
    `);
    offerAcceptId = offA.id;

    const [beforeReservation] = await runSql(`select count(*)::int as c from business_reservations where offer_id = '${offerAcceptId}';`);
    assert(beforeReservation?.c === 0, 'no business_reservations row exists yet, before the offer is accepted');

    const acceptResult = await runSqlAs(requesterId, `select accept_business_offer('${offerAcceptId}') as result;`);
    assert(acceptResult?.[0]?.result?.success === true, 'accept_business_offer() succeeds for the real requester');
    reservationId = acceptResult?.[0]?.result?.reservationId;
    assert(!!reservationId, 'accept_business_offer() returns a real reservationId');

    const [afterAcceptOffer] = await runSql(`select status from business_request_offers where id = '${offerAcceptId}';`);
    assert(afterAcceptOffer?.status === 'accepted', 'the offer itself flips to "accepted"');

    const [reservationRow] = await runSql(`select status, provider, confirmed_at, offer_id from business_reservations where offer_id = '${offerAcceptId}';`);
    assert(!!reservationRow, 'a real business_reservations row now exists, distinct from the Offer row');
    assert(reservationRow?.status === 'confirmed', 'the reservation is immediately "confirmed" -- Nearby is the sole provider today, per Decision 2');
    assert(reservationRow?.provider === 'nearby', 'the reservation\'s provider is honestly "nearby", not a fabricated external integration');
    assert(reservationRow?.confirmed_at !== null, 'confirmed_at is genuinely stamped');

    const [paymentRow] = await runSql(`select status, amount, currency, payer_id, provider from business_payments where reservation_id = '${reservationId}';`);
    assert(!!paymentRow, 'a real business_payments row now exists -- the Decision 5 seam');
    assert(paymentRow?.status === 'not_required', 'the payment stays "not_required" -- permanently inert, nothing was actually charged');
    assert(paymentRow?.payer_id === requesterId, 'the payment correctly records the real requester as payer_id');
    assert(paymentRow?.provider === null, 'the payment provider is honestly null -- no real processor connected yet');
    assert(Number(paymentRow?.amount) === 45.00, 'the payment amount carries the offer\'s own real price, not a fabricated number');

    let acceptedWithdrawRejected = false;
    try {
      await runSqlAs(ownerId, `select withdraw_business_offer('${offerAcceptId}') as result;`);
    } catch (e) {
      acceptedWithdrawRejected = true;
    }
    assert(acceptedWithdrawRejected, 'withdraw_business_offer() rejects an already-accepted offer -- withdraw only ever applies to a still-offered one');

    const completeResult = await runSqlAs(requesterId, `select complete_business_reservation('${offerAcceptId}') as result;`);
    assert(completeResult?.[0]?.result?.success === true, 'complete_business_reservation() succeeds once a real confirmed Reservation actually exists');

    const [afterComplete] = await runSql(`select status, completed_at from business_request_offers where id = '${offerAcceptId}';`);
    assert(afterComplete?.status === 'completed', 'the offer correctly reaches "completed"');
    assert(afterComplete?.completed_at !== null, 'completed_at is genuinely stamped');
  } finally {
    if (reservationId) await runSql(`delete from business_payments where reservation_id = '${reservationId}';`).catch(() => {});
    if (offerAcceptId) await runSql(`delete from business_reservations where offer_id = '${offerAcceptId}';`).catch(() => {});
    if (offerAcceptId) await runSql(`delete from business_request_offers where id = '${offerAcceptId}';`).catch(() => {});
    if (requestAcceptId) await runSql(`delete from business_requests where id = '${requestAcceptId}';`).catch(() => {});
    if (offerViewId) await runSql(`delete from business_request_offers where id = '${offerViewId}';`).catch(() => {});
    if (requestViewId) await runSql(`delete from business_requests where id = '${requestViewId}';`).catch(() => {});
    if (offerWithdrawId) await runSql(`delete from business_request_offers where id = '${offerWithdrawId}';`).catch(() => {});
    if (requestWithdrawId) await runSql(`delete from business_requests where id = '${requestWithdrawId}';`).catch(() => {});
    console.log('  (cleanup) all test request/offer/reservation/payment rows deleted');
  }

  summarize('offer-reservation-payment-seam');
}

main().catch((e) => {
  console.error('offer-reservation-payment-seam: script itself failed to run:', e.message);
  process.exitCode = 1;
});
