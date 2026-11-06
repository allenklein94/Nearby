#!/usr/bin/env node
// Migration 20270393 under real concurrency, on the LOCAL replay database only. A journey is one transaction and can't race, so here
// separate sessions really overlap, each holding its transaction open before committing, in both orders.
//   1. two admins, two reports, one gathering: removed once, one record, one owner push.
//   2. remove vs resolve of the same report: a report resolved first is refused; never removed on a resolved report's say-so.
//   3. remove vs a join: refused, or in the snapshot; no attendee row left either way.
//   4. remove vs a chat message: refused, or deleted with the object; nothing left.
//   5. remove vs a new report: refused, or filed with the whole copy.
//   6. remove vs the host's cancel: exactly one acts, nothing half done.
//   7. remove vs the recurring generator (the real function), both orders: no occurrence survives.
//   8. remove a community vs a member joining and a message.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/content-removal-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const crypto = require('crypto');

const HOLD_MS = 120;
const ROUNDS = 8;
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(step) {
  if (step.wait) await sleep(step.wait);
  const c = await connect();
  try {
    await c.query('begin');
    if (step.sub) {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: step.sub, role: 'authenticated' })]);
      await c.query('set local role authenticated');
    }
    const r = await c.query(step.sql, step.args);
    await sleep(HOLD_MS);
    await c.query('commit');
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    return { ok: false, error: e.message, hint: e.hint };
  } finally {
    await c.end();
  }
}

const WHY = 'Reported and confirmed as fraud';

(async () => {
  const db = await connect();
  const people = [0, 1, 2, 3, 4].map(() => crypto.randomUUID());
  const [A1, A2, H, R, R2] = people;
  for (const [i, u] of people.entries()) {
    await db.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`, [u, `cr${i}-${u.slice(0, 8)}@concurrency.invalid`, `1557${String(i).padStart(8, '0')}${Date.now() % 10}`.slice(0, 13)]);
    await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden, is_admin)
      values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false, $3)`, [u, `Race ${i}`, i < 2]);
  }
  // the report + chat caps would stop these rounds; put back exactly below
  const { rows: caps } = await db.query(`delete from private.rate_limit_rules returning *`);
  const gathering = async (series = null, when = `now() + interval '2 days'`) => {
    const id = crypto.randomUUID();
    await db.query(`insert into gatherings (id, host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public, recurrence_rule, recurring_series_id)
      values ($1, $2, 'T0', 'D0', ${when}, 26.7, -80.0, 'Coffee', 'abc', 'everyone', true, $3, $4)`, [id, H, series ? 'weekly' : null, series]);
    return id;
  };
  const report = async (type, id, who = R) => (await run({ sub: who, sql: `insert into reports (reporter_id, reason, content_type, content_id) values ($1, 'other', '${type}', $2) returning id`, args: [who, id] })).rows[0].id;
  const remove = (admin, rep, wait = 0) => ({ sub: admin, wait, sql: `select public.admin_remove_reported_content($1, '${WHY}') as r`, args: [rep] });
  const records = async (id) => (await db.query(`select snapshot from private.content_removals where content_id = $1`, [id])).rows;
  const exists = async (table, id) => (await db.query(`select 1 from ${table} where id = $1`, [id])).rows.length > 0;

  console.log('1. two admins, two reports, one gathering');
  for (let i = 0; i < ROUNDS; i += 1) {
    const g = await gathering();
    const [r1, r2] = [await report('gathering', g, R), await report('gathering', g, R2)];
    await db.query(`delete from push_outbox where recipient_id = $1`, [H]);
    const res = await Promise.all([run(remove(A1, r1)), run(remove(A2, r2))]);
    const removed = res.map((x) => x.rows?.[0]?.r?.removed).sort();
    const pushes = (await db.query(`select count(*)::int as n from push_outbox where recipient_id = $1`, [H])).rows[0].n;
    check(JSON.stringify(removed) === '[0,1]' && (await records(g)).length === 1 && pushes === 1 && !(await exists('gatherings', g)), `round ${i}: removed once, one record, one push`);
  }

  console.log('2. remove vs resolve, both orders');
  for (let i = 0; i < ROUNDS; i += 1) {
    const g = await gathering();
    const r1 = await report('gathering', g);
    const resolve = { sub: A2, wait: i % 2 ? 0 : 40, sql: `select public.admin_resolve_report($1, 'no_action', 'looks fine')`, args: [r1] };
    const res = await Promise.all([run(remove(A1, r1, i % 2 ? 40 : 0)), run(resolve)]);
    const removedFirst = res[0].ok && res[0].rows[0].r.removed === 1;
    const gone = !(await exists('gatherings', g));
    const held = !res[0].ok && res[0].hint === 'report_resolved' && !gone;
    check((removedFirst && gone && res[1].ok) || held, `round ${i}: ${removedFirst ? 'removed, then resolved' : held ? 'resolved first, removal refused' : `WRONG ${JSON.stringify(res)}`}`);
  }

  console.log('3. remove vs a join, both orders');
  for (let i = 0; i < ROUNDS; i += 1) {
    const g = await gathering();
    const r1 = await report('gathering', g);
    const join = { sub: R2, wait: i % 2 ? 0 : 40, sql: `select public.join_gathering($1)`, args: [g] };
    const res = await Promise.all([run(remove(A1, r1, i % 2 ? 40 : 0)), run(join)]);
    const left = (await db.query(`select count(*)::int as n from gathering_interest where gathering_id = $1`, [g])).rows[0].n;
    const [rec] = await records(g);
    const inSnapshot = !!rec && rec.snapshot.attendees.some((a) => a.user_id === R2);
    check(res[0].ok && left === 0 && !!rec && (res[1].ok === inSnapshot), `round ${i}: no attendee left, join ${res[1].ok ? 'in the snapshot' : 'refused'}`);
  }

  console.log('4. remove vs a chat message, both orders');
  for (let i = 0; i < ROUNDS; i += 1) {
    const g = await gathering();
    await db.query(`insert into gathering_interest (gathering_id, user_id, status) values ($1, $2, 'approved')`, [g, R2]);
    const r1 = await report('gathering', g);
    const msg = { sub: R2, wait: i % 2 ? 0 : 40, sql: `insert into gathering_messages (gathering_id, sender_id, body) values ($1, $2, 'hello')`, args: [g, R2] };
    const res = await Promise.all([run(remove(A1, r1, i % 2 ? 40 : 0)), run(msg)]);
    const left = (await db.query(`select count(*)::int as n from gathering_messages where gathering_id = $1`, [g])).rows[0].n;
    check(res[0].ok && left === 0, `round ${i}: nothing left, message ${res[1].ok ? 'deleted with it' : 'refused'}`);
  }

  console.log('5. remove vs a new report, both orders');
  for (let i = 0; i < ROUNDS; i += 1) {
    const g = await gathering();
    const r1 = await report('gathering', g);
    const late = { sub: R2, wait: i % 2 ? 0 : 40, sql: `insert into reports (reporter_id, reason, content_type, content_id) values ($1, 'other', 'gathering', $2) returning content_excerpt`, args: [R2, g] };
    const res = await Promise.all([run(remove(A1, r1, i % 2 ? 40 : 0)), run(late)]);
    const whole = res[1].ok && /^Gathering: T0\n.*Description: D0$/s.test(res[1].rows[0].content_excerpt);
    const refused = !res[1].ok && res[1].hint === 'report_content_mismatch';
    check(res[0].ok && !(await exists('gatherings', g)) && (whole || refused), `round ${i}: ${whole ? 'filed with the whole copy' : refused ? 'refused' : `WRONG ${JSON.stringify(res[1])}`}`);
  }

  console.log('6. remove vs the host\'s cancel, both orders');
  for (let i = 0; i < ROUNDS; i += 1) {
    const g = await gathering();
    const r1 = await report('gathering', g);
    const cancel = { sub: H, wait: i % 2 ? 0 : 40, sql: `select public.cancel_gathering($1)`, args: [g] };
    const res = await Promise.all([run(remove(A1, r1, i % 2 ? 40 : 0)), run(cancel)]);
    const recs = (await records(g)).length;
    const removalWon = res[0].rows?.[0]?.r?.removed === 1 && !res[1].ok && recs === 1;
    const cancelWon = res[1].ok && res[0].rows?.[0]?.r?.already === true && recs === 0;
    check(!(await exists('gatherings', g)) && (removalWon || cancelWon), `round ${i}: ${removalWon ? 'removal won' : cancelWon ? 'cancel won, nothing recorded' : `WRONG ${JSON.stringify(res)}`}`);
  }

  console.log('7. remove vs the recurring generator, both orders');
  for (let i = 0; i < ROUNDS; i += 1) {
    const series = crypto.randomUUID();
    const g = await gathering(series, `now() - interval '2 hours'`);
    const r1 = await report('gathering', g);
    const gen = { wait: i % 2 ? 0 : 40, sql: `select public.generate_next_recurring_gathering()` };
    const res = await Promise.all([run(remove(A1, r1, i % 2 ? 40 : 0)), run(gen)]);
    const left = (await db.query(`select count(*)::int as n from gatherings where recurring_series_id = $1`, [series])).rows[0].n;
    check(res.every((x) => x.ok) && left === 0, `round ${i}: no occurrence left (${(await db.query(`select count(*)::int as n from private.content_removals where series_id = $1`, [series])).rows[0].n} removed)`);
  }

  console.log('8. remove a community vs a member joining + a message, both orders');
  for (let i = 0; i < ROUNDS; i += 1) {
    const c = crypto.randomUUID();
    await db.query(`update profiles set communities_created_today = 0 where id = $1`, [H]); // the 3-a-day limit, not under test
    await db.query(`insert into communities (id, name, description, creator_id, interest_tag, is_public) values ($1, 'C0', 'D0', $2, 'Coffee', true)`, [c, H]);
    await db.query(`insert into community_members (community_id, user_id) values ($1, $2)`, [c, R]);
    const r1 = await report('community', c);
    const res = await Promise.all([
      run(remove(A1, r1, i % 2 ? 40 : 0)),
      run({ sub: R2, wait: i % 2 ? 0 : 40, sql: `insert into community_members (community_id, user_id) values ($1, $2)`, args: [c, R2] }),
      run({ sub: R, wait: i % 2 ? 0 : 40, sql: `insert into community_messages (community_id, sender_id, body) values ($1, $2, 'hi')`, args: [c, R] }),
    ]);
    const left = (await db.query(`select (select count(*) from community_members where community_id = $1)::int + (select count(*) from community_messages where community_id = $1)::int as n`, [c])).rows[0].n;
    check(res[0].ok && left === 0 && !(await exists('communities', c)), `round ${i}: nothing left`);
  }

  await db.query(`delete from reports where reporter_id = any($1) or reported_id = any($1)`, [people]);
  await db.query(`delete from gatherings where host_id = $1`, [H]);
  await db.query(`delete from communities where creator_id = $1`, [H]);
  await db.query(`delete from private.content_removals where owner_id = $1`, [H]);
  await db.query(`delete from push_outbox where recipient_id = any($1)`, [people]);
  await db.query(`delete from auth.users where id = any($1)`, [people]);
  for (const c of caps) {
    const keys = Object.keys(c);
    await db.query(`insert into private.rate_limit_rules (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map((k) => c[k]));
  }
  await db.end();
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
