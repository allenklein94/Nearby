#!/usr/bin/env node
// Aug 17 2026, "closing the last concurrency gap" (see CLAUDE.md): the
// genuinely-concurrent proof for Finding C3 (cross-proposal exclusivity),
// previously only proven via *sequential* replay (the Aug 15 2026
// architecture-hardening pass). propose_group_plan()'s per-invitee loop
// does `select br.* ... where br.id = v_invitee_id ... for update of br`
// before inserting into group_plan_participants, guarded by the partial
// unique index group_plan_participants_active_source_request_idx on
// (source_request_id) where status in ('invited','accepted').
//
// This forces genuine overlap the same way the other concurrent proofs
// do: one connection ("holder") explicitly locks the shared invitee's
// own business_requests row -- the exact row propose_group_plan's own
// `for update of br` targets -- sleeps while holding it, then (reentrant,
// same transaction) calls the real RPC as the first initiator. A second
// connection ("racer") calls the real RPC as a second, different
// initiator, inviting the *same* shared person's *same* request into a
// *different* proposal, fired partway through the holder's sleep -- its
// own internal `for update of br` on the same row is genuinely blocked
// at the Postgres level until the holder commits.
//
// Expected: the holder's proposal succeeds (2 real participants). Once
// unblocked, the racer's own attempt to add the same invitee hits the
// now-committed partial unique index, gets silently skipped by
// propose_group_plan's own exception handler (its documented "the world
// changed between fetch and submit" behavior) -- and since that was the
// racer's *only* invitee, the function's own final participant-count
// check correctly raises "None of the people you invited could be
// added...", rolling back the racer's entire proposal. This proves the
// lock and the unique index together genuinely prevent the same open
// request from landing as an active participant in two different
// pending group plans, under true overlap -- not just that the index
// exists in the schema.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/group-plan-cross-proposal-exclusivity-concurrent.js
const { runSql, assert, summarize } = require('./lib/db');
const { runOverlapping, asUser } = require('./lib/concurrency');

async function main() {
  console.log('group-plan-cross-proposal-exclusivity-concurrent: verifying propose_group_plan()\'s row lock + partial unique index serialize two genuinely concurrent proposals over the same shared invitee...');

  // Reuses the real existing connections already in production rather
  // than fabricating new relationships -- Allen is a real accepted
  // friend of Claude and a real match with Google voice, so Allen is the
  // natural shared invitee both Claude and Google voice can genuinely
  // invite. Confirmed live (not assumed) immediately before use.
  const [allen] = await runSql(`select id, display_name from profiles where display_name = 'Allen';`);
  const [claude] = await runSql(`select id, display_name from profiles where display_name = 'Claude';`);
  const [googleVoice] = await runSql(`select id, display_name from profiles where display_name = 'Google voice';`);
  if (!allen || !claude || !googleVoice) {
    throw new Error('Needs the real Allen/Claude/Google voice profiles in this environment.');
  }
  const [friendship] = await runSql(`
    select status from friendships
    where status = 'accepted'
      and ((user_a = '${claude.id}' and user_b = '${allen.id}') or (user_a = '${allen.id}' and user_b = '${claude.id}'));
  `);
  const [match] = await runSql(`
    select 1 as exists from matches
    where (user_a = '${googleVoice.id}' and user_b = '${allen.id}') or (user_a = '${allen.id}' and user_b = '${googleVoice.id}');
  `);
  if (!friendship || !match) {
    throw new Error('Needs a real accepted Claude<->Allen friendship and a real Google voice<->Allen match in this environment.');
  }

  let reqClaudeId, reqGoogleVoiceId, reqAllenId, holderProposalId, racerProposalId;
  try {
    const [reqClaude] = await runSql(`
      insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
      values ('${claude.id}', 'live-verify: C3 concurrent test (Claude initiator)', 'Coffee', 1, 40.0, -75.0, 15, now() + interval '2 hours', 'open')
      returning id;
    `);
    reqClaudeId = reqClaude.id;

    const [reqGoogleVoice] = await runSql(`
      insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
      values ('${googleVoice.id}', 'live-verify: C3 concurrent test (Google voice initiator)', 'Coffee', 1, 40.0, -75.0, 15, now() + interval '2 hours', 'open')
      returning id;
    `);
    reqGoogleVoiceId = reqGoogleVoice.id;

    const [reqAllen] = await runSql(`
      insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
      values ('${allen.id}', 'live-verify: C3 concurrent test (shared invitee)', 'Coffee', 1, 40.0, -75.0, 15, now() + interval '2 hours', 'open')
      returning id;
    `);
    reqAllenId = reqAllen.id;

    const holderQuery = asUser(claude.id, `
      begin;
      select id from business_requests where id = '${reqAllenId}' for update;
      select pg_sleep(2);
      select propose_group_plan('${reqClaudeId}', array['${reqAllenId}']::uuid[]) as proposal_id;
      commit;
    `);
    const racerQuery = asUser(googleVoice.id, `
      select propose_group_plan('${reqGoogleVoiceId}', array['${reqAllenId}']::uuid[]) as proposal_id;
    `);

    const { holder, racer } = await runOverlapping({ holderQuery, racerQuery, racerDelayMs: 900 });

    assert(holder.ok, `holder (Claude's proposal, inviting Allen) succeeded (${holder.ok ? '' : holder.error?.message})`);
    assert(
      !racer.ok,
      `racer (Google voice's proposal, genuinely concurrent, also inviting Allen) was correctly rejected -- Allen's request had already become an active participant elsewhere by the time the racer's own lock cleared (${racer.ok ? 'it succeeded -- this is the bug, the same request landed active in two proposals' : racer.error?.message})`
    );
    assert(
      racer.elapsedMs > 1500,
      `racer's call was genuinely blocked at the Postgres level (took ${racer.elapsedMs}ms total wall time from test start, ` +
      `well past its own ~900ms fire time -- proving it queued behind the holder's lock on Allen's business_requests row, not that it just ran slow)`
    );
    if (!racer.ok) {
      assert(
        /none of the people you invited could be added/i.test(racer.error?.message || ''),
        `racer's rejection is the real "none of the people you invited could be added" guard (the only invitee was silently skipped by the now-committed unique index conflict), not some unrelated error (got: ${racer.error?.message})`
      );
    }

    const holderResult = Array.isArray(holder.data) ? holder.data[0] : undefined;
    holderProposalId = holderResult?.proposal_id;
    assert(!!holderProposalId, `holder's call returned a real proposal id (got: ${JSON.stringify(holderResult)})`);

    const [proposalCount] = await runSql(`select count(*) as c from group_plan_proposals where initiator_id in ('${claude.id}', '${googleVoice.id}') and category = 'Coffee' and created_at > now() - interval '5 minutes';`);
    assert(String(proposalCount?.c) === '1', `exactly one group_plan_proposals row exists -- the racer's own proposal never persisted (was rolled back whole), not left as a corrupt/incomplete row (got count: ${proposalCount?.c})`);

    const [participants] = await runSql(`select count(*) as c from group_plan_participants where proposal_id = '${holderProposalId}';`);
    assert(String(participants?.c) === '2', `holder's real proposal has exactly 2 real participants (Claude + Allen), not corrupted by the racer's blocked attempt (got count: ${participants?.c})`);

    const [allenParticipant] = await runSql(`select status, source_request_id from group_plan_participants where proposal_id = '${holderProposalId}' and user_id = '${allen.id}';`);
    assert(allenParticipant?.status === 'invited' && allenParticipant?.source_request_id === reqAllenId, `Allen's participant row on the real (holder's) proposal is correctly "invited", pointing at his own real request (got: ${JSON.stringify(allenParticipant)})`);

    const [activeCount] = await runSql(`select count(*) as c from group_plan_participants where source_request_id = '${reqAllenId}' and status in ('invited', 'accepted');`);
    assert(String(activeCount?.c) === '1', `Allen's request is an active participant in exactly one proposal, never two at once -- the partial unique index genuinely holds under true concurrency (got count: ${activeCount?.c})`);
  } finally {
    if (holderProposalId) {
      await runSql(`delete from group_plan_participants where proposal_id = '${holderProposalId}';`).catch(() => {});
      await runSql(`delete from group_plan_proposals where id = '${holderProposalId}';`).catch(() => {});
    }
    // Defensive: if the racer's proposal somehow did persist (would mean
    // the bug this test exists to catch), clean it up too rather than
    // leaving it in production.
    await runSql(`delete from group_plan_participants where source_request_id in ('${reqClaudeId}', '${reqGoogleVoiceId}', '${reqAllenId}');`).catch(() => {});
    await runSql(`delete from group_plan_proposals where initiator_id in ('${claude.id}', '${googleVoice.id}') and category = 'Coffee' and created_at > now() - interval '5 minutes';`).catch(() => {});
    if (reqClaudeId) await runSql(`delete from business_requests where id = '${reqClaudeId}';`).catch(() => {});
    if (reqGoogleVoiceId) await runSql(`delete from business_requests where id = '${reqGoogleVoiceId}';`).catch(() => {});
    if (reqAllenId) await runSql(`delete from business_requests where id = '${reqAllenId}';`).catch(() => {});
    console.log('  (cleanup) test business_requests/group_plan_proposals/participants rows deleted');
  }

  summarize('group-plan-cross-proposal-exclusivity-concurrent');
}

main().catch((e) => {
  console.error('group-plan-cross-proposal-exclusivity-concurrent: script itself failed to run:', e.message, e.body ? JSON.stringify(e.body) : '');
  process.exitCode = 1;
});
