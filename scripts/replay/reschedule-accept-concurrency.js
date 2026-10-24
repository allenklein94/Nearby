#!/usr/bin/env node
// Migration 20270343 under real concurrency, on the LOCAL replay database only (NEARBY_LOCAL_DB_URL; refuses anything else).
// A journey runs in one transaction and cannot race, so here two separate sessions really overlap, each holding its transaction
// open so the other waits on the lock:
//   1. accept first, reschedule second: the host's direct time change waits for the accept, then is refused
//      (gathering_time_booked); the booking stands, the time is unchanged.
//   2. reschedule first, accept second: since 20270344 (idea "394") the time change is refused at once because the business has
//      already replied to the gathering's request (gathering_request_has_replies); the accept then books at the unchanged time.
//   3. accept first, cancel_gathering second: the cancel waits, then cancels the fresh booking with the gathering; no deadlock.
//   4. cancel_gathering first, accept second: the accept waits, then is refused (the request was cancelled); nothing booked.
// Each case runs ROUNDS times; every row is deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/reschedule-accept-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');

const ROUNDS = 5;
const HOLD_MS = 600;
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = (sub) => `select set_config('request.jwt.claims', $$${JSON.stringify({ sub, role: 'authenticated' })}$$, true)`;

async function setup(admin, host, partner) {
  // 20 gatherings for one host per run: reset the app's 10-per-day counter on this throwaway database (the rule itself is untouched).
  await admin.query(`update profiles set gatherings_created_today = 0 where id = $1`, [host]);
  const { rows: [{ id: g }] } = await admin.query(
    `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
     values ($1, 'Replay reschedule race', now() + interval '2 days', 1.5, -150.5, 'Coffee', 'replay', 10, 'everyone', true) returning id`, [host]);
  const { rows: [{ id: req }] } = await admin.query(
    `insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, gathering_id)
     values ($1, 'replay reschedule race', 26.36, -80.08, now() + interval '1 day', 4, 'Coffee', $2) returning id`, [host, g]);
  const { rows: [{ id: offer }] } = await admin.query(
    `insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description)
     values ($1, $2, 'offered', 'standard', 'Replay race offer') returning id`, [req, partner]);
  const { rows: [{ t }] } = await admin.query(`select scheduled_at as t from gatherings where id = $1`, [g]);
  return { g, req, offer, t };
}

async function cleanup(admin, { g, req }) {
  await admin.query(`delete from business_reservations where offer_id in (select id from business_request_offers where request_id = $1)`, [req]);
  await admin.query(`delete from business_request_offers where request_id = $1`, [req]);
  await admin.query(`delete from plans where resulting_gathering_id = $1 or id in (select plan_id from plan_items where business_request_id = $2)`, [g, req]).catch(() => {});
  await admin.query(`delete from business_requests where id = $1`, [req]).catch(() => {});
  await admin.query(`delete from gatherings where id = $1`, [g]);
}

// first = { sql, role } runs and holds its transaction HOLD_MS; second fires once first's statement returned, and must wait.
async function race(host, first, second) {
  const a = await connect();
  const b = await connect();
  const run = async (c, step) => {
    await c.query(`begin; ${claims(host)}`);
    if (step.asClient) await c.query('set local role authenticated');
    return c.query(step.sql, step.args);
  };
  let firstErr = null;
  try { await run(a, first); } catch (e) { firstErr = e; }
  const t0 = Date.now();
  const secondP = run(b, second).then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message, hint: e.hint }));
  await sleep(HOLD_MS);
  await a.query(firstErr ? 'rollback' : 'commit');
  const res = await secondP;
  const waited = Date.now() - t0;
  await b.query(res.ok ? 'commit' : 'rollback').catch(() => {});
  await a.end(); await b.end();
  return { firstErr, second: res, waited };
}

const accept = (offer) => ({ sql: 'select accept_business_offer($1)', args: [offer] });
const moveTime = (g) => ({ sql: `update gatherings set scheduled_at = scheduled_at + interval '1 hour' where id = $1`, args: [g], asClient: true });
const cancelG = (g) => ({ sql: 'select cancel_gathering($1)', args: [g] });

(async () => {
  const admin = await connect();
  const [{ partner }] = (await admin.query(`select managed_partner_id as partner from profiles where managed_partner_id is not null limit 1`)).rows;
  const [{ host }] = (await admin.query(`select id as host from profiles where managed_partner_id is null order by created_at limit 1`)).rows;
  const state = async (o) => (await admin.query(
    `select (select status from business_request_offers where id = $1) as offer,
            (select status from business_requests where id = $2) as request,
            (select scheduled_at from gatherings where id = $3) as t,
            (select count(*)::int from business_reservations where offer_id = $1 and status = 'confirmed') as booked`, [o.offer, o.req, o.g])).rows[0];

  for (let i = 1; i <= ROUNDS; i += 1) {
    console.log(`round ${i}`);
    let o = await setup(admin, host, partner);
    let r = await race(host, accept(o.offer), moveTime(o.g));
    let s = await state(o);
    check(!r.firstErr && !r.second.ok && r.second.hint === 'gathering_time_booked' && r.waited >= HOLD_MS - 50,
      `1 accept then reschedule: reschedule waited ${r.waited} ms, then refused (${r.second.hint ?? r.second.error ?? 'saved'})`);
    check(s.offer === 'accepted' && s.booked === 1 && +s.t === +o.t, '1 booking stands, time unchanged');
    await cleanup(admin, o);

    o = await setup(admin, host, partner);
    r = await race(host, moveTime(o.g), accept(o.offer));
    s = await state(o);
    check(r.firstErr?.hint === 'gathering_request_has_replies' && r.second.ok,
      `2 reschedule then accept: reschedule refused (${r.firstErr?.hint ?? 'saved!'}), then booked (${r.second.error ?? 'ok'})`);
    check(s.offer === 'accepted' && s.booked === 1 && +s.t === +o.t, '2 a replied request keeps the time; booking made at it');
    await cleanup(admin, o);

    o = await setup(admin, host, partner);
    r = await race(host, accept(o.offer), cancelG(o.g));
    s = await state(o);
    check(!r.firstErr && r.second.ok && r.waited >= HOLD_MS - 50, `3 accept then cancel_gathering: cancel waited ${r.waited} ms, no deadlock (${r.second.error ?? 'ok'})`);
    check(s.t === null && s.offer === 'cancelled' && s.booked === 0, `3 gathering gone, fresh booking cancelled with it (offer ${s.offer})`);
    await cleanup(admin, o);

    o = await setup(admin, host, partner);
    r = await race(host, cancelG(o.g), accept(o.offer));
    s = await state(o);
    check(!r.firstErr && !r.second.ok && r.waited >= HOLD_MS - 50, `4 cancel_gathering then accept: accept waited ${r.waited} ms, then refused (${r.second.error ?? 'booked!'})`);
    check(s.booked === 0 && s.offer !== 'accepted', `4 nothing booked (offer ${s.offer}, request ${s.request})`);
    await cleanup(admin, o);
  }
  await admin.end();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nreschedule-accept-concurrency: all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
