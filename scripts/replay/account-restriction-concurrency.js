#!/usr/bin/env node
// Migration 20270399 (admin-controlled temporary restrictions) under real concurrency, on the LOCAL replay database only
// (NEARBY_LOCAL_DB_URL; refuses anything else). A journey is one transaction and cannot race, so here separate sessions really
// overlap, each holding its transaction open before committing.
//   1. two admins lift the same pause at the same moment: one lifts it, the other is told it already ended; exactly ONE "lift"
//      record, the row lifted once.
//   2. two admins pause the same person at the same moment (different actions): both pauses recorded, each with its own
//      "restrict" record, never interleaved or lost.
//   3. a pause committed while the person is sending: a message that committed BEFORE the pause stays; once the pause has
//      committed, the next message is refused with 'account_restricted'.
//   4. a lift racing the person's send: after the lift commits, the next message goes through.
// Every row it creates is deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/account-restriction-concurrency.js
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

// each step = { sub, sql, args, delay }: its own session as authenticated, waits `delay`, runs, holds HOLD_MS, then commits
async function together(steps) {
  return Promise.all(steps.map(async (step) => {
    const c = await connect();
    try {
      await sleep(step.delay || 0);
      await c.query('begin');
      await c.query(claims(step.sub, 'authenticated'));
      await c.query('set local role authenticated');
      const r = await c.query(step.sql, step.args);
      await sleep(step.hold ?? HOLD_MS);
      await c.query('commit');
      return { ok: true, row: r.rows[0] };
    } catch (e) {
      await c.query('rollback').catch(() => {});
      return { ok: false, error: e.message, hint: e.hint };
    } finally {
      await c.end();
    }
  }));
}

(async () => {
  const db = await connect();
  const ids = [];
  const person = async (label, admin = false) => {
    const id = crypto.randomUUID();
    ids.push(id);
    await db.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`,
    [id, `${label}-${id.slice(0, 8)}@concurrency.invalid`, `1557${String(ids.length).padStart(8, '0')}`]);
    await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
      values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false)`, [id, `Race ${label}`]);
    if (admin) {
      await db.query(`select set_config('app.trusted_update', 'on', false)`);
      await db.query('update profiles set is_admin = true where id = $1', [id]);
      await db.query(`select set_config('app.trusted_update', 'off', false)`);
    }
    return id;
  };
  const savedRules = (await db.query('select * from private.rate_limit_rules')).rows;
  try {
    await db.query('delete from private.rate_limit_rules');
    const a1 = await person('admin1', true);
    const a2 = await person('admin2', true);
    const p = await person('person');
    const q = await person('friend');
    const matchId = (await db.query('insert into matches (user_a, user_b) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid)) returning id', [p, q])).rows[0].id;
    const restrictSql = `select public.admin_restrict_account($1, $2::text[], 3, 'Concurrency test: repeated spam') as r`;
    const send = (body, delay = 0, hold) => ({ sub: p, sql: 'insert into messages (match_id, sender_id, body) values ($1, $2, $3) returning id', args: [matchId, p, body], delay, hold });

    console.log('1. two admins lift the same pause at once');
    const rid = (await db.query(`select (public_r -> 'restriction_ids' ->> 0)::uuid id from (select null) x,
      lateral (select set_config('request.jwt.claims', $$${JSON.stringify({ sub: a1, role: 'authenticated' })}$$, true)) c,
      lateral (select public.admin_restrict_account($1, array['links'], 3, 'Concurrency test: links spam') public_r) r`, [p])).rows[0].id;
    const lifts = await together([a1, a2].map((sub) => ({ sub, sql: `select public.admin_lift_account_restriction($1, 'Concurrency test: reviewed') as r`, args: [rid] })));
    const lifted = lifts.filter((x) => x.ok && x.row.r.lifted).length;
    const already = lifts.filter((x) => x.ok && x.row.r.already).length;
    check(lifted === 1 && already === 1, `one lifted, one told it already ended (${lifted} / ${already}; ${lifts.map((x) => x.error).filter(Boolean).join('; ') || 'no errors'})`);
    const liftEvents = (await db.query(`select count(*)::int n from private.account_restriction_events where restriction_id = $1 and action = 'lift'`, [rid])).rows[0].n;
    check(liftEvents === 1, `exactly one lift record (${liftEvents})`);

    console.log('2. two admins pause the same person at once');
    const pauses = await together([{ sub: a1, sql: restrictSql, args: [p, ['invitations']] }, { sub: a2, sql: restrictSql, args: [p, ['gatherings']] }]);
    check(pauses.every((x) => x.ok), `both pauses accepted (${pauses.map((x) => x.error).filter(Boolean).join('; ') || 'no errors'})`);
    const caps = (await db.query(`select array_agg(capability order by capability) c from private.account_restrictions where user_id = $1 and lifted_at is null`, [p])).rows[0].c;
    check(JSON.stringify(caps) === JSON.stringify(['gatherings', 'invitations']), `both recorded (${caps})`);
    const restrictEvents = (await db.query(`select count(*)::int n from private.account_restriction_events where user_id = $1 and action = 'restrict'`, [p])).rows[0].n;
    check(restrictEvents === 3, `one restrict record each (3 incl. step 1's) (${restrictEvents})`);

    console.log('3. a pause committed while the person is sending');
    const race = await together([
      send('sent before the pause', 0, 0),
      { sub: a1, sql: restrictSql, args: [p, ['messages']], delay: 150 },
      send('sent after the pause', 900, 0),
    ]);
    check(race[0].ok, `the message committed before the pause stays (${race[0].error || 'ok'})`);
    check(race[1].ok, `the pause committed (${race[1].error || 'ok'})`);
    check(!race[2].ok && race[2].hint === 'account_restricted', `the next message is refused (${race[2].hint || race[2].error || 'went through'})`);

    console.log('4. a lift racing the next send');
    const mid = (await db.query(`select id from private.account_restrictions where user_id = $1 and capability = 'messages' and lifted_at is null`, [p])).rows[0].id;
    const race2 = await together([
      { sub: a2, sql: `select public.admin_lift_account_restriction($1, 'Concurrency test: lifted early') as r`, args: [mid] },
      send('sent after the lift', 900, 0),
    ]);
    check(race2[0].ok && race2[0].row.r.lifted, `the lift committed (${race2[0].error || 'ok'})`);
    check(race2[1].ok, `the next message goes through (${race2[1].error || 'ok'})`);
  } finally {
    await db.query('delete from messages where sender_id = any($1::uuid[])', [ids]);
    await db.query('delete from matches where user_a = any($1::uuid[]) or user_b = any($1::uuid[])', [ids]);
    await db.query('delete from private.account_restrictions where user_id = any($1::uuid[])', [ids]);
    await db.query('delete from auth.users where id = any($1::uuid[])', [ids]);
    await db.query('delete from private.rate_limit_rules');
    for (const r of savedRules) {
      const cols = Object.keys(r);
      await db.query(`insert into private.rate_limit_rules (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((c) => r[c]));
    }
    const left = (await db.query('select count(*)::int n from private.account_restrictions where user_id = any($1::uuid[])', [ids])).rows[0].n;
    check(left === 0, `nothing left behind (${left})`);
    await db.end();
  }
  console.log(failures ? `FAILED: ${failures}` : 'all passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
