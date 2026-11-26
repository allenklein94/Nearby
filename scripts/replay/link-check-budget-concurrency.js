#!/usr/bin/env node
// Migration 20270396 (link destination safety) under real concurrency, on the LOCAL replay database only
// (NEARBY_LOCAL_DB_URL; refuses anything else). The Web Risk lookup budget (claim_link_checks: 200 per account, 3000 for
// everyone, a day) must never be overspent by claims racing each other.
//   1. Per account: an account at 190 of 200; 12 sessions each claim 1 at the same moment -> exactly 10 succeed, the counter
//      ends at 200, never more.
//   2. Everyone: the shared row at 2995 of 3000; 12 different accounts each claim 1 at once -> exactly 5 succeed, 2995 + 5.
//   3. Both orders: two accounts claiming against each other's rows in opposite order never deadlock (all claims return).
// Each step resets today's rows; the script deletes them at the end.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/link-check-budget-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');

const NIL = '00000000-0000-0000-0000-000000000000';
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const TODAY = `(now() at time zone 'utc')::date`;

async function race(users, holdMs = 300) {
  // every session opens a transaction, then all claim together; the first holds its lock a moment so the rest really wait
  const sessions = await Promise.all(users.map(() => connect()));
  await Promise.all(sessions.map((c) => c.query('begin')));
  const results = await Promise.all(sessions.map(async (c, i) => {
    const { rows: [{ ok }] } = await c.query('select public.claim_link_checks($1, 1) as ok', [users[i]]);
    if (i === 0) await new Promise((r) => setTimeout(r, holdMs));
    await c.query('commit');
    return ok;
  }));
  await Promise.all(sessions.map((c) => c.end()));
  return results;
}

(async () => {
  const admin = await connect();
  if (!(await admin.query(`select to_regprocedure('public.claim_link_checks(uuid,integer)') is not null as y`)).rows[0].y) {
    console.error('20270396 is not installed on this database.');
    process.exit(2);
  }
  // the budget keys on an id only (no account row is read), so fresh ids stand in for twelve accounts
  const people = (await admin.query(`select gen_random_uuid() as id from generate_series(1, 12)`)).rows.map((r) => r.id);
  const reset = async () => admin.query(`delete from private.link_check_usage where day = ${TODAY}`);
  const lookups = async (u) => (await admin.query(`select coalesce(max(lookups), 0) as n from private.link_check_usage where day = ${TODAY} and user_id = $1`, [u])).rows[0].n;

  for (let round = 1; round <= 5; round += 1) {
    console.log(`round ${round}`);
    await reset();
    await admin.query(`insert into private.link_check_usage (day, user_id, lookups) values (${TODAY}, $1, 190), (${TODAY}, $2, 190)`, [people[0], NIL]);
    const one = await race(Array(12).fill(people[0]));
    check(one.filter(Boolean).length === 10, `per account: ${one.filter(Boolean).length} of 12 claims at 190/200 succeeded (want 10)`);
    check(Number(await lookups(people[0])) === 200, 'per account: counter ends at 200');

    await reset();
    await admin.query(`insert into private.link_check_usage (day, user_id, lookups) values (${TODAY}, $1, 2995)`, [NIL]);
    const all = await race(people);
    check(all.filter(Boolean).length === 5, `everyone: ${all.filter(Boolean).length} of 12 claims at 2995/3000 succeeded (want 5)`);
    check(Number(await lookups(NIL)) === 3000, 'everyone: counter ends at 3000');

    await reset();
    const mixed = await race([people[1], people[2], people[1], people[2], people[1], people[2]], 100);
    check(mixed.every((ok) => ok === true), 'two accounts claiming together: all six return true (no deadlock)');
    check(Number(await lookups(NIL)) === 6, 'everyone counter = 6');
  }
  await reset();
  await admin.end();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
