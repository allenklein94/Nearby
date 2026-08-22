#!/usr/bin/env node
// Real, repeatable live-verify script for match_contacts_to_users()'s rate
// limit, closing a real, disclosed gap named in CLAUDE.md's Aug 15 2026
// SECDEF audit (Phase 1 item 1, "one secondary observation, not scored as a
// finding... no visible rate limit, which could be a phone-number-
// enumeration vector at scale if called directly bypassing the app's own
// contact-picker UI -- flagged for a future pass, not fixed this session").
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/match-contacts-rate-limit.js
const { runSql, runSqlAs, assert, summarize } = require('./lib/db');

async function main() {
  console.log('match-contacts-rate-limit: verifying the array-size cap and the daily call limit...');

  const [caller] = await runSql(`select id from profiles where display_name = 'Claude' limit 1;`);
  if (!caller) throw new Error('Needs the real "Claude" profile in this environment.');
  const callerId = caller.id;

  const [before] = await runSql(`select contacts_matched_calls_today, contacts_matched_date from profiles where id = '${callerId}';`);
  const baselineCalls = before?.contacts_matched_calls_today ?? 0;
  const baselineDate = before?.contacts_matched_date ?? null;

  try {
    let capRejected = false;
    try {
      await runSqlAs(callerId, `select * from match_contacts_to_users((select array_agg('555' || i::text) from generate_series(1,3001) i));`);
    } catch (e) {
      capRejected = e.message.includes('Too many contacts submitted at once');
    }
    assert(capRejected, 'a 3001-number array is rejected by the per-call size cap');

    await runSqlAs(callerId, `select * from match_contacts_to_users(array['5551110001','5551110002']);`);
    const [afterOne] = await runSql(`select contacts_matched_calls_today from profiles where id = '${callerId}';`);
    assert(afterOne?.contacts_matched_calls_today === baselineCalls + 1, 'a normal call succeeds and increments the real daily counter by exactly 1');

    for (let i = 0; i < 9; i++) {
      await runSqlAs(callerId, `select * from match_contacts_to_users(array['5559990${String(i).padStart(3, '0')}']);`);
    }
    const [afterTen] = await runSql(`select contacts_matched_calls_today from profiles where id = '${callerId}';`);
    assert(afterTen?.contacts_matched_calls_today === baselineCalls + 10, `10 total calls today are all allowed (counter at ${afterTen?.contacts_matched_calls_today})`);

    let limitRejected = false;
    try {
      await runSqlAs(callerId, `select * from match_contacts_to_users(array['5559990099']);`);
    } catch (e) {
      limitRejected = e.message.includes('Too many contact-matching requests today');
    }
    assert(limitRejected, 'an 11th call the same day is rejected by the daily limit');

    const [selfResetAttempt] = await runSqlAs(
      callerId,
      `update profiles set contacts_matched_calls_today = 0, contacts_matched_date = null where id = '${callerId}' returning contacts_matched_calls_today, contacts_matched_date;`
    );
    assert(selfResetAttempt?.contacts_matched_calls_today === baselineCalls + 10, 'a direct client-side self-reset of the counter is silently reverted by the guard trigger, not honored');
  } finally {
    await runSql(`
      select set_config('app.trusted_update', 'true', true) from (select 1) x;
      update profiles set contacts_matched_calls_today = ${baselineCalls}, contacts_matched_date = ${baselineDate ? `'${baselineDate}'` : 'null'} where id = '${callerId}';
    `).catch(() => {});
    console.log('  (cleanup) the test profile\'s counter reverted to its exact pre-test value');
  }

  summarize('match-contacts-rate-limit');
}

main().catch((e) => {
  console.error('match-contacts-rate-limit: script itself failed to run:', e.message);
  process.exitCode = 1;
});
