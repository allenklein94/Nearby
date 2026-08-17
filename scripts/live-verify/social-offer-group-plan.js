#!/usr/bin/env node
// "The Offer System" Phase 4 (see CLAUDE.md's own plan, Decision 3). Real,
// repeatable live-verify script for social_offers and the two new RPCs
// (submit_social_offer/respond_to_social_offer/mark_social_offer_viewed),
// exercised end-to-end through a real confirmed group plan -- the actual
// first shipped surface, per the plan's own text:
//   - a genuine confirmed group-plan participant, connected to the
//     initiator/requester (real accepted friendship), can submit a real
//     social offer, and the initiator can accept it.
//   - a genuine stranger with no connection at all is rejected server-side
//     both submitting an offer and responding to one, and a genuine
//     confirmed participant who is NOT the request's own requester is
//     also rejected trying to respond (only the requester decides).
//   - the request's own requester cannot make a social offer on their own
//     request.
//   - a repeat submit while already 'offered' is rejected.
//   - real RLS (SET ROLE authenticated, not just a JWT claim) genuinely
//     restricts visibility to the offerer, the requester, and the rest of
//     the confirmed group-plan roster -- a real stranger sees nothing.
//   - mark_social_offer_viewed() is a genuine, requester-scoped,
//     idempotent read receipt -- a non-requester's call is a silent no-op.
//
// Reuses the real existing connections already in production, same
// established convention as the C2/C3 concurrency scripts: Allen is a
// real accepted friend of Claude and a real match with Google voice, so
// Allen is the natural group-plan initiator; Allen Klein has no
// relationship with anyone and is the genuine stranger for every
// negative test.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/social-offer-group-plan.js
const { runSql, runSqlAs, runSqlAsRls, assert, summarize } = require('./lib/db');

async function main() {
  console.log('social-offer-group-plan: verifying social_offers and its two RPCs through a real confirmed group plan...');

  const rows = await runSql(`
    select p.id, p.display_name from profiles p
    where p.display_name in ('Allen', 'Claude', 'Google voice', 'Allen Klein');
  `);
  const byName = Object.fromEntries(rows.map((r) => [r.display_name, r.id]));
  const allenId = byName['Allen'];
  const claudeId = byName['Claude'];
  const googleVoiceId = byName['Google voice'];
  const strangerId = byName['Allen Klein'];
  if (!allenId || !claudeId || !googleVoiceId || !strangerId) {
    throw new Error('Needs all four real named profiles (Allen, Claude, Google voice, Allen Klein) in this environment.');
  }

  let allenRequestId, claudeRequestId, googleVoiceRequestId, proposalId, resultingRequestId, socialOfferId;

  try {
    // ---------- build a real confirmed group plan ----------
    const allenReq = await runSqlAs(allenId, `select create_business_request('live-verify: social offer test (Allen)', 40.0, -75.0, 'Coffee', 1, null, 40, null, null, null, 15, null) as result;`);
    allenRequestId = allenReq[0].result.requestId;
    const claudeReq = await runSqlAs(claudeId, `select create_business_request('live-verify: social offer test (Claude)', 40.0, -75.0, 'Coffee', 1, null, 40, null, null, null, 15, null) as result;`);
    claudeRequestId = claudeReq[0].result.requestId;
    const googleReq = await runSqlAs(googleVoiceId, `select create_business_request('live-verify: social offer test (Google voice)', 40.0, -75.0, 'Coffee', 1, null, 40, null, null, null, 15, null) as result;`);
    googleVoiceRequestId = googleReq[0].result.requestId;

    const proposeResult = await runSqlAs(allenId, `select propose_group_plan('${allenRequestId}', array['${claudeRequestId}','${googleVoiceRequestId}']::uuid[]) as result;`);
    proposalId = proposeResult[0].result;
    assert(!!proposalId, 'propose_group_plan() succeeds with two real connected invitees');

    await runSqlAs(claudeId, `select respond_to_group_plan('${proposalId}', true) as result;`);
    await runSqlAs(googleVoiceId, `select respond_to_group_plan('${proposalId}', true) as result;`);
    await runSqlAs(allenId, `select set_group_plan_budget('${proposalId}', 40) as result;`);
    // rule 7: setting the budget resets non-initiator participants back
    // to 'invited' -- re-accept before confirming.
    await runSqlAs(claudeId, `select respond_to_group_plan('${proposalId}', true) as result;`);
    await runSqlAs(googleVoiceId, `select respond_to_group_plan('${proposalId}', true) as result;`);

    const confirmResult = await runSqlAs(allenId, `select confirm_group_plan('${proposalId}', array[]::uuid[]) as result;`);
    resultingRequestId = confirmResult[0].result.requestId;
    assert(!!resultingRequestId, 'confirm_group_plan() succeeds, produces a real shared request (requester = Allen, the initiator)');

    // ---------- submit_social_offer: eligibility + ownership ----------
    let strangerRejected = false;
    try {
      await runSqlAs(strangerId, `select submit_social_offer('${resultingRequestId}', 'I can help out') as result;`);
    } catch (e) {
      strangerRejected = e.message.includes('connected');
    }
    assert(strangerRejected, 'a genuine stranger (no friendship/match/shared community/gathering) is rejected submitting a social offer, with the real eligibility message');

    let ownerRejected = false;
    try {
      await runSqlAs(allenId, `select submit_social_offer('${resultingRequestId}', 'I will host myself') as result;`);
    } catch (e) {
      ownerRejected = e.message.includes('own request');
    }
    assert(ownerRejected, 'the request\'s own requester (Allen) cannot make a social offer on their own request');

    const submitResult = await runSqlAs(claudeId, `select submit_social_offer('${resultingRequestId}', 'live-verify: I can drive everyone there') as result;`);
    socialOfferId = submitResult[0].result?.offerId;
    assert(!!socialOfferId, 'a genuinely connected, confirmed group-plan participant (Claude, real accepted friend of Allen) can submit a real social offer');

    const [offerRow] = await runSql(`select status, offer_description, request_id, offerer_id from social_offers where id = '${socialOfferId}';`);
    assert(offerRow?.status === 'offered', 'the real social_offers row starts in status=offered');
    assert(offerRow?.offerer_id === claudeId, 'the real row is correctly attributed to Claude, not spoofable');

    let repeatSubmitRejected = false;
    try {
      await runSqlAs(claudeId, `select submit_social_offer('${resultingRequestId}', 'a second offer') as result;`);
    } catch (e) {
      repeatSubmitRejected = true;
    }
    assert(repeatSubmitRejected, 'a repeat submit while the existing offer is still \'offered\' is rejected, not silently duplicated');

    // ---------- real RLS, not just the RPC's own internal check ----------
    const strangerSees = await runSqlAsRls(strangerId, `select count(*)::int as c from social_offers where id = '${socialOfferId}';`);
    assert(strangerSees[0].c === 0, 'under real RLS (SET ROLE authenticated), a genuine stranger sees zero rows for this social offer');

    const offererSees = await runSqlAsRls(claudeId, `select count(*)::int as c from social_offers where id = '${socialOfferId}';`);
    assert(offererSees[0].c === 1, 'under real RLS, the offerer (Claude) sees their own social offer');

    const requesterSees = await runSqlAsRls(allenId, `select count(*)::int as c from social_offers where id = '${socialOfferId}';`);
    assert(requesterSees[0].c === 1, 'under real RLS, the request\'s own requester (Allen) sees the social offer');

    const rosterSees = await runSqlAsRls(googleVoiceId, `select count(*)::int as c from social_offers where id = '${socialOfferId}';`);
    assert(rosterSees[0].c === 1, 'under real RLS, a genuine confirmed group-plan participant who is neither the offerer nor the requester (Google voice) still sees it -- visible to the whole roster, per the plan\'s own text');

    // ---------- respond_to_social_offer: only the real requester decides ----------
    let strangerRespondRejected = false;
    try {
      await runSqlAs(strangerId, `select respond_to_social_offer('${socialOfferId}', true) as result;`);
    } catch (e) {
      strangerRespondRejected = true;
    }
    assert(strangerRespondRejected, 'a genuine stranger cannot respond to a social offer');

    let nonRequesterParticipantRejected = false;
    try {
      await runSqlAs(googleVoiceId, `select respond_to_social_offer('${socialOfferId}', true) as result;`);
    } catch (e) {
      nonRequesterParticipantRejected = true;
    }
    assert(nonRequesterParticipantRejected, 'a genuine confirmed participant who is NOT the request\'s own requester (Google voice) cannot accept/decline someone else\'s social offer -- only the requester decides');

    // ---------- mark_social_offer_viewed: requester-scoped, idempotent ----------
    const beforeViewed = await runSql(`select viewed_at from social_offers where id = '${socialOfferId}';`);
    assert(beforeViewed[0].viewed_at === null, 'viewed_at starts genuinely null');

    await runSqlAs(claudeId, `select mark_social_offer_viewed('${socialOfferId}') as result;`);
    const afterOffererCall = await runSql(`select viewed_at from social_offers where id = '${socialOfferId}';`);
    assert(afterOffererCall[0].viewed_at === null, 'a non-requester (the offerer themselves, Claude) calling mark_social_offer_viewed() is a silent no-op -- viewed_at is only ever set by the real requester');

    await runSqlAs(allenId, `select mark_social_offer_viewed('${socialOfferId}') as result;`);
    const afterRequesterCall = await runSql(`select viewed_at from social_offers where id = '${socialOfferId}';`);
    assert(!!afterRequesterCall[0].viewed_at, 'the real requester (Allen) calling mark_social_offer_viewed() genuinely sets viewed_at');

    const viewedAtFirst = afterRequesterCall[0].viewed_at;
    await runSqlAs(allenId, `select mark_social_offer_viewed('${socialOfferId}') as result;`);
    const afterRepeatCall = await runSql(`select viewed_at from social_offers where id = '${socialOfferId}';`);
    assert(afterRepeatCall[0].viewed_at === viewedAtFirst, 'a repeat call from the real requester does not overwrite the original viewed_at -- genuinely idempotent');

    // ---------- accept, the real happy path ----------
    const respondResult = await runSqlAs(allenId, `select respond_to_social_offer('${socialOfferId}', true) as result;`);
    assert(respondResult[0].result?.status === 'accepted', 'the real requester (Allen) accepting the offer genuinely flips it to accepted');

    const [finalOfferRow] = await runSql(`select status, responded_at from social_offers where id = '${socialOfferId}';`);
    assert(finalOfferRow?.status === 'accepted', 'the real social_offers row itself reads accepted');
    assert(!!finalOfferRow?.responded_at, 'a real responded_at was stamped');

    let repeatRespondRejected = false;
    try {
      await runSqlAs(allenId, `select respond_to_social_offer('${socialOfferId}', false) as result;`);
    } catch (e) {
      repeatRespondRejected = true;
    }
    assert(repeatRespondRejected, 'responding a second time to an already-accepted offer is rejected, not silently re-processed');
  } finally {
    // The real, full FK dependency chain, found live while verifying
    // this exact script (two genuine ordering bugs, not a throttling
    // flake -- confirmed by getting the real 23503 error instead of
    // trusting a swallowed .catch()): group_plan_participants.
    // source_request_id references each of the 3 original per-
    // participant requests, AND confirm_group_plan() stamps
    // superseded_by_group_plan_id onto those same 3 rows pointing at
    // the proposal -- so group_plan_participants must be deleted
    // BEFORE the 3 original requests, which must in turn be deleted
    // BEFORE the proposal itself. Plus the already-known cycle:
    // business_requests.group_plan_id <-> group_plan_proposals.
    // resulting_request_id, nulled on both sides before either delete.
    if (socialOfferId) await runSql(`delete from social_offers where id = '${socialOfferId}';`).catch(() => {});
    if (proposalId && resultingRequestId) {
      await runSql(`update business_requests set group_plan_id = null where id = '${resultingRequestId}';`).catch(() => {});
      await runSql(`update group_plan_proposals set resulting_request_id = null where id = '${proposalId}';`).catch(() => {});
      await runSql(`delete from business_request_offers where request_id = '${resultingRequestId}';`).catch(() => {});
      await runSql(`delete from business_requests where id = '${resultingRequestId}';`).catch(() => {});
    }
    if (proposalId) {
      await runSql(`delete from group_plan_participants where proposal_id = '${proposalId}';`).catch(() => {});
    }
    for (const id of [allenRequestId, claudeRequestId, googleVoiceRequestId]) {
      if (id) {
        await runSql(`delete from business_request_offers where request_id = '${id}';`).catch(() => {});
        await runSql(`delete from business_requests where id = '${id}';`).catch(() => {});
      }
    }
    if (proposalId) {
      await runSql(`delete from group_plan_proposals where id = '${proposalId}';`).catch(() => {});
    }
    console.log('  (cleanup) all test request/proposal/participant/social-offer rows deleted');
  }

  const [finalCheck] = await runSql(`select (select count(*) from social_offers) as social_offers, (select count(*) from business_requests) as requests, (select count(*) from group_plan_proposals) as proposals;`);
  assert(finalCheck?.social_offers === 0 && finalCheck?.requests === 0 && finalCheck?.proposals === 0, `production is back to its exact pre-test baseline (0 social offers, 0 requests, 0 proposals) -- got ${JSON.stringify(finalCheck)}`);

  summarize('social-offer-group-plan');
}

main().catch((e) => {
  console.error('social-offer-group-plan: script itself failed to run:', e.message);
  process.exitCode = 1;
});
