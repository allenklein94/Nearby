#!/usr/bin/env node
// Real, repeatable live-verify script for remove_group_plan_participant() --
// closes the disclosed gap named repeatedly in CLAUDE.md's Group Plans
// (Phase D) sections: "no 'kick' action for the initiator to remove an
// already-accepted participant before confirm time outside the
// exclude-picker." The existing exclude-picker only ever takes effect at
// the moment of confirming; this RPC lets the initiator remove someone
// right now, while the proposal is still genuinely pending.
//
// Reuses the real existing connections already in production, same
// established convention as the other group-plan scripts: Allen is a real
// accepted friend of Claude and a real match with Google voice, so Allen
// is the natural group-plan initiator; Allen Klein has no relationship
// with anyone and is the genuine stranger for the negative tests.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/group-plan-remove-participant.js
const { runSql, runSqlAs, assert, summarize } = require('./lib/db');

async function main() {
  console.log('group-plan-remove-participant: verifying remove_group_plan_participant()...');

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

  let allenRequestId, claudeRequestId, googleVoiceRequestId, proposalId;

  try {
    const allenReq = await runSqlAs(allenId, `select create_business_request('live-verify: remove-participant test (Allen)', 40.0, -75.0, 'Coffee', 1, null, 40, null, null, null, 15, null) as result;`);
    allenRequestId = allenReq[0].result.requestId;
    const claudeReq = await runSqlAs(claudeId, `select create_business_request('live-verify: remove-participant test (Claude)', 40.0, -75.0, 'Coffee', 1, null, 40, null, null, null, 15, null) as result;`);
    claudeRequestId = claudeReq[0].result.requestId;
    const googleReq = await runSqlAs(googleVoiceId, `select create_business_request('live-verify: remove-participant test (Google voice)', 40.0, -75.0, 'Coffee', 1, null, 40, null, null, null, 15, null) as result;`);
    googleVoiceRequestId = googleReq[0].result.requestId;

    const propose = await runSqlAs(allenId, `select propose_group_plan('${allenRequestId}', array['${claudeRequestId}','${googleVoiceRequestId}']::uuid[]) as result;`);
    proposalId = propose[0].result;

    // Claude accepts; Google voice is left sitting at 'invited'.
    await runSqlAs(claudeId, `select respond_to_group_plan('${proposalId}', true);`);

    let strangerRejected = false;
    try {
      await runSqlAs(strangerId, `select remove_group_plan_participant('${proposalId}', '${claudeId}');`);
    } catch (e) {
      strangerRejected = e.message.includes('Only the person who proposed');
    }
    assert(strangerRejected, 'a genuine stranger (not the initiator) is rejected trying to remove anyone');

    let nonInitiatorRejected = false;
    try {
      await runSqlAs(claudeId, `select remove_group_plan_participant('${proposalId}', '${googleVoiceId}');`);
    } catch (e) {
      nonInitiatorRejected = e.message.includes('Only the person who proposed');
    }
    assert(nonInitiatorRejected, 'a real confirmed participant who is not the initiator is rejected trying to remove someone else');

    let selfRemoveRejected = false;
    try {
      await runSqlAs(allenId, `select remove_group_plan_participant('${proposalId}', '${allenId}');`);
    } catch (e) {
      selfRemoveRejected = e.message.includes("can't remove yourself");
    }
    assert(selfRemoveRejected, 'the initiator cannot remove themselves (cancel_group_plan is the real path for that)');

    // The actual point of this fix: remove someone right now, while still
    // pending, without being forced to confirm first.
    await runSqlAs(allenId, `select remove_group_plan_participant('${proposalId}', '${googleVoiceId}');`);
    const [googleAfter] = await runSql(`select status from group_plan_participants where proposal_id = '${proposalId}' and user_id = '${googleVoiceId}';`);
    assert(googleAfter?.status === 'left', 'the initiator can remove a still-invited (not yet responded) participant right now, while the proposal stays pending');

    const [proposalStillPending] = await runSql(`select status from group_plan_proposals where id = '${proposalId}';`);
    assert(proposalStillPending?.status === 'pending', 'the proposal itself is untouched -- still pending, the initiator was not forced to confirm');

    let alreadyLeftRejected = false;
    try {
      await runSqlAs(allenId, `select remove_group_plan_participant('${proposalId}', '${googleVoiceId}');`);
    } catch (e) {
      alreadyLeftRejected = e.message.includes('already left');
    }
    assert(alreadyLeftRejected, 'removing an already-removed/left participant a second time is rejected, not silently re-processed');

    await runSqlAs(allenId, `select remove_group_plan_participant('${proposalId}', '${claudeId}');`);
    const [claudeAfter] = await runSql(`select status from group_plan_participants where proposal_id = '${proposalId}' and user_id = '${claudeId}';`);
    assert(claudeAfter?.status === 'left', 'the initiator can also remove an already-accepted participant right now, not just an invited one');

    await runSqlAs(allenId, `select cancel_group_plan('${proposalId}');`);
    let afterCancelRejected = false;
    try {
      // Re-propose is impossible on a cancelled proposal, so re-use the
      // same (now-cancelled) proposal id to prove the pending-only guard.
      await runSqlAs(allenId, `select remove_group_plan_participant('${proposalId}', '${claudeId}');`);
    } catch (e) {
      afterCancelRejected = e.message.includes('no longer be edited');
    }
    assert(afterCancelRejected, 'removing a participant on a no-longer-pending (cancelled/confirmed/expired) proposal is rejected');
  } finally {
    if (proposalId) {
      await runSql(`delete from group_plan_participants where proposal_id = '${proposalId}';`).catch(() => {});
      await runSql(`delete from group_plan_proposals where id = '${proposalId}';`).catch(() => {});
    }
    for (const rid of [allenRequestId, claudeRequestId, googleVoiceRequestId]) {
      if (rid) await runSql(`delete from business_requests where id = '${rid}';`).catch(() => {});
    }
    console.log('  (cleanup) all test rows deleted');
  }

  summarize('group-plan-remove-participant');
}

main().catch((e) => {
  console.error('group-plan-remove-participant: script itself failed to run:', e.message);
  process.exitCode = 1;
});
