#!/usr/bin/env node
// Item 118 under real concurrency, on the LOCAL replay database only (NEARBY_LOCAL_DB_URL; refuses anything else).
// A journey runs in one transaction, so it cannot race. Here, each round, the business revises its offer ($60 -> $50 per
// person) while the customer accepts the $60 card they saw (seen_revision 0), in two separate sessions at the same moment,
// each holding its transaction open after the call so the other really waits on the row lock. The start order alternates.
// Checks per round: exactly one of the two succeeds; if the accept won, the booking (offer + payment row) carries $60 and
// the revision got "This offer is no longer open."; if the revision won, nothing is booked and the accept got "This offer
// just changed. Check the new terms."; never a booking at a price the accepter did not see. Rows are deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/offer-revision-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');

const ROUNDS = 20;
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const as = (c, sub) => c.query(`begin; select set_config('request.jwt.claims', $$${JSON.stringify({ sub, role: 'authenticated' })}$$, true)`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attempt(c, sql, args) {
  try {
    await c.query(sql, args);
    await c.query('select pg_sleep(0.2)'); // hold the row lock while the other waits
    await c.query('commit');
    return { ok: true };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    return { ok: false, error: e.message };
  }
}

(async () => {
  const admin = await connect();
  const [{ owner, partner }] = (await admin.query(
    `select id as owner, managed_partner_id as partner from profiles where managed_partner_id is not null limit 1`)).rows;
  const [{ id: customer }] = (await admin.query(
    `select id from profiles where managed_partner_id is null order by created_at limit 1`)).rows;
  const tally = { accept: 0, revise: 0 };
  for (let i = 0; i < ROUNDS; i += 1) {
    const { rows: [{ id: req }] } = await admin.query(
      `insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, status)
       values ($1, 'revision concurrency', 26.36, -80.08, now() + interval '1 day', 4, 'Restaurants', 'open') returning id`, [customer]);
    const { rows: [{ id: offer }] } = await admin.query(
      `insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description, offer_price, price_is_per_person, responded_at)
       values ($1, $2, 'offered', 'standard', 'Dinner for four', 60, true, now()) returning id`, [req, partner]);
    const biz = await connect();
    const cust = await connect();
    await as(biz, owner);
    await as(cust, customer);
    const reviseFirst = i % 2 === 0;
    const revise = () => attempt(biz, 'select revise_business_offer($1, 50, null, null, null)', [offer]);
    const accept = () => attempt(cust, 'select accept_business_offer($1, null, 0::smallint)', [offer]);
    const [r, a] = reviseFirst
      ? await Promise.all([revise(), sleep(5).then(accept)])
      : await Promise.all([sleep(5).then(revise), accept()]);
    const row = (await admin.query(
      `select o.status, o.offer_price::float as price, o.revision, bp.amount::float as paid
       from business_request_offers o left join business_reservations br on br.offer_id = o.id
       left join business_payments bp on bp.reservation_id = br.id where o.id = $1`, [offer])).rows[0];
    console.log(`round ${i + 1} (${reviseFirst ? 'revision' : 'accept'} started first): revise ${r.ok ? 'won' : 'refused'}, accept ${a.ok ? 'won' : 'refused'}`);
    check(r.ok !== a.ok, 'exactly one of the two succeeded');
    if (a.ok) {
      tally.accept += 1;
      check(row.status === 'accepted' && row.price === 60 && row.revision === 0 && row.paid === 60, `booked the $60 the customer saw (price ${row.price}, paid ${row.paid}, revision ${row.revision})`);
      check(r.error === 'This offer is no longer open.', `revision refused: "${r.error}"`);
    } else {
      tally.revise += 1;
      check(row.status === 'offered' && row.price === 50 && row.revision === 1 && row.paid == null, `nothing booked; offer now $50, revision 1 (status ${row.status})`);
      check(a.error === 'This offer just changed. Check the new terms.', `accept refused: "${a.error}"`);
    }
    await biz.end();
    await cust.end();
    await admin.query(`delete from business_payments where reservation_id in (select id from business_reservations where offer_id = $1)`, [offer]);
    await admin.query(`delete from business_reservations where offer_id = $1`, [offer]);
    await admin.query(`delete from business_request_offers where id = $1`, [offer]);
    await admin.query(`delete from business_requests where id = $1`, [req]);
  }
  await admin.end();
  console.log(`\naccept won ${tally.accept}, revision won ${tally.revise}`);
  console.log(failures ? `${failures} check(s) FAILED` : 'offer-revision-concurrency: all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
