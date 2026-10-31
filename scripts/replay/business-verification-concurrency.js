#!/usr/bin/env node
// Migration 20270371 (Verified Business) under real concurrency, on the LOCAL replay database only (NEARBY_LOCAL_DB_URL;
// refuses anything else). A journey is one transaction and cannot race, so separate sessions really overlap here, each
// holding its transaction open before committing. Decisions on one business are serialized by the row lock on it.
//   1. two admins revoke the same verified business at the same moment: exactly one revocation, the other is told it is
//      not verified; one 'revoked' event.
//   2. one admin verifies while another revokes, at the same moment, 10 rounds: the history always reads as one order
//      (every 'revoked' directly follows a 'verified'), and the badge = the latest event.
//   3. two admins verify the same business at once: both reviews recorded in order, no deadlock, badge on.
// Every row it creates is deleted afterwards (the business delete cascades its history: the one delete the record allows).
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/business-verification-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const crypto = require('crypto');

const HOLD_MS = 300;
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = (sub, role) => `select set_config('request.jwt.claims', $$${JSON.stringify({ sub, role })}$$, true)`;

async function together(steps) {
  return Promise.all(steps.map(async (step) => {
    const c = await connect();
    try {
      await c.query('begin');
      await c.query(claims(step.sub, 'authenticated'));
      await c.query('set local role authenticated');
      const r = await c.query(step.sql, step.args);
      await sleep(HOLD_MS);
      await c.query('commit');
      return { ok: true, row: r.rows[0] };
    } catch (e) {
      await c.query('rollback').catch(() => {});
      return { ok: false, error: e.message };
    } finally {
      await c.end();
    }
  }));
}

const CHECKS = JSON.stringify(Object.fromEntries(['identity', 'authority', 'contact', 'consistency'].map((k) => [k, {
  method: k === 'contact' ? 'called_official_number' : 'site_visit', outcome: 'passed', note: 'Concurrency test evidence note.',
}])));
const VERIFY = `select public.admin_verify_business($1, '${CHECKS}'::jsonb, 'All four passed; verified.') x`;
const REVOKE = `select public.admin_revoke_business_verification($1, 'Concurrency test revocation.') x`;

(async () => {
  const db = await connect();
  const ids = [];
  const person = async (label) => {
    const id = crypto.randomUUID();
    ids.push(id);
    await db.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`,
    [id, `${label}-${id.slice(0, 8)}@concurrency.invalid`, `1557${String(ids.length).padStart(8, '0')}`]);
    await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
      values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false)`, [id, label]);
    return id;
  };
  const partner = crypto.randomUUID();
  const history = async () => (await db.query(`select kind from private.business_verification_events where partner_id = $1 order by id`, [partner])).rows.map((r) => r.kind);
  const badge = async () => (await db.query(`select (private.business_verification_status($1)).badge b`, [partner])).rows[0].b;
  try {
    const adminA = await person('Admin A');
    const adminB = await person('Admin B');
    const owner = await person('Owner');
    await db.query(`insert into brand_partners (id, name, active, address) values ($1, 'Race Cafe', true, '1 Race St')`, [partner]);
    await db.query(`select set_config('app.trusted_update', 'on', false)`);
    await db.query(`update profiles set is_admin = true where id = any($1::uuid[])`, [[adminA, adminB]]);
    await db.query(`update profiles set managed_partner_id = $1 where id = $2`, [partner, owner]);

    console.log('1. two admins revoke the same verified business at once');
    let run = await together([{ sub: adminA, sql: VERIFY, args: [partner] }]);
    check(run[0].ok, `verified first (${run[0].error ?? 'ok'})`);
    run = await together([{ sub: adminA, sql: REVOKE, args: [partner] }, { sub: adminB, sql: REVOKE, args: [partner] }]);
    const ok1 = run.filter((r) => r.ok).length;
    check(ok1 === 1, `exactly one revocation committed (${ok1})`);
    check(run.some((r) => !r.ok && /not verified/.test(r.error)), `the other was told it is not verified (${run.map((r) => r.error ?? 'ok').join('; ')})`);
    let h = await history();
    check(h.filter((k) => k === 'revoked').length === 1, `one 'revoked' event (${h.join(',')})`);

    console.log('2. verify and revoke at the same moment, 10 rounds');
    let deadlocks = 0;
    for (let i = 0; i < 10; i += 1) {
      if (!(await badge())) await together([{ sub: adminA, sql: VERIFY, args: [partner] }]);
      run = await together([{ sub: adminA, sql: VERIFY, args: [partner] }, { sub: adminB, sql: REVOKE, args: [partner] }]);
      deadlocks += run.filter((r) => /deadlock/.test(r.error ?? '')).length;
    }
    h = await history();
    const ordered = h.every((k, i) => k !== 'revoked' || h[i - 1] === 'verified');
    check(ordered, `every 'revoked' directly follows a 'verified' (${h.length} events)`);
    check(deadlocks === 0, `no deadlocks (${deadlocks})`);
    check((await badge()) === (h[h.length - 1] === 'verified'), `badge = the latest event (${h[h.length - 1]})`);

    console.log('3. two admins verify the same business at once');
    run = await together([{ sub: adminA, sql: VERIFY, args: [partner] }, { sub: adminB, sql: VERIFY, args: [partner] }]);
    check(run.every((r) => r.ok), `both reviews committed (${run.map((r) => r.error ?? 'ok').join('; ')})`);
    h = await history();
    check(h.slice(-2).join(',') === 'verified,verified', `both recorded (${h.slice(-2).join(',')})`);
    check(await badge(), 'badge on');
  } finally {
    await db.query(`delete from brand_partners where id = $1`, [partner]);
    await db.query(`delete from auth.users where id = any($1::uuid[])`, [ids]);
    const left = (await db.query(`select (select count(*)::int from auth.users where id = any($1::uuid[])) users,
      (select count(*)::int from private.business_verification_events where partner_id = $2) events`, [ids, partner])).rows[0];
    check(left.users === 0 && left.events === 0, `cleaned up (users ${left.users}, events ${left.events})`);
    await db.end();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
