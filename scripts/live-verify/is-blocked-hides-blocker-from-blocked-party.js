#!/usr/bin/env node
// Phase 1 item 3 of the "Scorecard to 10" plan (see CLAUDE.md): turning
// another of this file's own one-off, by-hand verifications into a real,
// repeatable script. This is the single most-repeated security invariant
// across this whole codebase's history -- is_blocked() was made SECURITY
// DEFINER (20260816_is_blocked_security_definer.sql history entry, "Aug
// 8 2026 -- same session, found and fixed a systemic block-enforcement
// bug") specifically because the *blocked* party's own session could not
// otherwise see the block row that RLS itself relies on, letting a
// blocked user still see and message the person who blocked them.
//
// This script re-proves that live, from both sides of a real block:
// after A blocks B, B's own session must no longer see the match/message
// history with A, and B must be rejected from sending a new message.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/is-blocked-hides-blocker-from-blocked-party.js
const { runSql, runSqlAs, runSqlAsRls, assert, summarize } = require('./lib/db');

async function main() {
  console.log('is-blocked-hides-blocker-from-blocked-party: verifying a blocked user\'s own session correctly loses visibility into the person who blocked them...');

  const profiles = await runSql(`select id, display_name from profiles order by created_at limit 2;`);
  if (!profiles || profiles.length < 2) {
    throw new Error('Needs at least two real profiles in this environment.');
  }
  const [p1, p2] = profiles;
  const userA = p1.id < p2.id ? p1.id : p2.id; // the blocker
  const userB = p1.id < p2.id ? p2.id : p1.id; // the party who will be blocked's session is tested

  let matchId, matchWasCreated = false, blockId, messageId;
  try {
    // A real match between the two, so there's a real conversation to
    // lose visibility into -- not a fabricated relationship shape.
    const [existingMatch] = await runSql(`select id from matches where user_a = '${userA}' and user_b = '${userB}';`);
    if (existingMatch) {
      matchId = existingMatch.id;
    } else {
      const [inserted] = await runSql(`
        insert into matches (user_a, user_b) values ('${userA}', '${userB}') returning id;
      `);
      matchId = inserted.id;
      matchWasCreated = true;
    }

    const [msg] = await runSql(`
      insert into messages (match_id, sender_id, body) values ('${matchId}', '${userA}', 'live-verify: pre-block message') returning id;
    `);
    messageId = msg.id;

    const beforeBlock = await runSqlAsRls(userB, `select id from matches where id = '${matchId}';`);
    assert(beforeBlock?.length === 1, 'before any block, the counterpart\'s own session correctly sees the real match (genuine RLS, not just an app-level check)');

    const [blockRow] = await runSql(`insert into blocks (blocker_id, blocked_id) values ('${userA}', '${userB}') returning id;`);
    blockId = blockRow.id;

    const asBlockerOwn = await runSqlAs(userA, `select is_blocked('${userA}', '${userB}') as blocked;`);
    assert(asBlockerOwn?.[0]?.blocked === true, 'is_blocked() correctly returns true from the blocker\'s own session');

    const asBlockedParty = await runSqlAs(userB, `select is_blocked('${userA}', '${userB}') as blocked;`);
    assert(asBlockedParty?.[0]?.blocked === true, 'is_blocked() correctly returns true from the BLOCKED party\'s own session too -- this is the exact bug the SECURITY DEFINER fix closed');

    // Uses count(*) rather than a raw row select -- the Management API's
    // query endpoint has a real, confirmed quirk (see lib/db.js's own
    // comment on runSql) where a truly-empty final statement's result
    // silently falls back to an earlier statement's output instead of
    // returning []. count(*) always returns exactly one row, sidestepping
    // that entirely.
    const [matchAfterBlock] = await runSqlAsRls(userB, `select count(*) as c from matches where id = '${matchId}';`);
    assert(String(matchAfterBlock?.c) === '0', `the blocked party's own session (real RLS, SET ROLE authenticated) no longer sees the real match (got count: ${matchAfterBlock?.c})`);

    let sendRejected = false;
    let sendError = '';
    try {
      await runSqlAsRls(userB, `insert into messages (match_id, sender_id, body) values ('${matchId}', '${userB}', 'live-verify: should be rejected');`);
    } catch (e) {
      sendRejected = true;
      sendError = e.message;
    }
    assert(sendRejected, `the blocked party's attempt to send a new message is rejected by RLS (got: ${sendRejected ? sendError : 'it succeeded -- this is the bug'})`);

    // An unrelated third profile's own is_blocked probe for this pair
    // must never leak a real answer -- the SECURITY DEFINER guard only
    // ever answers for a pair where the caller is one of the two ids.
    const [thirdProfile] = await runSql(`select id from profiles where id not in ('${userA}', '${userB}') limit 1;`);
    if (thirdProfile) {
      const asStranger = await runSqlAs(thirdProfile.id, `select is_blocked('${userA}', '${userB}') as blocked;`);
      assert(asStranger?.[0]?.blocked === false, 'an uninvolved third party probing this pair gets false, never a real answer');
    }
  } finally {
    if (blockId) await runSql(`delete from blocks where id = '${blockId}';`).catch(() => {});
    if (messageId) await runSql(`delete from messages where id = '${messageId}';`).catch(() => {});
    if (matchWasCreated && matchId) await runSql(`delete from matches where id = '${matchId}';`).catch(() => {});
    console.log(`  (cleanup) test block/message rows deleted; match ${matchWasCreated ? 'created by this test was also deleted' : '(pre-existing, untouched)'}`);
  }

  summarize('is-blocked-hides-blocker-from-blocked-party');
}

main().catch((e) => {
  console.error('is-blocked-hides-blocker-from-blocked-party: script itself failed to run:', e.message, e.body ? JSON.stringify(e.body) : '');
  process.exitCode = 1;
});
