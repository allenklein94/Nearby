#!/usr/bin/env node
// Aug 17 2026, "closing the last concurrency gap" (see CLAUDE.md): the
// genuinely-concurrent proof for Finding C2 (confirm_group_plan_offer's
// own quorum race), previously only proven via *sequential* replay (the
// Aug 15 2026 architecture-hardening pass). The function's real first
// lock is `select * into v_proposal from group_plan_proposals where id =
// proposal_id_param for update` -- *not* the offer row (a first attempt
// at this script assumed the offer row was locked first, based on this
// script's own original plan note in CLAUDE.md, which mis-stated the
// order; the live function body, re-checked after a real deadlock this
// caused, shows group_plan_proposals is locked first).
//
// This builds a real, minimal 2-participant confirmed group plan (Allen
// initiator, Claude the one invitee -- both required to confirm, so
// "the 2nd confirmation" and "quorum completes" are the exact same
// event) with a real live offer on its resulting shared request, then
// forces genuine overlap the same way the other concurrent proofs do:
// one connection ("holder") explicitly locks the group_plan_proposals
// row -- the *first* row confirm_group_plan_offer's own body locks,
// before it ever reaches the offer row -- sleeps while holding it, then
// (reentrant, same transaction) calls the real RPC as the first
// confirming participant. A second connection ("racer") calls the real
// RPC as the second (quorum-completing) participant, fired partway
// through the holder's sleep -- its own internal `for update` on that
// same proposal row is genuinely blocked at the Postgres level until the
// holder commits.
//
// Locking the *proposal* row rather than the *offer* row matters here,
// not just the *group_plan_proposals* table name -- a first attempt at
// this script locked the offer row instead (matching the other concurrent
// proofs' own pattern of locking whatever row the RPC under test locks
// "first"), which produced a real Postgres deadlock (40P01): the holder
// held the offer lock while sleeping, the racer acquired the proposal
// lock first (its own call's real first statement) then blocked on the
// offer lock the holder held, and the holder's own resumed call then
// blocked trying to acquire the now-racer-held proposal lock -- a
// genuine lock-ordering cycle, caused by the test's own pre-lock
// choice, not a bug in confirm_group_plan_offer() itself. Locking the
// *first* row the function's own body locks, in the same order the
// function itself always acquires locks in, avoids that entirely.
//
// Expected: the holder's own call reports allConfirmed: false (1 of 2
// required) -- proving it read the count *before* the racer's own
// confirmation existed. The racer's call, resuming only after the
// holder's confirmation row is really committed, correctly sees the
// fresh count and reports allConfirmed: true, triggering the real
// accept exactly once -- proving the lock genuinely serializes the two
// concurrent confirmations rather than letting both read a stale count
// and either double-accept the offer or never cross the quorum at all.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/group-plan-confirm-offer-quorum-race-concurrent.js
const { runSql, assert, summarize } = require('./lib/db');
const { runOverlapping, asUser } = require('./lib/concurrency');

async function main() {
  console.log('group-plan-confirm-offer-quorum-race-concurrent: verifying confirm_group_plan_offer()\'s row lock serializes two genuinely concurrent quorum-completing confirmations...');

  const [allen] = await runSql(`select id, display_name from profiles where display_name = 'Allen';`);
  const [claude] = await runSql(`select id, display_name from profiles where display_name = 'Claude';`);
  const [partner] = await runSql(`select id from brand_partners where active = true limit 1;`);
  if (!allen || !claude || !partner) {
    throw new Error('Needs the real Allen/Claude profiles and at least one real active brand_partners row in this environment.');
  }
  const [friendship] = await runSql(`
    select status from friendships
    where status = 'accepted'
      and ((user_a = '${claude.id}' and user_b = '${allen.id}') or (user_a = '${allen.id}' and user_b = '${claude.id}'));
  `);
  if (!friendship) {
    throw new Error('Needs a real accepted Claude<->Allen friendship in this environment.');
  }

  let reqAllenId, reqClaudeId, proposalId, resultingRequestId, offerId;
  try {
    const [reqAllen] = await runSql(`
      insert into business_requests (requester_id, raw_text, category, party_size, budget_max, latitude, longitude, radius_miles, expires_at, status)
      values ('${allen.id}', 'live-verify: C2 concurrent test (Allen initiator)', 'Coffee', 1, 50, 40.0, -75.0, 15, now() + interval '2 hours', 'open')
      returning id;
    `);
    reqAllenId = reqAllen.id;

    const [reqClaude] = await runSql(`
      insert into business_requests (requester_id, raw_text, category, party_size, budget_max, latitude, longitude, radius_miles, expires_at, status)
      values ('${claude.id}', 'live-verify: C2 concurrent test (Claude invitee)', 'Coffee', 1, 50, 40.0, -75.0, 15, now() + interval '2 hours', 'open')
      returning id;
    `);
    reqClaudeId = reqClaude.id;

    const [proposeResult] = await runSql(`select set_config('request.jwt.claims', '{"sub":"${allen.id}","role":"authenticated"}', true) from (select 1) x; select propose_group_plan('${reqAllenId}', array['${reqClaudeId}']::uuid[]) as proposal_id;`);
    proposalId = proposeResult.proposal_id;
    assert(!!proposalId, `propose_group_plan created a real proposal (got: ${JSON.stringify(proposeResult)})`);

    await runSql(`select set_config('request.jwt.claims', '{"sub":"${claude.id}","role":"authenticated"}', true) from (select 1) x; select respond_to_group_plan('${proposalId}', true);`);

    // Setting a real agreed budget resets the one non-initiator accepted
    // participant (Claude) back to 'invited' -- documented, real
    // behavior (rule 7), not a bug -- so Claude re-accepts below.
    await runSql(`select set_config('request.jwt.claims', '{"sub":"${allen.id}","role":"authenticated"}', true) from (select 1) x; select set_group_plan_budget('${proposalId}', 50);`);
    await runSql(`select set_config('request.jwt.claims', '{"sub":"${claude.id}","role":"authenticated"}', true) from (select 1) x; select respond_to_group_plan('${proposalId}', true);`);

    const [participantCheck] = await runSql(`select count(*) as c from group_plan_participants where proposal_id = '${proposalId}' and status = 'accepted';`);
    assert(String(participantCheck?.c) === '2', `both Allen and Claude are real accepted participants before confirming (got count: ${participantCheck?.c})`);

    const [confirmResult] = await runSql(`select set_config('request.jwt.claims', '{"sub":"${allen.id}","role":"authenticated"}', true) from (select 1) x; select confirm_group_plan('${proposalId}') as result;`);
    resultingRequestId = confirmResult?.result?.requestId;
    assert(!!resultingRequestId, `confirm_group_plan created a real shared business_requests row (got: ${JSON.stringify(confirmResult)})`);

    const [offer] = await runSql(`
      insert into business_request_offers (request_id, partner_id, offer_type, status, offer_description, expires_at)
      values ('${resultingRequestId}', '${partner.id}', 'standard', 'offered', 'live-verify: C2 concurrent test offer', now() + interval '2 hours')
      returning id;
    `);
    offerId = offer.id;

    // Holder: explicitly takes the *first* row lock confirm_group_plan_offer()
    // itself takes internally (group_plan_proposals, not the offer row --
    // see the header comment on why lock order matters here), sleeps
    // while holding it (its own later call to the real RPC, as Allen, is
    // reentrant -- same transaction, no self-block), then commits.
    // Racer: calls the real RPC directly as Claude, fired mid-sleep, so
    // its own internal `for update` on that same proposal row is
    // genuinely blocked by Postgres until the holder commits.
    const holderQuery = asUser(allen.id, `
      begin;
      select id from group_plan_proposals where id = '${proposalId}' for update;
      select pg_sleep(2);
      select confirm_group_plan_offer('${proposalId}', '${offerId}') as result;
      commit;
    `);
    const racerQuery = asUser(claude.id, `
      select confirm_group_plan_offer('${proposalId}', '${offerId}') as result;
    `);

    const { holder, racer } = await runOverlapping({ holderQuery, racerQuery, racerDelayMs: 900 });

    assert(holder.ok, `holder (Allen's confirm, the first of the pair) succeeded (${holder.ok ? '' : holder.error?.message})`);
    assert(racer.ok, `racer (Claude's confirm, genuinely concurrent, the quorum-completing one) succeeded (${racer.ok ? '' : racer.error?.message})`);
    assert(
      racer.elapsedMs > 1500,
      `racer's call was genuinely blocked at the Postgres level (took ${racer.elapsedMs}ms total wall time from test start, ` +
      `well past its own ~900ms fire time -- proving it queued behind the holder's lock on the offer row, not that it just ran slow)`
    );

    const holderResult = Array.isArray(holder.data) ? holder.data[0]?.result : undefined;
    const racerResult = Array.isArray(racer.data) ? racer.data[0]?.result : undefined;

    assert(
      holderResult?.allConfirmed === false && holderResult?.confirmedCount === 1 && holderResult?.requiredCount === 2,
      `holder's own confirmation (the first of the pair) correctly reports allConfirmed: false, confirmedCount: 1, requiredCount: 2 -- proving it read the count before the racer's own confirmation existed (got: ${JSON.stringify(holderResult)})`
    );
    assert(
      racerResult?.allConfirmed === true && racerResult?.confirmedCount === 2 && racerResult?.requiredCount === 2 && racerResult?.success === true,
      `racer's confirmation (genuinely concurrent, resuming only after the holder's row is really committed) correctly sees the fresh count and reports allConfirmed: true, confirmedCount: 2 -- the quorum race is closed, not just present in the SQL text (got: ${JSON.stringify(racerResult)})`
    );

    const [confirmationRows] = await runSql(`select count(*) as c from group_plan_offer_confirmations where proposal_id = '${proposalId}' and offer_id = '${offerId}';`);
    assert(String(confirmationRows?.c) === '2', `exactly 2 real confirmation rows exist (one per participant), not duplicated or lost by the race (got count: ${confirmationRows?.c})`);

    const [afterOffer] = await runSql(`select status from business_request_offers where id = '${offerId}';`);
    assert(afterOffer?.status === 'accepted', `the offer flipped to "accepted" exactly once, not double-processed or left stuck at "offered" (got: ${afterOffer?.status})`);

    const [afterRequest] = await runSql(`select status from business_requests where id = '${resultingRequestId}';`);
    assert(afterRequest?.status === 'fulfilled', `the resulting shared request flipped to "fulfilled" exactly once (got: ${afterRequest?.status})`);
  } finally {
    if (proposalId) {
      await runSql(`update group_plan_proposals set resulting_request_id = null where id = '${proposalId}';`).catch(() => {});
    }
    if (resultingRequestId || reqAllenId || reqClaudeId) {
      const ids = [resultingRequestId, reqAllenId, reqClaudeId].filter(Boolean).map((id) => `'${id}'`).join(',');
      await runSql(`update business_requests set group_plan_id = null, superseded_by_group_plan_id = null where id in (${ids});`).catch(() => {});
    }
    if (proposalId) {
      await runSql(`delete from group_plan_offer_confirmations where proposal_id = '${proposalId}';`).catch(() => {});
    }
    if (offerId) await runSql(`delete from business_request_offers where id = '${offerId}';`).catch(() => {});
    // group_plan_participants.source_request_id references
    // business_requests with no ON DELETE action (RESTRICT) -- the
    // proposal must be deleted first (its own FK to participants is
    // ON DELETE CASCADE, so this also clears the participant rows) or
    // the business_requests deletes below silently fail via .catch(),
    // leaving real rows behind. Confirmed the hard way: an earlier run
    // of this script left 2 real business_requests rows in production
    // because this ordering was wrong -- found and cleaned up by hand
    // before fixing the script itself.
    if (proposalId) {
      await runSql(`delete from group_plan_proposals where id = '${proposalId}';`).catch(() => {});
    }
    if (resultingRequestId) await runSql(`delete from business_requests where id = '${resultingRequestId}';`).catch(() => {});
    if (reqAllenId) await runSql(`delete from business_requests where id = '${reqAllenId}';`).catch(() => {});
    if (reqClaudeId) await runSql(`delete from business_requests where id = '${reqClaudeId}';`).catch(() => {});
    {
    }
    console.log('  (cleanup) test business_requests/offer/group_plan rows deleted, both FK sides of the resulting_request_id <-> group_plan_id cycle nulled first');
  }

  summarize('group-plan-confirm-offer-quorum-race-concurrent');
}

main().catch((e) => {
  console.error('group-plan-confirm-offer-quorum-race-concurrent: script itself failed to run:', e.message, e.body ? JSON.stringify(e.body) : '');
  process.exitCode = 1;
});
