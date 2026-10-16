#!/usr/bin/env node
// Item 116 under real concurrency, on the LOCAL replay database only (NEARBY_LOCAL_DB_URL; refuses anything else).
// One journey runs in one transaction, so it cannot race. Here N separate sessions call the app's own
// accept_business_offer at the same moment, each as its requester, each holding its transaction open after the call so
// the others really wait on the row lock; then the winners cancel at the same moment with cancel_business_reservation.
// Checks per round: never overbooked, exactly floor(capacity / party) bookings win, every loser gets the existing
// "This availability just filled up." and holds nothing, remaining = capacity - sum held, and the cancels give back
// exactly what was held (remaining = capacity, status back to 'active'). The rows are deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/booking-capacity-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');

const ROUNDS = [
  { capacity: 10, party: 3, sessions: 8 }, // 3 fit (9), 1 left over
  { capacity: 12, party: 4, sessions: 8 }, // exactly 3 fit, filled
  { capacity: 5, party: 6, sessions: 6 }, // none fit
  { capacity: 20, party: 1, sessions: 25 }, // 20 fit, filled
];

let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };

async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }

async function round({ capacity, party, sessions }) {
  console.log(`round: capacity ${capacity}, ${sessions} parties of ${party} accept at once`);
  const admin = await connect();
  const [{ owner, partner }] = (await admin.query(
    `select id as owner, managed_partner_id as partner from profiles where managed_partner_id is not null limit 1`)).rows;
  const people = (await admin.query(
    `select id from profiles where managed_partner_id is null order by created_at limit 5`)).rows.map((r) => r.id);
  const { rows: [{ id: av }] } = await admin.query(
    `insert into business_availability (partner_id, title, starts_at, ends_at, capacity, remaining_capacity, status)
     values ($1, 'Replay concurrency', now() + interval '2 hours', now() + interval '6 hours', $2, $2, 'active') returning id`,
    [partner, capacity]);
  const offers = [];
  for (let i = 0; i < sessions; i += 1) {
    const requester = people[i % people.length];
    const { rows: [{ id: req }] } = await admin.query(
      `insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category)
       values ($1, 'replay concurrency', 26.36, -80.08, now() + interval '1 day', $2, 'Coffee') returning id`, [requester, party]);
    const { rows: [{ id: offer }] } = await admin.query(
      `insert into business_request_offers (request_id, partner_id, availability_id, status, offer_type, offer_description)
       values ($1, $2, $3, 'offered', 'standard', 'Replay concurrency offer') returning id`, [req, partner, av]);
    offers.push({ offer, requester, req });
  }
  void owner;

  // every session opens its transaction and becomes its requester first, then all accept together
  const clients = await Promise.all(offers.map(connect));
  await Promise.all(clients.map((c, i) => c.query(
    `begin; select set_config('request.jwt.claims', $$${JSON.stringify({ sub: offers[i].requester, role: 'authenticated' })}$$, true)`)));
  const results = await Promise.all(clients.map(async (c, i) => {
    try {
      await c.query('select accept_business_offer($1)', [offers[i].offer]);
      await c.query('select pg_sleep(0.3)'); // hold the lock while the others wait
      await c.query('commit');
      return { ok: true };
    } catch (e) {
      await c.query('rollback').catch(() => {});
      return { ok: false, error: e.message };
    }
  }));
  const winners = results.map((r, i) => (r.ok ? i : -1)).filter((i) => i >= 0);
  const expectedWins = Math.min(sessions, Math.floor(capacity / party));
  const st = (await admin.query(`select remaining_capacity, status from business_availability where id = $1`, [av])).rows[0];
  const held = (await admin.query(
    `select coalesce(sum(capacity_held), 0)::int as held, count(*) filter (where status = 'accepted')::int as accepted,
            count(*) filter (where capacity_held is not null and status <> 'accepted')::int as losers_holding
     from business_request_offers where availability_id = $1`, [av])).rows[0];
  check(winners.length === expectedWins, `${winners.length} bookings won (expected ${expectedWins})`);
  check(held.held <= capacity, `never overbooked: ${held.held} people held of ${capacity}`);
  check(st.remaining_capacity === capacity - held.held, `remaining ${st.remaining_capacity} = ${capacity} - ${held.held}`);
  check(held.accepted === winners.length && held.losers_holding === 0, 'only the winners are accepted; losers hold nothing');
  check(results.filter((r) => !r.ok).every((r) => r.error === 'This availability just filled up.'),
    `every refusal is "This availability just filled up." (${[...new Set(results.filter((r) => !r.ok).map((r) => r.error))].join(' | ') || 'none'})`);
  check(st.status === (st.remaining_capacity === 0 ? 'filled' : 'active'), `status ${st.status}`);

  // the winners cancel at the same moment
  await Promise.all(winners.map((i) => clients[i].query(
    `begin; select set_config('request.jwt.claims', $$${JSON.stringify({ sub: offers[i].requester, role: 'authenticated' })}$$, true)`)));
  const cancels = await Promise.all(winners.map(async (i) => {
    try {
      await clients[i].query('select cancel_business_reservation($1)', [offers[i].offer]);
      await clients[i].query('select pg_sleep(0.2)');
      await clients[i].query('commit');
      return true;
    } catch (e) {
      await clients[i].query('rollback').catch(() => {});
      console.log(`    cancel error: ${e.message}`);
      return false;
    }
  }));
  const after = (await admin.query(`select remaining_capacity, status from business_availability where id = $1`, [av])).rows[0];
  check(cancels.every(Boolean), `${cancels.length} simultaneous cancels succeeded`);
  check(after.remaining_capacity === capacity && after.status === 'active',
    `after cancels: remaining ${after.remaining_capacity} of ${capacity}, status ${after.status}`);

  await Promise.all(clients.map((c) => c.end()));
  // clean up this round's rows (disposable replay database)
  await admin.query(`delete from business_request_offers where availability_id = $1`, [av]);
  await admin.query(`delete from business_requests where id = any($1::uuid[])`, [offers.map((o) => o.req)]);
  await admin.query(`delete from business_availability where id = $1`, [av]);
  await admin.end();
}

(async () => {
  for (const r of ROUNDS) await round(r);
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nbooking-capacity-concurrency: all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
