#!/usr/bin/env node
// 20270430 under real concurrency, on the LOCAL replay database only (NEARBY_LOCAL_DB_URL; refuses anything else).
// A journey runs in one transaction, so it cannot race. Here two sessions call at the same moment, each holding its
// transaction open after the call so the other really waits on the offer's row lock; the start order alternates.
//   A. business "Confirm visit" vs business "Didn't show up" on the same booking: exactly one wins; never a confirmed
//      visit AND a no-show; a no-show win leaves visit_confirmed_at null; a confirm win leaves no no-show row.
//   B. two "Confirm visit" calls (two devices / a double tap): both succeed, ONE visit_confirmed_at, ONE OFFER_REDEEMED.
//   C. the customer's "Mark as done" vs the business's "Confirm visit": both succeed (different facts), status
//      completed once, both timestamps set, exactly one OFFER_REDEEMED (the business's).
// Rows are deleted afterwards (people from scripts/replay/concurrency-people.js seed).
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/visit-confirmation-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');

const ROUNDS = 10;
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const claims = (sub) => `select set_config('request.jwt.claims', $$${JSON.stringify({ sub, role: 'authenticated' })}$$, true)`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function attempt(c, sub, sql, args) {
  try {
    await c.query('begin');
    await c.query(claims(sub));
    const { rows } = await c.query(sql, args);
    await c.query('select pg_sleep(0.2)'); // hold the row lock while the other waits
    await c.query('commit');
    return { ok: true, value: rows[0] ? Object.values(rows[0])[0] : null };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    return { ok: false, error: e.message };
  }
}

const CONFIRM = 'select complete_business_reservation($1)';
const NO_SHOW = 'select mark_business_no_show($1)';

(async () => {
  const admin = await connect();
  const [{ owner, partner }] = (await admin.query(
    `select p.id as owner, p.managed_partner_id as partner from profiles p join brand_partners b on b.id = p.managed_partner_id where b.latitude is not null limit 1`)).rows;
  const [{ id: customer }] = (await admin.query(
    `select id from profiles where managed_partner_id is null order by created_at limit 1`)).rows;

  // A booked visit two days ago (date only: over everywhere), accepted through the real function.
  async function booking() {
    const { rows: [{ id: req }] } = await admin.query(
      `insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, status)
       values ($1, 'visit confirmation concurrency', 26.36, -80.08, now() + interval '1 day', 2, 'Coffee', 'open') returning id`, [customer]);
    const { rows: [{ id: offer }] } = await admin.query(
      `insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description, responded_at)
       values ($1, $2, 'offered', 'standard', 'Coffee for two', now()) returning id`, [req, partner]);
    await admin.query('begin');
    await admin.query(claims(customer));
    await admin.query('select accept_business_offer($1)', [offer]);
    await admin.query('commit');
    await admin.query(`update business_requests set date = current_date - 2, time_window_start = null, gathering_id = null where id = $1`, [req]);
    return { req, offer };
  }
  async function state(offer) {
    return (await admin.query(
      `select o.status, o.visit_confirmed_at, o.customer_done_at,
              (select count(*)::int from business_visit_no_shows n where n.offer_id = o.id) as no_shows,
              (select count(*)::int from domain_events e where e.type = 'OFFER_REDEEMED' and e.object_id = o.id) as events
       from business_request_offers o where o.id = $1`, [offer])).rows[0];
  }
  async function cleanup({ req, offer }) {
    await admin.query(`delete from business_visit_no_shows where offer_id = $1`, [offer]);
    await admin.query(`delete from domain_events where object_id = $1`, [offer]);
    await admin.query(`delete from business_payments where reservation_id in (select id from business_reservations where offer_id = $1)`, [offer]);
    await admin.query(`delete from business_reservations where offer_id = $1`, [offer]);
    await admin.query(`delete from plans where resulting_business_request_id = $1`, [req]);
    await admin.query(`delete from business_request_offers where id = $1`, [offer]);
    await admin.query(`delete from business_requests where id = $1`, [req]);
  }
  async function race(firstSub, firstSql, secondSub, secondSql, offer, firstStarts) {
    const a = await connect();
    const b = await connect();
    const one = () => attempt(a, firstSub, firstSql, [offer]);
    const two = () => attempt(b, secondSub, secondSql, [offer]);
    const out = firstStarts ? await Promise.all([one(), sleep(5).then(two)]) : await Promise.all([sleep(5).then(one), two()]);
    await a.end();
    await b.end();
    return out;
  }

  const tally = { confirm: 0, noShow: 0 };
  console.log('A. Confirm visit vs Didn\'t show up');
  for (let i = 0; i < ROUNDS; i += 1) {
    const bk = await booking();
    const [c, n] = await race(owner, CONFIRM, owner, NO_SHOW, bk.offer, i % 2 === 0);
    const s = await state(bk.offer);
    console.log(`round ${i + 1} (${i % 2 === 0 ? 'confirm' : 'no-show'} started first): confirm ${c.ok ? 'won' : 'refused'}, no-show ${n.ok ? 'won' : 'refused'}`);
    check(c.ok !== n.ok, 'exactly one of the two succeeded');
    check(!(s.visit_confirmed_at && s.no_shows > 0), `never both (confirmed ${!!s.visit_confirmed_at}, no-shows ${s.no_shows})`);
    if (c.ok) { tally.confirm += 1; check(s.no_shows === 0 && s.events === 1 && s.status === 'completed', `confirmed: completed, 1 event, no no-show (events ${s.events})`); }
    if (n.ok) { tally.noShow += 1; check(s.visit_confirmed_at == null && s.events === 0 && s.no_shows === 1, `no-show: not confirmed, no event, one no-show row (status ${s.status})`); }
    await cleanup(bk);
  }

  console.log('B. two Confirm visit calls at once');
  for (let i = 0; i < ROUNDS / 2; i += 1) {
    const bk = await booking();
    const [x, y] = await race(owner, CONFIRM, owner, CONFIRM, bk.offer, i % 2 === 0);
    const s = await state(bk.offer);
    check(x.ok && y.ok, `both succeeded (${x.error ?? ''}${y.error ?? ''})`);
    check([x.value, y.value].filter((v) => v?.alreadyCompleted).length === 1, 'exactly one answered alreadyCompleted');
    check(s.visit_confirmed_at != null && s.events === 1, `one confirmation, one OFFER_REDEEMED (events ${s.events})`);
    await cleanup(bk);
  }

  console.log('C. customer Mark as done vs business Confirm visit');
  for (let i = 0; i < ROUNDS / 2; i += 1) {
    const bk = await booking();
    const [m, c] = await race(customer, CONFIRM, owner, CONFIRM, bk.offer, i % 2 === 0);
    const s = await state(bk.offer);
    check(m.ok && c.ok, `both succeeded (${m.error ?? ''}${c.error ?? ''})`);
    check(m.value?.personal === true && c.value?.confirmed === true, 'customer = personal mark, business = confirmation');
    check(s.status === 'completed' && s.customer_done_at != null && s.visit_confirmed_at != null && s.events === 1,
      `completed once, both facts, one OFFER_REDEEMED (events ${s.events})`);
    await cleanup(bk);
  }

  await admin.end();
  console.log(`\nconfirm won ${tally.confirm}, no-show won ${tally.noShow}`);
  console.log(failures ? `${failures} check(s) FAILED` : 'visit-confirmation-concurrency: all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
