#!/usr/bin/env node
// Phase 1 item 2 of the "Scorecard to 10" plan (see CLAUDE.md): the first
// real proof built on the new concurrency harness (lib/concurrency.js).
// Closes the one race this whole codebase's history had explicitly
// flagged as "not independently reproduced under true concurrency" (the
// Aug 16 2026 Friend Discovery acceptance-audit entry, Wave 2A Gap 3) --
// record_friend_discovery_swipe()'s mutual-match check was previously
// only proven correct via *sequential* replay, which can't actually
// exercise the race it fixes (two opposite-direction "like" swipes on
// the same pair, genuinely overlapping in time).
//
// This forces the real overlap: one connection ("holder") explicitly
// locks both real profile rows the RPC's own internal
// `... for update` lock targets, then sleeps while still holding that
// lock, then calls the real RPC (reentrant -- it's the same transaction,
// so its own internal lock attempt doesn't re-block). A second
// connection ("racer") fires the opposite-direction swipe partway
// through the holder's sleep -- its own call to the same RPC tries to
// take the exact same row lock and is genuinely blocked at the Postgres
// level until the holder commits. If the fix holds, the racer's blocked
// call resumes *after* the holder's swipe is already committed, so the
// racer correctly sees the reverse "like" and reports a real mutual
// match -- proving the lock closes the "both sides see no reverse like
// yet" race, not just that the SQL text contains a lock clause.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/friend-discovery-swipe-race-concurrent.js
const { runSql, assert, summarize } = require('./lib/db');
const { runOverlapping, asUser } = require('./lib/concurrency');

async function main() {
  console.log('friend-discovery-swipe-race-concurrent: verifying record_friend_discovery_swipe() serializes a genuine concurrent mutual-swipe race...');

  // Two real, currently-unconnected profiles -- confirmed live (not
  // assumed) immediately before use, since this touches real production
  // rows and a stale assumption here would corrupt someone's real social
  // graph, not just fail an assertion.
  const [pair] = await runSql(`
    select p1.id as a_id, p1.display_name as a_name, p2.id as b_id, p2.display_name as b_name
    from profiles p1, profiles p2
    where p1.id < p2.id
      and not exists (select 1 from friendships f where (f.user_a = p1.id and f.user_b = p2.id) or (f.user_a = p2.id and f.user_b = p1.id))
      and not exists (select 1 from matches m where (m.user_a = p1.id and m.user_b = p2.id) or (m.user_a = p2.id and m.user_b = p1.id))
      and not exists (select 1 from blocks bl where (bl.blocker_id = p1.id and bl.blocked_id = p2.id) or (bl.blocker_id = p2.id and bl.blocked_id = p1.id))
    order by p1.id, p2.id
    limit 1;
  `);
  if (!pair) throw new Error('Needs at least two real, currently-unconnected profiles in this environment.');

  const userAId = pair.a_id, userAName = pair.a_name, userBId = pair.b_id, userBName = pair.b_name;
  console.log(`  using real unconnected pair: ${userAName} <-> ${userBName}`);

  // Capture real pre-test opt-in state so it can be restored exactly,
  // matching this file's own established convention.
  const [beforeA] = await runSql(`select open_to_friend_discovery from profiles where id = '${userAId}';`);
  const [beforeB] = await runSql(`select open_to_friend_discovery from profiles where id = '${userBId}';`);

  try {
    await runSql(`
      update profiles set open_to_friend_discovery = true where id in ('${userAId}', '${userBId}');
    `);

    const holderQuery = asUser(userAId, `
      begin;
      select id from profiles where id in ('${userAId}', '${userBId}') order by id for update;
      select pg_sleep(2);
      select * from record_friend_discovery_swipe('${userBId}', 'like');
      commit;
    `);
    const racerQuery = asUser(userBId, `
      select * from record_friend_discovery_swipe('${userAId}', 'like');
    `);

    const { holder, racer } = await runOverlapping({ holderQuery, racerQuery, racerDelayMs: 900 });

    assert(holder.ok, `holder (${userAName} -> ${userBName} like) call succeeded (${holder.ok ? '' : holder.error?.message}`);
    assert(racer.ok, `racer (${userBName} -> ${userAName} like) call succeeded (${racer.ok ? '' : racer.error?.message}`);
    assert(
      racer.elapsedMs > 1500,
      `racer's call was genuinely blocked at the Postgres level (took ${racer.elapsedMs}ms total wall time from test start, ` +
      `well past its own ~900ms fire time -- proving it queued behind the holder's lock, not that it just ran slow)`
    );

    // The holder's own row is the last statement in a multi-statement
    // batch -- the Management API returns only the final statement's
    // result, matching lib/db.js's own established "last statement wins"
    // convention.
    const holderResult = Array.isArray(holder.data) ? holder.data[0] : undefined;
    const racerResult = Array.isArray(racer.data) ? racer.data[0] : undefined;

    assert(
      holderResult?.is_mutual_match === false,
      `holder's own swipe (the first of the pair) correctly reports is_mutual_match: false (got: ${JSON.stringify(holderResult)})`
    );
    assert(
      racerResult?.is_mutual_match === true && !!racerResult?.match_id,
      `racer's swipe (genuinely concurrent, opposite direction) correctly reports is_mutual_match: true with a real match_id ` +
      `-- the lost-match race is closed (got: ${JSON.stringify(racerResult)})`
    );

    const [friendshipRow] = await runSql(`
      select status from friendships where (user_a = '${userAId}' and user_b = '${userBId}') or (user_a = '${userBId}' and user_b = '${userAId}');
    `);
    assert(friendshipRow?.status === 'accepted', `a real accepted friendship row was created exactly once (got: ${JSON.stringify(friendshipRow)})`);

    const [matchRow] = await runSql(`
      select count(*) as c from matches where (user_a = '${userAId}' and user_b = '${userBId}') or (user_a = '${userBId}' and user_b = '${userAId}');
    `);
    assert(String(matchRow?.c) === '1', `exactly one real match row was created, not duplicated by the race (got count: ${matchRow?.c})`);
  } finally {
    await runSql(`delete from friend_discovery_swipes where (from_user = '${userAId}' and to_user = '${userBId}') or (from_user = '${userBId}' and to_user = '${userAId}');`).catch(() => {});
    await runSql(`delete from matches where (user_a = '${userAId}' and user_b = '${userBId}') or (user_a = '${userBId}' and user_b = '${userAId}');`).catch(() => {});
    await runSql(`delete from friendships where (user_a = '${userAId}' and user_b = '${userBId}') or (user_a = '${userBId}' and user_b = '${userAId}');`).catch(() => {});
    await runSql(`update profiles set open_to_friend_discovery = ${beforeA?.open_to_friend_discovery ?? false} where id = '${userAId}';`).catch(() => {});
    await runSql(`update profiles set open_to_friend_discovery = ${beforeB?.open_to_friend_discovery ?? false} where id = '${userBId}';`).catch(() => {});
    console.log('  (cleanup) test swipes/friendship/match deleted, both profiles\' open_to_friend_discovery restored');
  }

  summarize('friend-discovery-swipe-race-concurrent');
}

main().catch((e) => {
  console.error('friend-discovery-swipe-race-concurrent: script itself failed to run:', e.message, e.body ? JSON.stringify(e.body) : '');
  process.exitCode = 1;
});
