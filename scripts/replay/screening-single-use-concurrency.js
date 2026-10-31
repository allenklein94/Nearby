#!/usr/bin/env node
// Migration 20270372 (offer safety) under real concurrency, on the LOCAL replay database only (NEARBY_LOCAL_DB_URL; refuses
// anything else). One screening result may be used by ONE write. Two sessions of the same business owner (role
// authenticated, real JWT claims) send the same screened reply at the same moment, with ONE
// matching screening result between them; the first holds its transaction open so the other is really concurrent.
//   Expected every round: exactly one reply lands, the other is refused at once (hint screening_required; the locked result
//   is skipped, never waited on, never used twice), the result is consumed once. Then the first rolls back: its result is
//   free again, and a third send uses it.
// Each round's rows are deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/screening-single-use-concurrency.js
// (Both sessions send to the same request: the request is part of the screened content, so one result can only ever cover
// one request's reply.)
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');

const ROUNDS = 10;
const HOLD_MS = 500;
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = (sub) => `select set_config('request.jwt.claims', $$${JSON.stringify({ sub, role: 'authenticated' })}$$, true)`;
const WORDS = 'Replay single-use reply';

async function request(admin, partner, customer) {
  const { rows: [{ id }] } = await admin.query(
    `insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category, date)
     select $1, 'replay single use', latitude, longitude, now() + interval '1 day', 2, 'Coffee', current_date from brand_partners where id = $2
     returning id`, [customer, partner]);
  await admin.query(`insert into business_request_offers (request_id, partner_id) values ($1, $2)`, [id, partner]);
  return id;
}
const send = (req) => `select submit_business_offer(request_id_param => '${req}', offer_type_param => 'standard', offer_description_param => '${WORDS}')`;

(async () => {
  const admin = await connect();
  if (!(await admin.query(`select to_regprocedure('private.require_business_screening(uuid,text,uuid,jsonb)') is not null as y`)).rows[0].y) {
    console.error('20270372 is not installed on this database.');
    process.exit(2);
  }
  const [{ owner, partner }] = (await admin.query(
    `select id as owner, managed_partner_id as partner from profiles where managed_partner_id is not null limit 1`)).rows;
  const [{ customer }] = (await admin.query(`select id as customer from profiles where managed_partner_id is null order by created_at limit 1`)).rows;

  for (let i = 1; i <= ROUNDS; i += 1) {
    console.log(`round ${i}`);
    const reqs = [await request(admin, partner, customer)];
    const { rows: [{ id: scr }] } = await admin.query(
      `insert into business_content_screening_results (partner_id, target_type, submitted_by, content_snapshot, risk_tier, model_reasoning)
       values ($1, 'offer_response', $2, private.screening_content_offer_response($3, $4, null, '{}', null, null, null, null, null), 'low', 'replay single use')
       returning id`, [partner, owner, reqs[0], WORDS]);
    const a = await connect();
    const b = await connect();
    for (const c of [a, b]) { await c.query(`begin; ${claims(owner)}`); await c.query('set local role authenticated'); }
    let aErr = null;
    try { await a.query(send(reqs[0])); } catch (e) { aErr = e; }
    const t0 = Date.now();
    // the same reply: only one screening result exists and A holds it
    const bRes = await b.query(send(reqs[0])).then(() => ({ ok: true }), (e) => ({ ok: false, hint: e.hint, error: e.message }));
    const waited = Date.now() - t0;
    await sleep(HOLD_MS);
    check(!aErr, `A landed (${aErr?.message ?? 'ok'})`);
    check(!bRes.ok && bRes.hint === 'screening_required', `B refused (${bRes.hint ?? bRes.error ?? 'landed!'})`);
    check(waited < HOLD_MS, `B was answered at once (${waited} ms), never waited on A's lock`);
    await b.query('rollback');
    await a.query('rollback');
    const { rows: [{ consumed }] } = await admin.query(`select consumed_at is not null as consumed from business_content_screening_results where id = $1`, [scr]);
    check(!consumed, 'A rolled back: the result is unused again');
    const c = await connect();
    await c.query(`begin; ${claims(owner)}`); await c.query('set local role authenticated');
    const cRes = await c.query(send(reqs[0])).then(() => ({ ok: true }), (e) => ({ ok: false, error: e.message }));
    await c.query('commit');
    const { rows: [{ consumed: after }] } = await admin.query(`select consumed_at is not null as consumed from business_content_screening_results where id = $1`, [scr]);
    check(cRes.ok && after, `a later send used it once (${cRes.error ?? 'ok'})`);
    await a.end(); await b.end(); await c.end();
    await admin.query(`delete from business_request_offers where request_id = any($1)`, [reqs]);
    await admin.query(`delete from business_requests where id = any($1)`, [reqs]);
    await admin.query(`delete from business_content_screening_results where id = $1`, [scr]);
  }
  await admin.end();
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nscreening-single-use-concurrency: all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
