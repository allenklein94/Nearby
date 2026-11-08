#!/usr/bin/env node
// Migration 20270405 under real concurrency, LOCAL replay database only. Each deletion runs in its own session, as delete-account does (profile, then
// auth user, separate transactions in the function; together here so a lost race shows as an error, not a half-state).
//   1. The organizer and another participant delete at the same moment, 8 rounds: the plan always ends, nobody takes it over, the booking is gone, the
//      third person's request is open again, no deadlock.
//   2. The organizer deletes while the last participant confirms the offer, 8 rounds: either order ends with no plan, no reservation left, and the third person's request open.
//   2b. The organizer deletes while a payment on their booking is captured, the way the webhook writes it, 8 rounds, both orders: the deletion always goes through,
//      the charge is never lost, and exactly one exception owes the refund.
//   3. A customer deletes while the Stripe webhook marks their payment captured, 8 rounds: the money record survives with the captured status, no person on it.
// Row cleanup: everything it creates is deleted afterwards.
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) { console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.'); process.exit(2); }
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const crypto = require('crypto');

let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
const connect = async () => { const c = new Client({ connectionString: url }); await c.connect(); return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const session = async (fn) => {
  const c = await connect();
  try { await c.query('begin'); const r = await fn(c); await sleep(120); await c.query('commit'); return { ok: true, r }; }
  catch (e) { await c.query('rollback').catch(() => {}); return { ok: false, error: e.message, code: e.code }; }
  finally { await c.end(); }
};
const asUser = (c, id) => c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: 'authenticated' })]);
const deleteAccount = (id) => session(async (c) => {
  await c.query('delete from public.profiles where id = $1', [id]);
  await c.query('delete from auth.users where id = $1', [id]);
});

(async () => {
  const db = await connect();
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const made = [];
  const person = async () => {
    const id = crypto.randomUUID();
    made.push(id);
    await q(`insert into auth.users (id, email, phone, phone_confirmed_at, aud, role, instance_id, created_at, updated_at, last_sign_in_at)
             values ($1, $2, $3, now(), 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now() - interval '30 days', now(), now())`,
      [id, `conc-${id}@local.invalid`, `1561${crypto.randomInt(1000000, 9999999)}`]);
    await q(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden, intent_visibility)
             values ($1, 'Concurrency Person', date '1995-03-01', now() - interval '30 days', now(), 'America/New_York', true, false, 'friends')
             on conflict (id) do update set display_name = 'Concurrency Person', intent_visibility = 'friends', photo_verified = true`, [id]);
    return id;
  };
  const claim = (id) => q(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: id, role: 'authenticated' })]);
  const friends = (a, b) => q(`insert into friendships (user_a, user_b, status, requested_by) values ($1, $2, 'accepted', $1) on conflict do nothing`, [a, b]);
  const ask = async (id) => {
    await claim(id);
    const [{ r }] = await q(`select create_business_request('conc del', 40.1, -75.1, 'Coffee', 1, null, 40, null, null, null, 15, null) r`);
    return r.requestId;
  };
  const owner = await person();
  const [{ id: partner }] = await q(`insert into brand_partners (name, active, latitude, longitude) values ('Conc Coffee', true, 40.0, -75.0) returning id`);

  const bookedPlan = async (book) => {
    const a = await person(); const b = await person(); const c = await person();
    await friends(a, b); await friends(a, c);
    const ra = await ask(a); const rb = await ask(b); const rc = await ask(c);
    await claim(a);
    const [{ p }] = await q('select propose_group_plan($1, $2::uuid[]) p', [ra, [rb, rc]]);
    await q('select set_group_plan_budget($1, 40)', [p]);
    await claim(b); await q('select respond_to_group_plan($1, true)', [p]);
    await q(`update group_plan_participants set responded_at = now() - interval '2 hours' where proposal_id = $1 and user_id = $2`, [p, b]);
    await claim(c); await q('select respond_to_group_plan($1, true)', [p]);
    await claim(a); await q('select confirm_group_plan($1)', [p]);
    const [{ req }] = await q('select resulting_request_id req from group_plan_proposals where id = $1', [p]);
    const [{ offer }] = await q(`insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description) values ($1, $2, 'offered', 'standard', 'Yes')
      on conflict (request_id, partner_id) do update set status = 'offered', offer_type = 'standard', offer_description = 'Yes', valid_until = null returning id offer`, [req, partner]);
    if (book >= 1) { await claim(a); await q('select confirm_group_plan_offer($1, $2)', [p, offer]); }
    if (book >= 2) { await claim(b); await q('select confirm_group_plan_offer($1, $2)', [p, offer]); }
    if (book >= 3) { await claim(c); await q('select confirm_group_plan_offer($1, $2)', [p, offer]); }
    await q(`select set_config('request.jwt.claims', '', false)`);
    return { a, b, c, p, req, offer };
  };

  console.log('1. the organizer and the next in line delete at once');
  let wrong = []; let refused = 0;
  for (let i = 0; i < 8; i += 1) {
    const g = await bookedPlan(3);
    const [x, y] = await Promise.all([deleteAccount(g.a), deleteAccount(g.b)]);
    for (const r of [x, y]) if (!r.ok) { refused += 1; wrong.push(r.error); }
    if (!x.ok) await deleteAccount(g.a);
    if (!y.ok) await deleteAccount(g.b);
    const [row] = await q(`select (select count(*)::int from group_plan_proposals where id = $1) plans, (select count(*)::int from business_reservations where offer_id = $2) res,
      (select count(*)::int from business_requests where id = $3) shared, (select status from business_requests where requester_id = $4 and status <> 'cancelled' and id <> $3 order by created_at limit 1) third`, [g.p, g.offer, g.req, g.c]);
    if (row.plans !== 0 || row.res !== 0 || row.shared !== 0 || row.third !== 'open') wrong.push(JSON.stringify(row));
  }
  check(wrong.length === 0, `8 rounds: the plan ends, nobody takes it over, the third person's request is open, nobody refused (${refused} retries) ${wrong.slice(0, 3).join(' | ')}`);

  console.log('2. the organizer deletes while the last participant confirms');
  wrong = []; const orders = { booked: 0, notBooked: 0 };
  for (let i = 0; i < 8; i += 1) {
    const g = await bookedPlan(2);
    const [x, y] = await Promise.all([
      deleteAccount(g.a),
      // odd rounds start late, so the deletion gets there first; both orders must be seen
      session(async (c) => { if (i % 2) await sleep(40); await asUser(c, g.c); await c.query('select confirm_group_plan_offer($1, $2)', [g.p, g.offer]); }),
    ]);
    if (!x.ok) wrong.push(`deletion: ${x.error}`);
    const [row] = await q(`select (select count(*)::int from group_plan_proposals where id = $1) plans, (select count(*)::int from business_reservations where offer_id = $2) res,
      (select status from business_requests where requester_id = $3 and id <> $4 order by created_at limit 1) third`, [g.p, g.offer, g.c, g.req]);
    if (row.plans !== 0 || row.res !== 0 || row.third !== 'open') wrong.push(JSON.stringify(row));
    if (y.ok) orders.booked += 1; else orders.notBooked += 1;
  }
  check(wrong.length === 0, `8 rounds: no plan, no reservation, the third person's request open (confirm first ${orders.booked}, deletion first ${orders.notBooked}) ${wrong.slice(0, 3).join(' | ')}`);

  console.log('2b. the organizer deletes while a payment on the booking is captured');
  wrong = []; const payOrders = { paid_booking_ended: 0, captured_after_cancellation: 0 };
  for (let i = 0; i < 8; i += 1) {
    const g = await bookedPlan(3);
    const pi = `pi_conc_${crypto.randomUUID()}`;
    const [{ id: pay }] = await q(`insert into business_payments (reservation_id, status, amount, currency, payer_id, provider, stripe_payment_intent_id)
      select r.id, 'pending', 25, 'usd', $1, 'stripe', $2 from business_reservations r where r.offer_id = $3 returning id`, [g.a, pi, g.offer]);
    const [x, y] = await Promise.all([
      deleteAccount(g.a),
      // odd rounds start late, so the deletion gets there first
      session(async (c) => { if (i % 2) await sleep(40); await c.query(`update business_payments set status = 'captured', stripe_charge_id = 'ch_conc' where stripe_payment_intent_id = $1`, [pi]); }),
    ]);
    if (!x.ok) wrong.push(`deletion: ${x.error}`);
    if (!y.ok) wrong.push(`capture: ${y.error}`);
    const [row] = await q(`select (select count(*)::int from profiles where id = $1) person, (select count(*)::int from group_plan_proposals where id = $2) plans, (select count(*)::int from business_reservations where offer_id = $3) res,
      (select status from business_payments where id = $4) pay, (select payer_id from business_payments where id = $4) payer`, [g.a, g.p, g.offer, pay]);
    const open = await q(`select kind from private.payment_exceptions where payment_id = $1 and status = 'open'`, [pay]);
    if (row.person !== 0 || row.plans !== 0 || row.res !== 0 || row.pay !== 'captured' || row.payer) wrong.push(JSON.stringify(row));
    if (open.length !== 1) wrong.push(`exceptions: ${JSON.stringify(open)}`); else payOrders[open[0].kind] += 1;
  }
  check(wrong.length === 0, `8 rounds: deleted, charge kept, exactly one exception (paid first ${payOrders.paid_booking_ended}, late ${payOrders.captured_after_cancellation}) ${wrong.slice(0, 3).join(' | ')}`);
  check(payOrders.paid_booking_ended > 0 && payOrders.captured_after_cancellation > 0, 'both orders were really seen');

  console.log('3. a customer deletes while the webhook captures');
  wrong = [];
  for (let i = 0; i < 8; i += 1) {
    const u = await person();
    const req = await ask(u);
    const [{ offer }] = await q(`insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description) values ($1, $2, 'offered', 'standard', 'Yes')
      on conflict (request_id, partner_id) do update set status = 'offered', offer_type = 'standard', offer_description = 'Yes', valid_until = null returning id offer`, [req, partner]);
    await claim(u); await q('select accept_business_offer($1)', [offer]);
    await q(`select set_config('request.jwt.claims', '', false)`);
    const pi = `pi_conc_${crypto.randomUUID()}`;
    const [{ id: pay }] = await q(`update business_payments p set status = 'pending', stripe_payment_intent_id = $1 from business_reservations r where r.id = p.reservation_id and r.offer_id = $2 returning p.id`, [pi, offer]);
    const [x, y] = await Promise.all([
      deleteAccount(u),
      session(async (c) => { await c.query(`update business_payments set status = 'captured', stripe_charge_id = 'ch_conc' where stripe_payment_intent_id = $1`, [pi]); }),
    ]);
    if (!x.ok || !y.ok) wrong.push(`${x.error || ''} ${y.error || ''}`);
    const [row] = await q('select status, payer_id, reservation_id from business_payments where id = $1', [pay]);
    if (!row || row.status !== 'captured' || row.payer_id || row.reservation_id) wrong.push(JSON.stringify(row || 'payment gone'));
  }
  check(wrong.length === 0, `8 rounds: the money record survives, captured, with no person on it ${wrong.slice(0, 3).join(' | ')}`);

  for (const id of made) { await q('delete from public.profiles where id = $1', [id]).catch(() => {}); await q('delete from auth.users where id = $1', [id]).catch(() => {}); }
  await q(`delete from business_payments where stripe_payment_intent_id like 'pi_conc_%'`);
  await q(`delete from business_request_offers where partner_id = $1`, [partner]);
  await q(`delete from brand_partners where id = $1`, [partner]);
  await q(`delete from cancellation_events where entity_type = 'group_plan' and cancelled_by is null`);
  await db.end();
  console.log(failures ? `FAILED: ${failures}` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
