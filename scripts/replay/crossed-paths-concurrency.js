#!/usr/bin/env node
// Migration 20270384 (crossed paths safeguards) under real concurrency, on the LOCAL replay database only
// (NEARBY_LOCAL_DB_URL; refuses anything else). A journey is one transaction and cannot race, so here separate sessions
// really overlap, each holding its transaction open before committing. Writes are made as report-presence makes them
// (service side: presence upsert, then the sightings upsert); the switch runs under the real `authenticated` role.
//   1. one opted-in person sends 8 presence reports for 8 different cells at once: at most ONE new cell is counted
//      (window_count = 1), no error or deadlock (the 30 s gap can't be beaten by sending in parallel).
//   2. "off" vs a crossing being written, both orders: whichever commits first, afterwards there is no crossing for the
//      person who turned it off, and no error or deadlock.
//   3. "off" vs that person's own presence report: afterwards no stored cell is left for them.
//   4. both people's report-presence calls write the same crossing at once: one record, one push each, no error.
//   5. one encounter per pair: after a crossing, 4 rounds of switching off and on racing fresh reports + re-crossings (both
//      directions) never create a second encounter: no crossing left, still one push each, one memory row, no error.
// Every row it creates is deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/crossed-paths-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const crypto = require('crypto');

const HOLD_MS = 400;
const CELL = '26.7001,-80.0501';
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REPORT = (who, area) => ({ sql: `insert into presence_reports (user_id, area, reported_at) values ($1, $2, now())
  on conflict (user_id) do update set area = excluded.area, reported_at = excluded.reported_at`, args: [who, area] });
const CROSS = (a, b, area) => {
  const [x, y] = [a, b].sort();
  return { sql: `insert into sightings (user_a, user_b, approx_area, last_seen_at, expires_at)
    values ($1, $2, $3, now(), now() + interval '48 hours')
    on conflict (user_a, user_b) do update set approx_area = excluded.approx_area, last_seen_at = excluded.last_seen_at,
      expires_at = excluded.expires_at`, args: [x, y, area] };
};
const SWITCH = (who, on) => ({ sql: 'select set_crossed_paths_sharing($1)', args: [on], as: who });

// each call in its own session; `delay` staggers the start, every transaction is held HOLD_MS before commit
async function run({ sql, args, as }, delay = 0) {
  await sleep(delay);
  const c = await connect();
  try {
    await c.query('begin');
    if (as) {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: as, role: 'authenticated' })]);
      await c.query('set local role authenticated');
    }
    await c.query(sql, args);
    await sleep(HOLD_MS);
    await c.query('commit');
    return { ok: true };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    return { ok: false, code: e.code, error: e.message };
  } finally {
    await c.end();
  }
}
const errors = (rs) => rs.filter((r) => !r.ok).map((r) => `${r.code} ${r.error}`);

(async () => {
  const admin = await connect();
  const ids = [];
  let n = 0;
  const person = async () => {
    const id = crypto.randomUUID();
    ids.push(id);
    n += 1;
    await admin.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '9 days', $3, now())`,
      [id, `${id}@crossed-paths.invalid`, `1555089${String(n).padStart(4, '0')}`]);
    await admin.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified,
        profile_hidden, onboarding_motivations)
      values ($1, 'Crossing test', date '1994-05-01', now() - interval '9 days', now(), 'America/New_York', true, false, $2)`,
      [id, ['Go on dates']]);
    await admin.query('insert into private.crossed_paths_consent (user_id) values ($1)', [id]);
    return id;
  };
  const crossing = async (a, b) => Number((await admin.query(
    'select count(*) from sightings where user_a = least($1::uuid, $2::uuid) and user_b = greatest($1::uuid, $2::uuid)', [a, b])).rows[0].count);
  const probe = async (id) => (await admin.query('select * from private.crossed_paths_probe where user_id = $1', [id])).rows[0];
  const ready = async (...people) => {
    for (const p of people) await run(REPORT(p, CELL));
  };
  try {
    console.log('1. 8 parallel presence reports with 8 different cells');
    const a = await person();
    const rs1 = await Promise.all(Array.from({ length: 8 }, (_, i) => run(REPORT(a, `26.70${String(i + 10)},-80.0501`))));
    check(errors(rs1).length === 0, `no error or deadlock (${JSON.stringify(errors(rs1))})`);
    const p1 = await probe(a);
    check(p1 && p1.window_count === 1, `exactly one new cell counted (window_count ${p1 && p1.window_count})`);

    for (const order of ['off first', 'crossing first']) {
      console.log(`2. "off" vs a crossing being written (${order})`);
      const x = await person();
      const y = await person();
      await ready(x, y);
      const offFirst = order === 'off first';
      const rs2 = await Promise.all([run(SWITCH(y, false), offFirst ? 0 : 150), run(CROSS(x, y, CELL), offFirst ? 150 : 0)]);
      check(errors(rs2).length === 0, `no error or deadlock (${JSON.stringify(errors(rs2))})`);
      check(await crossing(x, y) === 0, `no crossing left for the person who turned it off (got ${await crossing(x, y)})`);
    }

    for (const order of ['off first', 'report first']) {
      console.log(`3. "off" vs the same person's presence report (${order})`);
      const z = await person();
      await run(REPORT(z, '26.7101,-80.0501'));
      const offFirst = order === 'off first';
      const rs3 = await Promise.all([run(SWITCH(z, false), offFirst ? 0 : 150), run(REPORT(z, '26.7101,-80.0501'), offFirst ? 150 : 0)]);
      check(errors(rs3).length === 0, `no error or deadlock (${JSON.stringify(errors(rs3))})`);
      const pz = await probe(z);
      check(!pz || (pz.eligible_area === null && pz.eligible_at === null), 'no stored cell left');
    }

    console.log('4. both report-presence calls write the same crossing at once');
    const p = await person();
    const q = await person();
    await ready(p, q);
    const start = Number((await admin.query('select coalesce(max(id), 0) m from push_outbox')).rows[0].m);
    await admin.query(`select set_config('app.push_handoff_test_failure', 'on', false)`);
    const rs4 = await Promise.all([run(CROSS(p, q, CELL)), run(CROSS(q, p, CELL))]);
    check(errors(rs4).length === 0, `no error or deadlock (${JSON.stringify(errors(rs4))})`);
    check(await crossing(p, q) === 1, 'one record');
    const pushes = (await admin.query(`select recipient_id, count(*)::int n from push_outbox where id > $1
      and data->>'type' = 'crossed_paths_sighting' and recipient_id = any($2) group by recipient_id`, [start, [p, q]])).rows;
    check(pushes.length === 2 && pushes.every((r) => r.n === 1), `one push each (${JSON.stringify(pushes)})`);

    console.log('5. switching off and on while re-crossings are written: no second encounter');
    const u = await person();
    const w = await person();
    await ready(u, w);
    const start5 = Number((await admin.query('select coalesce(max(id), 0) m from push_outbox')).rows[0].m);
    await run(CROSS(u, w, CELL));
    check(await crossing(u, w) === 1, 'first encounter recorded');
    const eligibleAgain = () => admin.query(`update private.crossed_paths_probe set last_new_cell_at = now() - interval '31 seconds'
      where user_id = any($1)`, [[u, w]]);
    const rs5 = [];
    for (let round = 0; round < 4; round += 1) {
      await eligibleAgain();
      rs5.push(...await Promise.all([
        run(SWITCH(w, false)).then(async (r) => [r, await run(SWITCH(w, true))]),
        (async () => [await run(REPORT(w, CELL), 50), await run(REPORT(u, CELL)), await run(CROSS(u, w, CELL)), await run(CROSS(w, u, CELL))])(),
      ]).then((x) => x.flat()));
    }
    check(errors(rs5).length === 0, `no error or deadlock (${JSON.stringify(errors(rs5))})`);
    await eligibleAgain();
    await ready(u, w);
    await run(CROSS(u, w, CELL));
    check(await crossing(u, w) === 0, `no fresh encounter after off -> on (got ${await crossing(u, w)})`);
    const pushes5 = (await admin.query(`select recipient_id, count(*)::int n from push_outbox where id > $1
      and data->>'type' = 'crossed_paths_sighting' and recipient_id = any($2) group by recipient_id`, [start5, [u, w]])).rows;
    check(pushes5.length === 2 && pushes5.every((r) => r.n === 1), `still one push each (${JSON.stringify(pushes5)})`);
    const mem5 = Number((await admin.query(`select count(*) from private.crossed_paths_encounters
      where user_a = least($1::uuid, $2::uuid) and user_b = greatest($1::uuid, $2::uuid) and expires_at > now()`, [u, w])).rows[0].count);
    check(mem5 === 1, `one live encounter memory (got ${mem5})`);
  } finally {
    await admin.query('delete from push_outbox where recipient_id = any($1)', [ids]);
    await admin.query('delete from sightings where user_a = any($1) or user_b = any($1)', [ids]);
    await admin.query('delete from presence_reports where user_id = any($1)', [ids]);
    await admin.query('delete from profiles where id = any($1)', [ids]);
    await admin.query('delete from auth.users where id = any($1)', [ids]);
    const left = Number((await admin.query(`select (select count(*) from auth.users where id = any($1))
      + (select count(*) from private.crossed_paths_consent where user_id = any($1))
      + (select count(*) from private.crossed_paths_consent_log where user_id = any($1))
      + (select count(*) from private.crossed_paths_probe where user_id = any($1))
      + (select count(*) from private.crossed_paths_encounters where user_a = any($1) or user_b = any($1))
      + (select count(*) from sightings where user_a = any($1) or user_b = any($1)) as n`, [ids])).rows[0].n);
    check(left === 0, `cleanup: ${left} rows left`);
    await admin.end();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
