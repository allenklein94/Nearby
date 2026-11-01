#!/usr/bin/env node
// Migration 20270375 (account takeover protection) under real concurrency, on the LOCAL replay database only
// (NEARBY_LOCAL_DB_URL; refuses anything else). A journey is one transaction and cannot race, so here separate sessions
// really overlap, each holding its transaction open before committing. Writes are made the way Auth makes them (as the
// database owner, the role Auth's connection uses on a hosted project).
//   1. six new sign-ins (sessions) for one signed-in account commit at once: ONE "new sign-in" push (never six), six records,
//      no error or deadlock.
//   2. a phone-only account with no permit: four parallel attempts to add a password / an email / start a number change /
//      set the number: none saved; the first three are quiet for Auth and recorded, the direct number write is REFUSED
//      with an error (revised 0375: never a silent "OK").
//   3. one verified number-change permit (for X) and two number changes at once (to X, to Y with no permit): the account
//      ends on X, the move to Y is refused with an error, the permit is consumed exactly once, one "number changed" push.
//   4. one verified deletion step-up and two deletion authorizations at once from the same established session: exactly one
//      is authorized, the other is refused (step_up_required): a step-up is single use.
// Every row it creates is deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/account-security-concurrency.js
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

// each step = { sql, args }: its own session as the database owner (= Auth), holds, then commits
async function together(steps) {
  return Promise.all(steps.map(async (step) => {
    const c = await connect();
    try {
      await c.query('begin');
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
const errors = (rs) => rs.filter((r) => !r.ok).map((r) => r.error).join('; ') || 'no errors';

(async () => {
  const db = await connect();
  const ids = [];
  const person = async (phone, lastSignIn) => {
    const id = crypto.randomUUID(); ids.push(id);
    await db.query(`insert into auth.users (id, aud, role, phone, encrypted_password, created_at)
        values ($1::uuid, 'authenticated', 'authenticated', $2, '$2a$10$' || md5($1::text) || 'aaaaaaaaaaaaaaaaaaaaa', now() - interval '30 days')`, [id, phone]);
    await db.query(`update auth.users set phone_confirmed_at = now() - interval '30 days', last_sign_in_at = now() - $2::interval where id = $1`, [id, lastSignIn]);
    await db.query(`select set_config('app.trusted_update', 'on', false);`);
    await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
        values ($1::uuid, 'Concurrency ' || left($1::text, 4), date '1995-03-01', now(), now(), 'America/New_York', true, false)`, [id]);
    return id;
  };
  const pushes = async (id) => Number((await db.query(`select count(*) n from push_outbox where recipient_id = $1 and data ->> 'type' = 'account_security_notice'`, [id])).rows[0].n);
  const events = async (id) => (await db.query(`select kind from private.account_security_events where user_id = $1 order by id`, [id])).rows.map((r) => r.kind);
  const failuresBefore = Number((await db.query(`select count(*) n from private.account_security_events where kind = 'guard_failure'`)).rows[0].n);

  try {
    console.log('1. six new sign-ins at once on a signed-in account');
    const a = await person('15615550191', '3 days');
    await db.query(`insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), $1, now() - interval '3 days', now())`, [a]);
    const r1 = await together(Array.from({ length: 6 }, () => ({
      sql: `insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), $1, now(), now()) returning id`, args: [a] })));
    check(r1.every((r) => r.ok), `all six sessions created (${errors(r1)})`);
    check((await pushes(a)) === 1, `ONE "new sign-in" push (got ${await pushes(a)})`);
    check((await events(a)).filter((k) => k === 'new_sign_in_elsewhere').length === 6, 'six sign-ins recorded');

    console.log('2. parallel takeover attempts on a phone-only account with no permit');
    const b = await person('15615550192', '1 hour');
    const before = (await db.query(`select phone, coalesce(phone_change, '') pc, coalesce(email, '') e, coalesce(email_change, '') ec, encrypted_password pw from auth.users where id = $1`, [b])).rows[0];
    const r2 = await together([
      { sql: `update auth.users set encrypted_password = '$2a$10$intruderintruderintruderintruderintruderintruderintru' where id = $1`, args: [b] },
      { sql: `update auth.users set email_change = 'intruder@local.invalid', email_change_token_new = 'tok', email_change_sent_at = now() where id = $1`, args: [b] },
      { sql: `update auth.users set phone_change = '15615550193', phone_change_token = 'tok', phone_change_sent_at = now() where id = $1`, args: [b] },
      { sql: `update auth.users set phone = '15615550193', phone_confirmed_at = now() where id = $1`, args: [b] },
    ]);
    const after = (await db.query(`select phone, coalesce(phone_change, '') pc, coalesce(email, '') e, coalesce(email_change, '') ec, encrypted_password pw from auth.users where id = $1`, [b])).rows[0];
    check(r2.slice(0, 3).every((r) => r.ok), `password / email / starting a change: quiet for Auth (${errors(r2.slice(0, 3))})`);
    check(!r2[3].ok && /not permitted/.test(r2[3].error), `the direct number write is refused with an error (${r2[3].error || 'no error'})`);
    check(JSON.stringify(after) === JSON.stringify(before), 'nothing saved: password, email, pending and actual number all unchanged');
    const ev2 = (await events(b)).sort().join();
    check(ev2 === ['email_add_refused', 'password_add_refused', 'phone_change_refused'].sort().join(), `each quiet attempt recorded (${ev2})`);

    console.log('3. one permit, two number changes at once');
    const c = await person('15615550194', '30 days');
    const sessC = (await db.query(`insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), $1, now() - interval '30 days', now()) returning id`, [c])).rows[0].id;
    const permit = (await db.query(`insert into private.account_step_ups (user_id, purpose, session_id, new_phone, expires_at, verified_at)
        values ($1, 'phone_change', $2, '15615550195', now() + interval '10 minutes', now()) returning id`, [c, sessC])).rows[0].id;
    const r3 = await together(['15615550195', '15615550196'].map((n) => ({
      sql: `update auth.users set phone = $2, phone_confirmed_at = now(), phone_change = '', phone_change_token = '' where id = $1 returning phone`,
      args: [c, n] })));
    const phone = (await db.query('select phone from auth.users where id = $1', [c])).rows[0].phone;
    check(phone === '15615550195', `the account ends on the permitted number (${phone})`);
    check(r3[0].ok && !r3[1].ok && /not permitted/.test(r3[1].error), `the unpermitted move is refused with an error (${errors(r3)})`);
    const consumed = (await db.query('select consumed_at is not null c from private.account_step_ups where id = $1', [permit])).rows[0].c;
    check(consumed === true, 'the permit is consumed');
    const ev3 = await events(c);
    check(ev3.filter((k) => k === 'phone_changed').length === 1, `one change recorded (${ev3.join()})`);
    check((await pushes(c)) === 1, `exactly one "number changed" push (got ${await pushes(c)})`);

    console.log('4. one deletion step-up, two authorizations at once');
    const d = await person('15615550197', '30 days');
    const sessD = (await db.query(`insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), $1, now() - interval '30 days', now()) returning id`, [d])).rows[0].id;
    await db.query(`insert into private.account_step_ups (user_id, purpose, session_id, expires_at, verified_at)
        values ($1, 'delete', $2, now() + interval '10 minutes', now())`, [d, sessD]);
    const prevSwitch = (await db.query('select deletion_protection_enabled v from private.account_security_settings')).rows[0].v;
    await db.query('update private.account_security_settings set deletion_protection_enabled = true');
    try {
      const r4 = await together([0, 1].map(() => ({ sql: `select public.account_deletion_authorize($1, $2, 'aal1') ->> 'mode' as mode`, args: [d, sessD] })));
      const okd = r4.filter((r) => r.ok);
      check(okd.length === 1 && okd[0].row.mode === 'immediate', `exactly one authorized (${r4.map((r) => (r.ok ? r.row.mode : r.error)).join(' | ')})`);
      check(r4.some((r) => !r.ok && /code first/i.test(r.error)), 'the other is refused: the step-up is single use');
    } finally {
      await db.query('update private.account_security_settings set deletion_protection_enabled = $1', [prevSwitch]);
    }

    const fails = Number((await db.query(`select count(*) n from private.account_security_events where kind = 'guard_failure'`)).rows[0].n);
    check(fails === failuresBefore, 'no guard_failure rows');
  } finally {
    await db.query('delete from push_outbox where recipient_id = any($1::uuid[])', [ids]);
    await db.query('delete from private.account_security_events where user_id = any($1::uuid[])', [ids]);
    await db.query('delete from private.account_step_ups where user_id = any($1::uuid[])', [ids]);
    await db.query('delete from auth.sessions where user_id = any($1::uuid[])', [ids]);
    await db.query('delete from profiles where id = any($1::uuid[])', [ids]);
    await db.query('delete from auth.users where id = any($1::uuid[])', [ids]);
    const left = (await db.query(`select (select count(*) from auth.users where id = any($1::uuid[])) + (select count(*) from private.account_security_events where user_id = any($1::uuid[])) n`, [ids])).rows[0].n;
    check(Number(left) === 0, 'cleaned up');
    await db.end();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
