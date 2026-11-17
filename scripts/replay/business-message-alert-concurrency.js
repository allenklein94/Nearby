#!/usr/bin/env node
// Migration 20270428 (business message alerts) under real concurrency, on the LOCAL replay database only
// (NEARBY_LOCAL_DB_URL; refuses anything else). A journey is one transaction and cannot race, so here separate sessions
// really overlap, each holding its transaction open before committing.
//   1. one customer sends 8 messages to one business from 8 parallel sessions: all 8 stored, exactly ONE alert per manager
//      (the 5-minute window is claimed once), no deadlock.
//   2. three customers write to the same business at the same moment: one alert per conversation per manager (windows
//      are per conversation, never shared).
//   3. a message whose transaction rolls back claims nothing: the next message alerts.
// The business_message rate limit (5 per minute) is lifted for this script only and restored; every row it creates is
// deleted afterwards. Pushes stay in the outbox (no service key on a replay database: never handed to send-push).
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/business-message-alert-concurrency.js
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
const claims = (sub) => `select set_config('request.jwt.claims', $$${JSON.stringify({ sub, role: 'authenticated' })}$$, true)`;

async function together(steps) {
  return Promise.all(steps.map(async (step) => {
    const c = await connect();
    try {
      await c.query('begin');
      await c.query(claims(step.sub));
      await c.query('set local role authenticated');
      await c.query(step.sql, step.args);
      await sleep(HOLD_MS);
      await c.query(step.rollback ? 'rollback' : 'commit');
      return { ok: true };
    } catch (e) {
      await c.query('rollback').catch(() => {});
      return { ok: false, error: e.message };
    } finally {
      await c.end();
    }
  }));
}

(async () => {
  const admin = await connect();
  const ids = [];
  const partners = [];
  const person = async (label) => {
    const id = crypto.randomUUID();
    ids.push(id);
    await admin.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`,
    [id, `${label}-${id.slice(0, 8)}@concurrency.invalid`, `1556${String(ids.length).padStart(8, '0')}`]);
    await admin.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
      values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false)`, [id, `Race ${label}`]);
    return id;
  };
  const msg = (sender, partner, body, rollback = false) => ({ sub: sender, rollback,
    sql: 'insert into business_messages (partner_id, sender_id, conversation_with_id, from_business, body) values ($1, $2, $2, false, $3)',
    args: [partner, sender, body] });
  const alerts = async (partner, customer) => (await admin.query(
    `select o.recipient_id::text r from push_outbox o join business_messages m on m.id = (o.data->>'message_id')::uuid
      where o.data->>'type' = 'business_message_received' and m.partner_id = $1 and ($2::uuid is null or m.conversation_with_id = $2)`,
    [partner, customer ?? null])).rows.map((x) => x.r).sort();
  const savedRules = (await admin.query(`select * from private.rate_limit_rules where action = 'business_message'`)).rows;
  try {
    await admin.query(`delete from private.rate_limit_rules where action = 'business_message'`);
    await admin.query(`select set_config('app.trusted_update', 'true', false)`);
    const owner = await person('owner');
    const staff = await person('staff');
    const pid = crypto.randomUUID();
    partners.push(pid);
    await admin.query(`insert into brand_partners (id, name, active, latitude, longitude, address, category, subcategory, categories, max_group_size)
      values ($1, 'Race Cafe', true, 40.0, -75.0, '1 Race St', 'food_drink', 'Coffee', '{}', 40)`, [pid]);
    await admin.query(`update profiles set managed_partner_id = $1 where id in ($2, $3)`, [pid, owner, staff]);
    const managers = [owner, staff].sort();
    const customers = [];
    for (let i = 0; i < 4; i += 1) customers.push(await person(`c${i}`));
    for (const c of customers) await admin.query(`insert into business_followers (brand_partner_id, user_id) values ($1, $2)`, [pid, c]);

    console.log('1. one customer, 8 messages, 8 parallel sessions');
    let run = await together(Array.from({ length: 8 }, (_, i) => msg(customers[0], pid, `Message ${i}`)));
    check(run.every((r) => r.ok), `every message committed (${run.filter((r) => !r.ok).map((r) => r.error).join('; ') || 'no errors'})`);
    const stored = (await admin.query(`select count(*)::int n from business_messages where partner_id = $1 and conversation_with_id = $2`, [pid, customers[0]])).rows[0].n;
    check(stored === 8, `all 8 stored (${stored})`);
    let got = await alerts(pid, customers[0]);
    check(JSON.stringify(got) === JSON.stringify(managers), `exactly one alert per manager (${got.length} alerts)`);

    console.log('2. three customers at the same moment');
    run = await together([1, 2, 3].map((i) => msg(customers[i], pid, 'Hi')));
    check(run.every((r) => r.ok), 'every message committed');
    for (const i of [1, 2, 3]) {
      got = await alerts(pid, customers[i]);
      check(JSON.stringify(got) === JSON.stringify(managers), `customer ${i}: one alert per manager (${got.length})`);
    }

    console.log('3. a message whose transaction rolls back claims nothing');
    await admin.query(`update private.business_message_alert_windows set last_alerted_at = now() - interval '1 hour' where partner_id = $1 and customer_id = $2`, [pid, customers[1]]);
    const before = (await alerts(pid, customers[1])).length;
    run = await together([msg(customers[1], pid, 'never sent', true)]);
    check(run[0].ok, 'rolled back cleanly');
    check((await alerts(pid, customers[1])).length === before, 'no alert from the rolled-back message');
    run = await together([msg(customers[1], pid, 'second try')]);
    check((await alerts(pid, customers[1])).length === before + 2, 'the next message alerts both managers');
  } finally {
    await admin.query(`delete from push_outbox where recipient_id = any($1::uuid[])`, [ids]);
    await admin.query(`delete from business_messages where partner_id = any($1::uuid[])`, [partners]);
    await admin.query(`delete from business_followers where brand_partner_id = any($1::uuid[])`, [partners]);
    await admin.query(`select set_config('app.trusted_update', 'true', false)`);
    await admin.query(`update profiles set managed_partner_id = null where id = any($1::uuid[])`, [ids]);
    if ((await admin.query(`select to_regclass('private.business_memberships') t`)).rows[0].t) {
      await admin.query(`delete from private.business_memberships where user_id = any($1::uuid[])`, [ids]);
    }
    await admin.query(`delete from brand_partners where id = any($1::uuid[])`, [partners]);
    await admin.query(`delete from profiles where id = any($1::uuid[])`, [ids]);
    await admin.query(`delete from auth.users where id = any($1::uuid[])`, [ids]);
    for (const r of savedRules) {
      const cols = Object.keys(r);
      await admin.query(`insert into private.rate_limit_rules (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((k) => r[k]));
    }
    const left = (await admin.query(`select (select count(*) from profiles where id = any($1::uuid[])) + (select count(*) from private.business_message_alert_windows where partner_id = any($2::uuid[])) n`, [ids, partners])).rows[0].n;
    check(Number(left) === 0, `cleanup complete (${left} rows left)`);
    const rules = (await admin.query(`select count(*)::int n from private.rate_limit_rules where action = 'business_message'`)).rows[0].n;
    check(rules === savedRules.length, `business_message limits restored (${rules})`);
    await admin.end();
  }
  console.log(failures ? `FAILED: ${failures}` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
