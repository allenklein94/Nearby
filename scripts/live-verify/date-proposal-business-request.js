#!/usr/bin/env node
// "The Offer System" Phase 5 (see CLAUDE.md's own plan, Decision 4). Real,
// repeatable live-verify script for date_proposals and the four new RPCs
// (propose_date/respond_to_date_proposal/withdraw_date_proposal/
// create_business_request_for_match), exercised end-to-end through a real
// existing match -- the locked shape, restated verbatim: Match -> Proposal
// -> Other person accepts -> Dating Experience created -> Business
// Request. Proves the real gate, not just the SQL text:
//   - a non-participant cannot propose, cannot respond, and gets zero
//     visibility into a match's own proposals.
//   - only one real undecided proposal can exist per match at a time.
//   - the proposer cannot accept/decline their own proposal -- only the
//     other person can (the real "Match != Date" enforcement).
//   - create_business_request_for_match() is rejected with no accepted
//     proposal at all, and stays rejected after a decline -- a bare
//     match, or a declined proposal, never authorizes the real fan-out.
//   - withdrawing a still-pending proposal frees the match up for a real
//     new one (the partial unique index only blocks status='proposed').
//   - once genuinely accepted, the fan-out succeeds with a real
//     party_size=2 and the resulting business_requests row is correctly
//     match_id-attributed; a repeat call is a genuine duplicate, not a
//     second row.
//   - real RLS (SET ROLE authenticated, not just a JWT claim) makes the
//     resulting request visible to BOTH match participants, not just
//     whichever one submitted it, and invisible to a genuine stranger.
//
// Reuses the one real existing match already in production (Google
// voice <-> Allen), same established convention as every other
// live-verify script in this suite -- Claude and Allen Klein have no
// relationship to this match and are the genuine non-participants for
// every negative test.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/date-proposal-business-request.js
const { runSql, runSqlAs, runSqlAsRls, assert, summarize } = require('./lib/db');

async function main() {
  console.log('date-proposal-business-request: verifying date_proposals and its four RPCs through a real existing match...');

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

  const [matchRow] = await runSql(`
    select id from matches where (user_a = '${googleVoiceId}' and user_b = '${allenId}') or (user_a = '${allenId}' and user_b = '${googleVoiceId}');
  `);
  const matchId = matchRow?.id;
  if (!matchId) {
    throw new Error('Needs the one real existing match between Google voice and Allen in this environment.');
  }

  let firstProposalId, secondProposalId, thirdProposalId, requestId;

  try {
    // ---------- propose_date: ownership + duplicate guard ----------
    let nonParticipantProposeRejected = false;
    try {
      await runSqlAs(claudeId, `select propose_date('${matchId}', 'live-verify: a stranger trying to propose') as result;`);
    } catch (e) {
      nonParticipantProposeRejected = e.message.includes('not part of this match');
    }
    assert(nonParticipantProposeRejected, 'a genuine non-participant (Claude) cannot propose a date on someone else\'s match');

    const proposeResult = await runSqlAs(googleVoiceId, `select propose_date('${matchId}', 'live-verify: dinner Friday at 7?') as result;`);
    firstProposalId = proposeResult[0].result?.proposalId;
    assert(!!firstProposalId, 'propose_date() succeeds for a real match participant (Google voice)');

    const [firstRow] = await runSql(`select status, proposed_by from date_proposals where id = '${firstProposalId}';`);
    assert(firstRow?.status === 'proposed', 'the real date_proposals row starts in status=proposed');
    assert(firstRow?.proposed_by === googleVoiceId, 'proposed_by is correctly attributed to Google voice, not spoofable');

    let duplicatePendingRejected = false;
    try {
      await runSqlAs(googleVoiceId, `select propose_date('${matchId}', 'live-verify: a second plan while one is still pending') as result;`);
    } catch (e) {
      duplicatePendingRejected = e.message.includes('already a plan awaiting');
    }
    assert(duplicatePendingRejected, 'a second proposal cannot be made while one is still genuinely pending for this match');

    // ---------- real RLS visibility: participants yes, stranger no ----------
    const strangerSeesProposal = await runSqlAsRls(claudeId, `select count(*)::int as c from date_proposals where id = '${firstProposalId}';`);
    assert(strangerSeesProposal[0].c === 0, 'under real RLS, a genuine non-participant (Claude) sees zero rows for this proposal');
    const otherPartySeesProposal = await runSqlAsRls(allenId, `select count(*)::int as c from date_proposals where id = '${firstProposalId}';`);
    assert(otherPartySeesProposal[0].c === 1, 'under real RLS, the other match participant (Allen) sees the pending proposal');

    // ---------- respond_to_date_proposal: only the OTHER person decides ----------
    let strangerRespondRejected = false;
    try {
      await runSqlAs(strangerId, `select respond_to_date_proposal('${firstProposalId}', true) as result;`);
    } catch (e) {
      strangerRespondRejected = true;
    }
    assert(strangerRespondRejected, 'a genuine stranger cannot respond to a date proposal');

    let sameSideAcceptRejected = false;
    try {
      await runSqlAs(googleVoiceId, `select respond_to_date_proposal('${firstProposalId}', true) as result;`);
    } catch (e) {
      sameSideAcceptRejected = e.message.includes('other person needs to respond');
    }
    assert(sameSideAcceptRejected, 'the real "Match != Date" gate: the proposer (Google voice) cannot accept/decline their own proposal');

    // ---------- the fan-out gate: no accepted proposal, no business request ----------
    let noProposalGateRejected = false;
    try {
      await runSqlAs(allenId, `select create_business_request_for_match('${matchId}', 'live-verify: find us somewhere', 40.0, -75.0, 'Coffee', 40, null, null, null, 15) as result;`);
    } catch (e) {
      noProposalGateRejected = e.message.includes('must be proposed and accepted');
    }
    assert(noProposalGateRejected, 'create_business_request_for_match() is rejected with a real error before any proposal has been accepted -- a bare match never authorizes the fan-out');

    // ---------- decline: still no fan-out afterward ----------
    const declineResult = await runSqlAs(allenId, `select respond_to_date_proposal('${firstProposalId}', false) as result;`);
    assert(declineResult[0].result?.status === 'declined', 'the real other party (Allen) can decline a proposal that isn\'t theirs');

    let declinedGateRejected = false;
    try {
      await runSqlAs(allenId, `select create_business_request_for_match('${matchId}', 'live-verify: find us somewhere', 40.0, -75.0, 'Coffee', 40, null, null, null, 15) as result;`);
    } catch (e) {
      declinedGateRejected = e.message.includes('must be proposed and accepted');
    }
    assert(declinedGateRejected, 'create_business_request_for_match() stays rejected after a real decline -- a declined proposal never authorizes the fan-out either');

    let repeatRespondRejected = false;
    try {
      await runSqlAs(allenId, `select respond_to_date_proposal('${firstProposalId}', true) as result;`);
    } catch (e) {
      repeatRespondRejected = true;
    }
    assert(repeatRespondRejected, 'responding a second time to an already-declined proposal is rejected, not silently re-processed');

    // ---------- a fresh proposal can now be made (the decline freed the unique index) ----------
    const secondProposeResult = await runSqlAs(googleVoiceId, `select propose_date('${matchId}', 'live-verify: how about Saturday brunch instead?') as result;`);
    secondProposalId = secondProposeResult[0].result?.proposalId;
    assert(!!secondProposalId, 'a real new proposal can be made after the prior one was declined');

    // ---------- withdraw: proposer-only, only while still pending ----------
    let nonProposerWithdrawRejected = false;
    try {
      await runSqlAs(allenId, `select withdraw_date_proposal('${secondProposalId}') as result;`);
    } catch (e) {
      nonProposerWithdrawRejected = e.message.includes('Only the person who proposed');
    }
    assert(nonProposerWithdrawRejected, 'only the real proposer (Google voice) can withdraw their own proposal -- Allen cannot');

    await runSqlAs(googleVoiceId, `select withdraw_date_proposal('${secondProposalId}') as result;`);
    const [withdrawnRow] = await runSql(`select status from date_proposals where id = '${secondProposalId}';`);
    assert(withdrawnRow?.status === 'withdrawn', 'the real proposer (Google voice) withdrawing their own pending proposal genuinely sets status=withdrawn');

    let repeatWithdrawRejected = false;
    try {
      await runSqlAs(googleVoiceId, `select withdraw_date_proposal('${secondProposalId}') as result;`);
    } catch (e) {
      repeatWithdrawRejected = true;
    }
    assert(repeatWithdrawRejected, 'withdrawing an already-withdrawn proposal a second time is rejected');

    // ---------- the real happy path: propose -> accept -> fan-out ----------
    const thirdProposeResult = await runSqlAs(googleVoiceId, `select propose_date('${matchId}', 'live-verify: coffee this weekend?') as result;`);
    thirdProposalId = thirdProposeResult[0].result?.proposalId;
    assert(!!thirdProposalId, 'a real new proposal can be made after the prior one was withdrawn');

    const acceptResult = await runSqlAs(allenId, `select respond_to_date_proposal('${thirdProposalId}', true) as result;`);
    assert(acceptResult[0].result?.status === 'accepted', 'the real other party (Allen) accepting genuinely flips the proposal to accepted');

    const fanoutResult = await runSqlAs(allenId, `select create_business_request_for_match('${matchId}', 'live-verify: coffee for two this weekend', 40.0, -75.0, 'Coffee', 40, null, null, null, 15) as result;`);
    requestId = fanoutResult[0].result?.requestId;
    assert(!!requestId, 'create_business_request_for_match() succeeds once a real proposal has genuinely been accepted');
    assert(fanoutResult[0].result?.partySize === 2, 'the real request is created with party_size=2 -- both match participants, never user-typed');

    const [requestRow] = await runSql(`select match_id, requester_id, status, party_size from business_requests where id = '${requestId}';`);
    assert(requestRow?.match_id === matchId, 'the real business_requests row is correctly attributed to this match via match_id');
    assert(requestRow?.status === 'open', 'the real request starts open');

    // ---------- duplicate protection ----------
    const duplicateResult = await runSqlAs(googleVoiceId, `select create_business_request_for_match('${matchId}', 'a second attempt at the same request', 40.0, -75.0, 'Coffee', 40, null, null, null, 15) as result;`);
    assert(duplicateResult[0].result?.requestId === requestId, 'a second fan-out attempt on the same still-open match request returns the existing real requestId, not a duplicate row');
    assert(duplicateResult[0].result?.duplicate === true, 'the duplicate attempt is honestly flagged as duplicate=true');

    const [dupCountRow] = await runSql(`select count(*)::int as c from business_requests where match_id = '${matchId}';`);
    assert(dupCountRow?.c === 1, 'exactly one real business_requests row exists for this match, not two');

    // ---------- real RLS: both participants see the resulting request, a stranger does not ----------
    const requesterSeesRequest = await runSqlAsRls(allenId, `select count(*)::int as c from business_requests where id = '${requestId}';`);
    assert(requesterSeesRequest[0].c === 1, 'under real RLS, the requester (Allen) sees the real resulting request');

    const otherPartySeesRequest = await runSqlAsRls(googleVoiceId, `select count(*)::int as c from business_requests where id = '${requestId}';`);
    assert(otherPartySeesRequest[0].c === 1, 'under real RLS, the OTHER match participant (Google voice, not the one who submitted the request) also sees it -- visible to both sides of the match, not just the submitter');

    const strangerSeesRequest = await runSqlAsRls(claudeId, `select count(*)::int as c from business_requests where id = '${requestId}';`);
    assert(strangerSeesRequest[0].c === 0, 'under real RLS, a genuine stranger (Claude) sees zero rows for this match-sourced request');
  } finally {
    if (requestId) {
      await runSql(`delete from business_request_offers where request_id = '${requestId}';`).catch(() => {});
      await runSql(`delete from business_requests where id = '${requestId}';`).catch(() => {});
    }
    for (const id of [firstProposalId, secondProposalId, thirdProposalId]) {
      if (id) await runSql(`delete from date_proposals where id = '${id}';`).catch(() => {});
    }
    console.log('  (cleanup) all test proposal/request rows deleted');
  }

  const [finalCheck] = await runSql(`select (select count(*) from date_proposals where match_id = '${matchId}') as proposals, (select count(*) from business_requests where match_id = '${matchId}') as requests;`);
  assert(finalCheck?.proposals === 0 && finalCheck?.requests === 0, `production is back to its exact pre-test baseline for this match (0 proposals, 0 match-sourced requests) -- got ${JSON.stringify(finalCheck)}`);

  summarize('date-proposal-business-request');
}

main().catch((e) => {
  console.error('date-proposal-business-request: script itself failed to run:', e.message);
  process.exitCode = 1;
});
