#!/usr/bin/env node
// Migration 20270392 under real concurrency, on the LOCAL replay database only. A journey is one transaction and can't race, so here
// separate sessions really overlap, each holding its transaction open before committing.
//   1. the same person sends the same report twice at once: exactly one is filed, the other is refused as a duplicate.
//   2. two different people report at once: both filed, nobody blocked.
//   3. a report vs the host deleting the gathering, both orders: either refused, or filed with the whole copy; never half.
//   4. a report vs the host editing title + description together: the copy is wholly the old or wholly the new, never a mix.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/object-report-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const crypto = require('crypto');

const HOLD_MS = 120;
const ROUNDS = 10;
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

const report = (sub, id, wait = 0) => ({ sub, wait, sql: `insert into reports (reporter_id, reason, content_type, content_id) values ($1, 'other', 'gathering', $2) returning id`, args: [sub, id] });

(async () => {
  const db = await connect();
  const [H, R, R2] = [0, 1, 2].map(() => crypto.randomUUID());
  for (const [i, u] of [H, R, R2].entries()) {
    await db.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`, [u, `o${i}-${u.slice(0, 8)}@concurrency.invalid`, `1558${String(i).padStart(8, '0')}${Date.now() % 10}`.slice(0, 13)]);
    await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
      values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false)`, [u, `Race ${i}`]);
  }
  await db.query(`delete from private.rate_limit_rules where action in ('report', 'urgent_report', 'gathering_create')`);
  const gathering = async () => {
    const id = crypto.randomUUID();
    await db.query(`insert into gatherings (id, host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
      values ($1, $2, 'T0', 'D0', now() + interval '2 days', 26.7, -80.0, 'Coffee', 'abc', 'everyone', true)`, [id, H]);
    return id;
  };
  const rows = async (id) => (await db.query(`select id, reporter_id, content_excerpt from reports where content_id = $1`, [id])).rows;

  console.log('1. same person, same report, twice at once');
  for (let i = 0; i < ROUNDS; i += 1) {
    const g = await gathering();
    const res = await Promise.all([run(report(R, g)), run(report(R, g))]);
    const filed = await rows(g);
    check(filed.length === 1 && res.filter((x) => x.ok).length === 1 && res.find((x) => !x.ok)?.hint === 'report_duplicate', `round ${i}: one filed, one report_duplicate`);
  }

  console.log('2. two people at once');
  for (let i = 0; i < 3; i += 1) {
    const g = await gathering();
    const res = await Promise.all([run(report(R, g)), run(report(R2, g))]);
    check(res.every((x) => x.ok) && (await rows(g)).length === 2, `round ${i}: both filed`);
  }

  console.log('3. report vs delete, both orders');
  for (let i = 0; i < ROUNDS; i += 1) {
    const g = await gathering();
    const del = { sub: H, sql: `delete from gatherings where id = $1`, args: [g], wait: i % 2 ? 40 : 0 };
    const res = await Promise.all([run(report(R, g, i % 2 ? 0 : 40)), run(del)]);
    const filed = await rows(g);
    const gone = (await db.query(`select 1 from gatherings where id = $1`, [g])).rows.length === 0;
    const whole = filed.length === 1 && /^Gathering: T0\n.*Description: D0$/s.test(filed[0].content_excerpt);
    const refused = filed.length === 0 && res[0].hint === 'report_content_mismatch';
    check(gone && (whole || refused), `round ${i}: gathering gone, report ${whole ? 'filed with the whole copy' : refused ? 'refused' : `WRONG ${JSON.stringify(res)}`}`);
  }

  console.log('4. report vs edit');
  for (let i = 0; i < ROUNDS; i += 1) {
    const g = await gathering();
    const edit = { sql: `update gatherings set title = 'T1', description = 'D1' where id = $1`, args: [g], wait: i % 2 ? 40 : 0 };
    const res = await Promise.all([run(report(R, g, i % 2 ? 0 : 40)), run(edit)]);
    const [filed] = await rows(g);
    const consistent = !!filed && (/^Gathering: T0\n.*Description: D0$/s.test(filed.content_excerpt) || /^Gathering: T1\n.*Description: D1$/s.test(filed.content_excerpt));
    check(res.every((x) => x.ok) && consistent, `round ${i}: copy is wholly ${filed?.content_excerpt.slice(11, 13)}`);
  }

  await db.end();
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
