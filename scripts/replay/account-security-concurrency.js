#!/usr/bin/env node
// Migration 20270375 (account takeover protection) under real concurrency, on the LOCAL replay database only
// (NEARBY_LOCAL_DB_URL; refuses anything else). A journey is one transaction and cannot race, so here separate sessions
// really overlap, each holding its transaction open before committing. Writes are made the way Auth makes them (as the
// database owner, the role Auth's connection uses on a hosted project).
//   1. six new sign-ins (sessions) for one signed-in account commit at once: ONE "new sign-in" push (never six), six records,
//      no error or deadlock.
//   2. a phone-only account signed in an hour ago: four parallel attempts to add a password / an email / start a number
//      change / set the number: none saved, each recorded, no error (Auth never sees a failure).
//   3. a long-signed-in account: two number changes complete at once (each the way Auth's verify writes it): the account
//      ends on ONE of the two numbers, the second is refused by the clock the first one's sign-in started; exactly one
//      "number changed" push.
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

    console.log('2. parallel takeover attempts on a phone-only account signed in an hour ago');
    const b = await person('15615550192', '1 hour');
    const before = (await db.query(`select phone, coalesce(phone_change, '') pc, coalesce(email, '') e, coalesce(email_change, '') ec, encrypted_password pw from auth.users where id = $1`, [b])).rows[0];
    const r2 = await together([
      { sql: `update auth.users set encrypted_password = '$2a$10$intruderintruderintruderintruderintruderintruderintru' where id = $1`, args: [b] },
      { sql: `update auth.users set email_change = 'intruder@local.invalid', email_change_token_new = 'tok', email_change_sent_at = now() where id = $1`, args: [b] },
      { sql: `update auth.users set phone_change = '15615550193', phone_change_token = 'tok', phone_change_sent_at = now() where id = $1`, args: [b] },
      { sql: `update auth.users set phone = '15615550193', phone_confirmed_at = now() where id = $1`, args: [b] },
    ]);
    const after = (await db.query(`select phone, coalesce(phone_change, '') pc, coalesce(email, '') e, coalesce(email_change, '') ec, encrypted_password pw from auth.users where id = $1`, [b])).rows[0];
    check(r2.every((r) => r.ok), `Auth never sees a failure (${errors(r2)})`);
    check(JSON.stringify(after) === JSON.stringify(before), 'nothing saved: password, email, pending and actual number all unchanged');
    const ev2 = (await events(b)).sort().join();
    check(ev2 === ['email_add_refused', 'password_add_refused', 'phone_change_refused', 'phone_change_refused'].sort().join(), `each attempt recorded (${ev2})`);

    console.log('3. two number changes complete at once on a long-signed-in account');
    const c = await person('15615550194', '3 days');
    const r3 = await together(['15615550195', '15615550196'].map((n) => ({
      sql: `update auth.users set phone = $2, phone_confirmed_at = now(), phone_change = '', phone_change_token = '', last_sign_in_at = now() where id = $1 returning phone`,
      args: [c, n] })));
    const phone = (await db.query('select phone from auth.users where id = $1', [c])).rows[0].phone;
    check(r3.every((r) => r.ok), `both writes return without error (${errors(r3)})`);
    check(['15615550195', '15615550196'].includes(phone), `the account ends on ONE of the two numbers (${phone})`);
    const ev3 = await events(c);
    check(ev3.filter((k) => k === 'phone_changed').length === 1 && ev3.filter((k) => k === 'phone_change_refused').length === 1,
      `one change saved, the other refused by the fresh sign-in (${ev3.join()})`);
    check((await pushes(c)) === 1, `exactly one "number changed" push (got ${await pushes(c)})`);

    const fails = Number((await db.query(`select count(*) n from private.account_security_events where kind = 'guard_failure'`)).rows[0].n);
    check(fails === failuresBefore, 'no guard_failure rows');
  } finally {
    await db.query('delete from push_outbox where recipient_id = any($1::uuid[])', [ids]);
    await db.query('delete from private.account_security_events where user_id = any($1::uuid[])', [ids]);
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
