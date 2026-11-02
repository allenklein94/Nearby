#!/usr/bin/env node
// Migration 20270387 (screening outage alerts) under real concurrency, on the LOCAL replay database only
// (NEARBY_LOCAL_DB_URL; refuses anything else). Separate sessions overlap, each holding its transaction open.
//   1. 12 parallel credit failures (the first burst of an outage): exactly ONE outage opens, each admin gets ONE alert.
//   2. 12 parallel successes right after: the outage closes once, each admin gets ONE "working again".
//   3. 6 parallel timeouts (transient, from nothing): one outage, one alert per admin (never two because two sessions
//      both saw "3 recent").
//   4. failures and successes interleaved in parallel: at most one open outage at any time (unique index never violated,
//      no session errors).
// Every row it creates is deleted afterwards (admins, outages, failures, pushes).
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/screening-outage-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const crypto = require('crypto');

const HOLD_MS = 200;
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function parallel(calls) {
  return Promise.all(calls.map(async ([ok, kind, status]) => {
    const c = await connect();
    try {
      await c.query('begin');
      await c.query('select record_screening_service_result($1, $2, $3, $4)', ['business-content', ok, kind, status]);
      await sleep(HOLD_MS);
      await c.query('commit');
      return null;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      return e.message;
    } finally { await c.end(); }
  }));
}

(async () => {
  const db = await connect();
  const admins = [crypto.randomUUID(), crypto.randomUUID()];
  const pushCount = async (phase) => Number((await db.query(
    `select count(*) n from push_outbox where data->>'type' = 'admin_screening_outage' and recipient_id = any($1) and data->>'phase' = $2`,
    [admins, phase])).rows[0].n);
  const perAdmin = async (phase) => (await db.query(
    `select recipient_id, count(*) n from push_outbox where data->>'type' = 'admin_screening_outage' and recipient_id = any($1)
      and data->>'phase' = $2 group by 1`, [admins, phase])).rows.map((r) => Number(r.n));
  try {
    for (const id of admins) {
      await db.query(`insert into auth.users (id, aud, role, email) values ($1::uuid, 'authenticated', 'authenticated', $1::text || '@outage.test')`, [id]);
      await db.query(`insert into profiles (id, display_name, birthdate) values ($1, 'Outage admin', date '1990-01-01')`, [id]);
      await db.query(`update profiles set is_admin = true where id = $1`, [id]);
    }
    await db.query('delete from private.screening_outages; delete from private.screening_service_failures');

    console.log('1. 12 parallel credit failures');
    let errs = (await parallel(Array.from({ length: 12 }, () => [false, 'credit', 400]))).filter(Boolean);
    check(errs.length === 0, `no session failed (${errs[0] ?? 'none'})`);
    check(Number((await db.query('select count(*) n from private.screening_outages')).rows[0].n) === 1, 'exactly one outage');
    check(Number((await db.query('select failure_count n from private.screening_outages')).rows[0].n) === 12, 'all 12 failures counted on it');
    check(JSON.stringify(await perAdmin('open')) === '[1,1]', 'each admin alerted exactly once');

    console.log('2. 12 parallel successes');
    errs = (await parallel(Array.from({ length: 12 }, () => [true, null, null]))).filter(Boolean);
    check(errs.length === 0, 'no session failed');
    check(Number((await db.query('select count(*) n from private.screening_outages where recovered_at is null')).rows[0].n) === 0, 'closed');
    check(JSON.stringify(await perAdmin('recovered')) === '[1,1]', 'each admin told "working again" exactly once');

    console.log('3. 6 parallel timeouts from nothing');
    errs = (await parallel(Array.from({ length: 6 }, () => [false, 'timeout', null]))).filter(Boolean);
    check(errs.length === 0, 'no session failed');
    check(Number((await db.query('select count(*) n from private.screening_outages where recovered_at is null')).rows[0].n) === 1, 'one open outage');
    check(await pushCount('open') === 4, 'one more alert per admin (2 outages x 2 admins in total)');

    console.log('4. failures and successes interleaved');
    errs = (await parallel(Array.from({ length: 20 }, (_, i) => (i % 2 ? [true, null, null] : [false, 'model', 404])))).filter(Boolean);
    check(errs.length === 0, `no session failed (${errs[0] ?? 'none'})`);
    const open = Number((await db.query('select count(*) n from private.screening_outages where recovered_at is null')).rows[0].n);
    check(open <= 1, `at most one open outage (${open})`);
    const opens = await perAdmin('open'); const recs = await perAdmin('recovered');
    const outages = Number((await db.query('select count(*) n from private.screening_outages')).rows[0].n);
    check(opens.every((n) => n === outages), `one open alert per outage per admin (${opens} vs ${outages} outages)`);
    const closed = Number((await db.query('select count(*) n from private.screening_outages where recovered_at is not null')).rows[0].n);
    check(recs.every((n) => n === closed), `one recovered alert per closed outage per admin (${recs} vs ${closed})`);
  } finally {
    await db.query(`delete from push_outbox where data->>'type' = 'admin_screening_outage' and recipient_id = any($1)`, [admins]);
    await db.query('delete from private.screening_outages; delete from private.screening_service_failures');
    await db.query('delete from profiles where id = any($1)', [admins]);
    await db.query('delete from auth.users where id = any($1)', [admins]);
    const left = (await db.query(`select (select count(*) from private.screening_outages) + (select count(*) from private.screening_service_failures)
      + (select count(*) from profiles where id = any($1)) n`, [admins])).rows[0].n;
    check(Number(left) === 0, 'nothing left behind');
    await db.end();
  }
  console.log(failures ? `${failures} FAILED` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})();
