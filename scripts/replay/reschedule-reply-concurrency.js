#!/usr/bin/env node
// Migration 20270344 (idea "394") under real concurrency, on the LOCAL replay database only (NEARBY_LOCAL_DB_URL; refuses anything
// else). A journey runs in one transaction and cannot race, so here two separate sessions really overlap, each holding its
// transaction open so the other waits on the lock. The host's reschedule is the app's own direct UPDATE (role authenticated).
//   1. a business sends an offer first, the host reschedules second: the reschedule waits, then is refused
//      (gathering_request_has_replies); time, request and offer unchanged.
//   2. reschedule first, offer second: the offer waits, then lands on the request as it now reads (day/time/deadline already
//      moved); no deadlock.
//   3. a decline first, reschedule second: the reschedule waits for the decline, then is refused.
//   4. an availability posting's automatic reply first, reschedule second: the reschedule waits, then is refused.
//   5. reschedule first, availability posting second: the posting waits, then matches the moved request.
// Each case runs ROUNDS times; every row is deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/reschedule-reply-concurrency.js
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
  await admin.query(`update profiles set gatherings_created_today = 0 where id = $1`, [host]);
  await admin.query(`update business_requests set status = 'cancelled' where requester_id = $1 and status = 'open'`, [host]);
  const { rows: [{ lat, lng }] } = await admin.query(`select latitude as lat, longitude as lng from brand_partners where id = $1`, [partner]);
  const { rows: [{ id: g }] } = await admin.query(
    `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
     values ($1, 'Replay reply race', now() + interval '2 days', $2, $3, 'Coffee', 'replay', 10, 'everyone', true) returning id`, [host, lat, lng]);
  const { rows: [{ id: req }] } = await admin.query(
    `insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, gathering_id, date, time_window_start)
     select $1, 'replay reply race', $3, $4, g.scheduled_at, 4, 'Coffee', g.id, (g.scheduled_at at time zone 'America/New_York')::date,
            (g.scheduled_at at time zone 'America/New_York')::time
     from gatherings g where g.id = $2 returning id`, [host, g, lat, lng]);
  await admin.query(`insert into business_request_offers (request_id, partner_id) values ($1, $2)`, [req, partner]);
  const { rows: [{ t }] } = await admin.query(`select scheduled_at as t from gatherings where id = $1`, [g]);
  return { g, req, t };
}

async function cleanup(admin, { g, req }, partner) {
  await admin.query(`delete from business_request_offers where request_id = $1`, [req]);
  await admin.query(`delete from business_availability where partner_id = $1 and title = 'Replay race slot'`, [partner]);
  await admin.query(`delete from plans where resulting_business_request_id = $1 or resulting_gathering_id = $2`, [req, g]).catch(() => {});
  await admin.query(`delete from business_requests where id = $1`, [req]).catch(() => {});
  await admin.query(`delete from gatherings where id = $1`, [g]);
}

// first = { sql, sub } runs and holds its transaction HOLD_MS; second fires once first's statement returned, and must wait.
async function race(first, second) {
  const a = await connect();
  const b = await connect();
  const run = async (c, step) => {
    await c.query(`begin; ${claims(step.sub)}`);
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

(async () => {
  const admin = await connect();
  const [{ owner, partner }] = (await admin.query(
    `select id as owner, managed_partner_id as partner from profiles where managed_partner_id is not null limit 1`)).rows;
  const [{ host }] = (await admin.query(`select id as host from profiles where managed_partner_id is null order by created_at limit 1`)).rows;
  await admin.query(`update profiles set timezone = 'America/New_York' where id = $1`, [host]);

  const moveTime = (o) => ({ sql: `update gatherings set scheduled_at = scheduled_at + interval '1 hour' where id = $1`, args: [o.g], sub: host, asClient: true });
  const offer = (o) => ({ sql: `select submit_business_offer(request_id_param => $1, offer_type_param => 'standard', offer_description_param => 'Replay race offer')`, args: [o.req], sub: owner, asClient: true });
  const decline = (o) => ({ sql: `select decline_business_offer($1, 'too_busy_right_now')`, args: [o.req], sub: owner, asClient: true });
  const post = () => ({ sql: `select post_business_availability('Coffee', 'Replay race slot', null, 'standard', null, 10, now() - interval '1 hour', now() + interval '5 days')`, args: [], sub: owner, asClient: true });
  const state = async (o) => (await admin.query(
    `select g.scheduled_at as t, r.expires_at as expires, r.date = (g.scheduled_at at time zone 'America/New_York')::date as date_follows,
            r.time_window_start = (g.scheduled_at at time zone 'America/New_York')::time as time_follows,
            (select status from business_request_offers where request_id = r.id and partner_id = $3) as offer
     from gatherings g join business_requests r on r.id = $2 where g.id = $1`, [o.g, o.req, partner])).rows[0];
  const refusedAfterWait = (r) => !r.firstErr && !r.second.ok && r.second.hint === 'gathering_request_has_replies' && r.waited >= HOLD_MS - 50;
  const landedAfterWait = (r) => !r.firstErr && r.second.ok && r.waited >= HOLD_MS - 50;

  for (let i = 1; i <= ROUNDS; i += 1) {
    console.log(`round ${i}`);
    let o = await setup(admin, host, partner);
    let r = await race(offer(o), moveTime(o));
    let s = await state(o);
    check(refusedAfterWait(r), `1 offer then reschedule: reschedule waited ${r.waited} ms, then refused (${r.second.hint ?? r.second.error ?? 'saved!'})`);
    check(+s.t === +o.t && +s.expires === +o.t && s.date_follows && s.time_follows && s.offer === 'offered', '1 time, request and offer unchanged');
    await cleanup(admin, o, partner);

    o = await setup(admin, host, partner);
    r = await race(moveTime(o), offer(o));
    s = await state(o);
    check(landedAfterWait(r), `2 reschedule then offer: offer waited ${r.waited} ms, then landed (${r.second.error ?? r.firstErr?.message ?? 'ok'})`);
    check(+s.t === +o.t + 3600e3 && +s.expires === +s.t && s.date_follows && s.time_follows && s.offer === 'offered',
      '2 the request had already moved (day, time, deadline) when the offer landed');
    await cleanup(admin, o, partner);

    o = await setup(admin, host, partner);
    r = await race(decline(o), moveTime(o));
    s = await state(o);
    check(refusedAfterWait(r), `3 decline then reschedule: reschedule waited ${r.waited} ms, then refused (${r.second.hint ?? r.second.error ?? 'saved!'})`);
    check(+s.t === +o.t && s.offer === 'declined', '3 time unchanged, decline kept');
    await cleanup(admin, o, partner);

    o = await setup(admin, host, partner);
    r = await race(post(), moveTime(o));
    s = await state(o);
    check(refusedAfterWait(r), `4 availability reply then reschedule: reschedule waited ${r.waited} ms, then refused (${r.second.hint ?? r.second.error ?? 'saved!'})`);
    check(+s.t === +o.t && s.offer === 'offered', '4 time unchanged, automatic reply kept');
    await cleanup(admin, o, partner);

    o = await setup(admin, host, partner);
    r = await race(moveTime(o), post());
    s = await state(o);
    check(landedAfterWait(r), `5 reschedule then availability: posting waited ${r.waited} ms, then matched (${r.second.error ?? r.firstErr?.message ?? 'ok'})`);
    check(+s.t === +o.t + 3600e3 && +s.expires === +s.t && s.date_follows && s.offer === 'offered', '5 the request had already moved when the automatic reply landed');
    await cleanup(admin, o, partner);
  }
  await admin.end();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nreschedule-reply-concurrency: all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
