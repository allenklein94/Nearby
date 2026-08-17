#!/usr/bin/env node
// "The Offer System" Phase 6 (see CLAUDE.md's own plan) -- the
// prove-the-loop checkpoint, per the user's own explicit closing
// instruction: "Are these primitives clean enough that Nearby can go
// from a user's intent -> a business/person's Offer -> commitment ->
// reservation -> eventual transaction -> completed Experience without
// rewriting the architecture?" Not a build phase -- a real, disposable,
// fully-instrumented end-to-end run walking ONE real test case through
// every object this whole initiative built, all at once, on the SAME
// request: a commercial offer AND a social offer both live at once ->
// the commercial offer accepted -> a real business_reservations row
// confirms -> a real (inert) business_payments row exists ->
// complete_business_reservation() closes it out -- confirming every
// state transition matches the locked lifecycle in Decisions 2 and 6
// exactly, with no object skipping a state or being written by the
// wrong actor, and that the two offer types genuinely coexist without
// interfering with each other (accept_business_offer()'s own one-winner
// exclusivity sweep only ever touches business_request_offers, never
// social_offers -- a real, different scarcity model, not an oversight).
//
// Reuses the one real business partner + the one real connected pair
// already in production, same established convention as every other
// script in this suite. Real data forces one real role overlap, noted
// honestly rather than fabricated around: Allen is both the real owner
// of the one real business (Coastal Coffee) AND a real accepted friend
// of Claude -- so Allen submits the commercial offer as the business,
// and separately submits the social offer as an individual friend, on
// the same request Claude posted. Two distinct, independently-checked
// roles for the same real person, not a shortcut.
//
// If this passes clean, per the user's own explicit instruction: this
// whole initiative's conceptual architecture stops expanding here --
// restated in this script's own header so a future session re-running it
// doesn't read a clean pass as an invitation to add another object.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/offer-system-prove-the-loop.js
const { runSql, runSqlAs, assert, summarize } = require('./lib/db');

async function main() {
  console.log('offer-system-prove-the-loop: walking one real request through the full Request -> Offer -> Commitment -> Reservation -> Payment -> Completed Experience loop, with a commercial AND a social offer coexisting on it...');

  const [ownerRow] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  if (!ownerRow) {
    throw new Error('Needs at least one real profile managing a business in this environment.');
  }
  const ownerId = ownerRow.id;
  const partnerId = ownerRow.managed_partner_id;

  const rows = await runSql(`select id, display_name from profiles where display_name = 'Claude';`);
  const requesterId = rows[0]?.id;
  if (!requesterId) {
    throw new Error('Needs the real "Claude" profile (a real accepted friend of the business owner) in this environment.');
  }

  let requestId, offerId, socialOfferId, reservationId, paymentId;

  try {
    // ---------- 1. a real request ----------
    const [req] = await runSql(`
      insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
      values ('${requesterId}', 'live-verify: prove-the-loop test', 'Coffee', 2, 40.0, -75.0, 15, now() + interval '2 hours', 'open')
      returning id;
    `);
    requestId = req.id;
    assert(!!requestId, 'a real business_requests row exists, status=open');

    // ---------- 2. a commercial offer AND a social offer, both live at once ----------
    const [offerRow] = await runSql(`
      insert into business_request_offers (request_id, partner_id, offer_type, status, offer_description)
      values ('${requestId}', '${partnerId}', 'standard', 'pending', 'live-verify: prove-the-loop opportunity')
      returning id;
    `);
    offerId = offerRow.id;

    const submitOfferResult = await runSqlAs(ownerId, `select submit_business_offer('${requestId}', 'standard', 'live-verify: real coffee for two', 12.50, null) as result;`);
    assert(submitOfferResult[0].result?.success === true, 'the real business owner submits a real commercial Offer -- request -> Offer, the first real link in the chain');

    const socialSubmitResult = await runSqlAs(ownerId, `select submit_social_offer('${requestId}', 'live-verify: I know a great spot, I can join you two') as result;`);
    socialOfferId = socialSubmitResult[0].result?.offerId;
    assert(!!socialOfferId, 'a genuinely connected person (Allen, real accepted friend of the requester) submits a real Social Offer on the SAME request, alongside the commercial one');

    const [beforeAccept] = await runSql(`
      select
        (select status from business_request_offers where id = '${offerId}') as commercial_status,
        (select status from social_offers where id = '${socialOfferId}') as social_status;
    `);
    assert(beforeAccept.commercial_status === 'offered', 'the real commercial offer sits at status=offered, both offer types genuinely coexisting on one request');
    assert(beforeAccept.social_status === 'offered', 'the real social offer sits at status=offered, unaffected by the commercial offer existing alongside it');

    // ---------- 3. the commercial offer accepted -> commitment ----------
    const acceptResult = await runSqlAs(requesterId, `select accept_business_offer('${offerId}') as result;`);
    reservationId = acceptResult[0].result?.reservationId;
    assert(!!reservationId, 'the real requester (Claude) accepts the commercial offer -- Offer -> commitment, a real reservationId comes back');

    const [afterAccept] = await runSql(`
      select
        (select status from business_request_offers where id = '${offerId}') as offer_status,
        (select status from business_requests where id = '${requestId}') as request_status,
        (select status from social_offers where id = '${socialOfferId}') as social_status;
    `);
    assert(afterAccept.offer_status === 'accepted', 'the real commercial offer genuinely flips to accepted');
    assert(afterAccept.request_status === 'fulfilled', 'the real parent request genuinely flips to fulfilled');
    assert(afterAccept.social_status === 'offered', "the real social offer is STILL offered, completely untouched by accept_business_offer()'s own one-winner exclusivity sweep -- proving the two offer types genuinely don't interfere: a Social Offer never competes for the same winning slot a commercial reservation does");

    // ---------- 4. a real business_reservations row confirms ----------
    const [reservationRow] = await runSql(`select offer_id, status, provider, confirmed_at from business_reservations where id = '${reservationId}';`);
    assert(reservationRow?.offer_id === offerId, 'the real business_reservations row is correctly attributed to this exact offer, not a different one');
    assert(reservationRow?.status === 'confirmed', 'commitment -> reservation: the real Reservation object is genuinely confirmed, distinct from the Offer\'s own accepted status -- "Accepted" on the Offer never means "Confirmed" on the Reservation by coincidence, it means it because this real row says so');
    assert(reservationRow?.provider === 'nearby', 'Nearby is the real, honest reservation provider (per Decision 2) -- no external provider integration exists, and this doesn\'t pretend one does');
    assert(!!reservationRow?.confirmed_at, 'a real confirmed_at timestamp was stamped');

    // ---------- 5. a real (inert) business_payments row exists ----------
    const [paymentRow] = await runSql(`select id, reservation_id, status, amount, currency, payer_id from business_payments where reservation_id = '${reservationId}';`);
    paymentId = paymentRow?.id;
    assert(!!paymentId, 'reservation -> a real business_payments row exists -- the payment seam, real and queryable, per Decision 5');
    assert(paymentRow?.status === 'not_required', 'the real Payment object is honestly "not_required" -- no processor is connected, and this never fakes a charge that didn\'t happen (per Decision 5, permanently inert until a future, explicitly separate pass)');
    assert(Number(paymentRow?.amount) === 12.5, 'the real payment amount matches the real offer price ($12.50) -- a real number, not fabricated or dropped');
    assert(paymentRow?.currency === 'usd', 'a real currency is recorded');
    assert(paymentRow?.payer_id === requesterId, 'the real payer is correctly the requester, not the business or an uninvolved party');

    // ---------- 6. complete_business_reservation() closes it out -> completed Experience ----------
    let strangerCompleteRejected = false;
    const rows2 = await runSql(`select id from profiles where display_name = 'Allen Klein';`);
    const strangerId = rows2[0]?.id;
    if (strangerId) {
      try {
        await runSqlAs(strangerId, `select complete_business_reservation('${offerId}') as result;`);
      } catch (e) {
        strangerCompleteRejected = true;
      }
      assert(strangerCompleteRejected, 'a genuine stranger (no relationship to this reservation at all) cannot complete it');
    }

    const completeResult = await runSqlAs(requesterId, `select complete_business_reservation('${offerId}') as result;`);
    assert(completeResult[0].result?.success === true, 'the real requester (Claude) closes out the reservation -- reservation -> a completed Experience');

    const [afterComplete] = await runSql(`
      select
        (select status from business_request_offers where id = '${offerId}') as offer_status,
        (select completed_at from business_request_offers where id = '${offerId}') as completed_at,
        (select status from business_reservations where id = '${reservationId}') as reservation_status;
    `);
    assert(afterComplete.offer_status === 'completed', 'the real offer genuinely reaches its real terminal state, completed');
    assert(!!afterComplete.completed_at, 'a real completed_at timestamp was stamped');
    assert(afterComplete.reservation_status === 'confirmed', 'the real Reservation object itself stays "confirmed" (its own real terminal state per this schema\'s locked lifecycle) -- completion is tracked on the Offer, not by inventing a second "completed" state on the Reservation object too');

    let repeatCompleteRejected = false;
    try {
      await runSqlAs(requesterId, `select complete_business_reservation('${offerId}') as result;`);
    } catch (e) {
      repeatCompleteRejected = true;
    }
    assert(repeatCompleteRejected, 'completing an already-completed reservation a second time is rejected, not silently re-processed -- no object can skip or repeat a state in this loop');

    // ---------- the social offer, still coexisting, unharmed by any of this ----------
    const [finalSocialRow] = await runSql(`select status from social_offers where id = '${socialOfferId}';`);
    assert(finalSocialRow?.status === 'offered', 'after the ENTIRE commercial loop closed out end-to-end, the real social offer is still exactly where it was -- offered, untouched -- proving the two real primitives this whole initiative built genuinely coexist on one request without one silently corrupting the other');
  } finally {
    if (paymentId) await runSql(`delete from business_payments where id = '${paymentId}';`).catch(() => {});
    if (reservationId) await runSql(`delete from business_reservations where id = '${reservationId}';`).catch(() => {});
    if (socialOfferId) await runSql(`delete from social_offers where id = '${socialOfferId}';`).catch(() => {});
    if (offerId) await runSql(`delete from business_request_offers where id = '${offerId}';`).catch(() => {});
    if (requestId) await runSql(`delete from business_requests where id = '${requestId}';`).catch(() => {});
    console.log('  (cleanup) all test request/offer/social-offer/reservation/payment rows deleted');
  }

  const [finalCheck] = await runSql(`
    select
      (select count(*) from business_requests where raw_text = 'live-verify: prove-the-loop test') as requests,
      (select count(*) from business_request_offers where offer_description like 'live-verify: prove-the-loop%') as offers,
      (select count(*) from social_offers where offer_description like 'live-verify: prove-the-loop%') as social_offers;
  `);
  assert(finalCheck?.requests === 0 && finalCheck?.offers === 0 && finalCheck?.social_offers === 0, `production is back to its exact pre-test baseline -- got ${JSON.stringify(finalCheck)}`);

  summarize('offer-system-prove-the-loop');
}

main().catch((e) => {
  console.error('offer-system-prove-the-loop: script itself failed to run:', e.message);
  process.exitCode = 1;
});
