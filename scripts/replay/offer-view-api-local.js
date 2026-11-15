#!/usr/bin/env node
// Customer read receipts through a REAL PostgREST with real JWTs (owner, 2026-11-15; migration 20270422), on the LOCAL
// replay database only. The business that sent a reply tries every path to the customer's "opened it" time: its own
// offer row (select *, filters, counts), embeds, the receipts table directly, both business functions, the mark function,
// writes; through a second staff account, while ALSO an approved attendee of the gathering the request came from, and
// after the offer is booked (the attendee policy then also shows it the offer). The customer runs the exact query shapes
// of this branch (services/offerViewReceipts.js + offerArrivalSource.js) and of build 87 (main). Realtime: the receipts
// table must not be in the realtime publication and opening a reply must not touch the offer row (no UPDATE event).
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg NAME=<db container> node scripts/replay/offer-view-api-local.js
// EXPECT=open: run with 0422 rolled back; the business checks must then fail (proves the checks can fail).
const dbUrl = process.env.NEARBY_LOCAL_DB_URL;
const local = /^postgres:\/\/[^@]+@(localhost|127\.|172\.|10\.|192\.168\.)/;
if (!dbUrl || !local.test(dbUrl)) { console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.'); process.exit(2); }
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const { PostgrestClient } = require('@supabase/postgrest-js');

const DB = process.env.NAME || 'nearby-v435';
const REST = `${DB}-offerview-rest`;
const NET = process.env.REPLAY_NETWORK || 'nearby-replay-internal';
const IMAGE = process.env.POSTGREST_IMAGE || 'postgrest/postgrest:v13.0.7';
const SECRET = crypto.randomBytes(32).toString('hex');
const sh = (args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}`;
  return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
};
let failed = 0; let passed = 0;
const check = (name, ok, detail) => { if (ok) { passed += 1; console.log(`  ok  ${name}`); } else { failed += 1; console.log(`FAIL  ${name} ${detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)}`); } };
const NEW_LIVE = 'id, request_id, partner_id, status, viewed_at, offer_type, offer_title, offer_price, discount_pct, included_items, brand_partners(name), business_requests!inner(requester_id, status)';

(async () => {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  const R = crypto.randomUUID(); const BIZ = crypto.randomUUID(); const STAFF = crypto.randomUUID(); const OTHER = crypto.randomUUID(); const S = crypto.randomUUID();
  const P1 = crypto.randomUUID(); const P2 = crypto.randomUUID();
  const people = [R, BIZ, STAFF, OTHER, S];
  const open = process.env.EXPECT === 'open';
  let G; let REQ; let O;
  const clean = async () => {
    await db.query(`select set_config('request.jwt.claims', '', false)`);
    if (REQ) await db.query(`delete from business_requests where id = $1`, [REQ]);
    await db.query(`delete from gatherings where host_id = any($1::uuid[])`, [people]);
    await db.query(`update profiles set managed_partner_id = null where id = any($1::uuid[])`, [people]);
    await db.query(`delete from profiles where id = any($1::uuid[])`, [people]);
    await db.query(`delete from auth.users where id = any($1::uuid[])`, [people]);
    await db.query(`delete from brand_partners where id = any($1::uuid[])`, [[P1, P2]]);
  };
  try {
    sh(['exec', '-e', 'PGPASSWORD=postgres', DB, 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-c', `alter role authenticator with password 'postgres';`]);
    try { sh(['rm', '-f', REST]); } catch { /* none */ }
    sh(['run', '-d', '--name', REST, '--network', NET, '-e', `PGRST_DB_URI=postgres://authenticator:postgres@${DB}:5432/postgres`,
      '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${SECRET}`, IMAGE]);
    const ip = sh(['inspect', '-f', `{{(index .NetworkSettings.Networks "${NET}").IPAddress}}`, REST]).trim();
    const url = `http://${ip}:3000`;
    for (let i = 0; i < 60; i += 1) {
      try { const r = await fetch(`${url}/`, { signal: AbortSignal.timeout(1000) }); if (r.status < 500) break; } catch { /* starting */ }
      await new Promise((f) => setTimeout(f, 1000));
    }
    const as = (id) => new PostgrestClient(url, { headers: { Authorization: `Bearer ${jwt({ role: 'authenticated', sub: id })}` } });
    const anon = new PostgrestClient(url, { headers: { Authorization: `Bearer ${jwt({ role: 'anon' })}` } });

    // --- fixtures (service connection, deleted afterwards)
    await db.query(`select set_config('app.trusted_update', 'on', false)`);
    for (const id of people) {
      await db.query(`insert into auth.users (id, aud, role, email, phone, phone_confirmed_at, created_at) values ($1::uuid, 'authenticated', 'authenticated', $1::text || '@offerview.invalid', '1555' || lpad((('x0' || substr(md5($1::text), 1, 7))::bit(32)::int % 100000000)::text, 8, '0'), now(), now() - interval '30 days')`, [id]);
      await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden) values ($1, 'Offer View Test', date '1994-05-01', now() - interval '30 days', now(), 'America/New_York', true, false) on conflict (id) do update set display_name = 'Offer View Test'`, [id]);
    }
    for (const [p, n] of [[P1, 'View Test Cafe'], [P2, 'Other Test Cafe']]) {
      await db.query(`insert into brand_partners (id, name, active, latitude, longitude, address, category, subcategory, categories, max_group_size) values ($1, $2, true, 40, -75, '1 Test St', 'food_drink', 'Coffee', '{}', 40)`, [p, n]);
    }
    await db.query(`update profiles set managed_partner_id = $1 where id = any($2::uuid[])`, [P1, [BIZ, STAFF]]);
    await db.query(`update profiles set managed_partner_id = $1 where id = $2`, [P2, OTHER]);
    const claims = (id) => db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: id, role: 'authenticated' })]);
    await claims(R);
    G = (await db.query(`insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility) values ($1, 'Offer view API test', now() + interval '3 days', 40.0, -75.0, 'Coffee', 'j', 8, 'everyone') returning id`, [R])).rows[0].id;
    REQ = (await db.query(`select (create_business_request_for_gathering($1, 'Coffee for the group', 'Coffee', 20, 15, null, null, $2, null)->>'requestId')::uuid id`, [G, P1])).rows[0].id;
    await claims(BIZ);
    // 20270372 (combined trust tree): the offer needs the screening result screen-business-content would record; the same
    // low-risk stand-in the journey harness uses. Skipped where 0372 isn't installed.
    if ((await db.query(`select to_regprocedure('private.require_business_screening(uuid,text,uuid,jsonb)') is not null x`)).rows[0].x) {
      await db.query(`insert into business_content_screening_results (partner_id, target_type, target_id, submitted_by, content_snapshot, risk_tier, model_reasoning, source)
        values ($1, 'offer_response', null, $2, private.screening_content_offer_response($3::text, 'We can accommodate this as requested.', null, '{}', null, null, null, null, null), 'low', 'api check stand-in for screen-business-content', 'submission')`, [P1, BIZ, REQ]);
    }
    await db.query(`select submit_business_offer(request_id_param := $1, offer_type_param := 'standard', offer_description_param := 'We can accommodate this as requested.', offer_price_param := 12.5)`, [REQ]);
    O = (await db.query(`select id from business_request_offers where request_id = $1 and partner_id = $2`, [REQ, P1])).rows[0].id;
    // alternate relationship: the business owner is ALSO an approved attendee of the gathering the request came from
    await db.query(`select set_config('request.jwt.claims', '', false)`);
    await db.query(`insert into gathering_interest (gathering_id, user_id, status) values ($1, $2, 'approved')`, [G, BIZ]);
    check('fixtures: request + one offer', !!O, O);

    const C = as(R); const B = as(BIZ);
    const xmin = async () => (await db.query(`select xmin::text x from business_request_offers where id = $1`, [O])).rows[0].x;

    console.log('== customer, before opening the reply');
    let r = await C.from('business_offer_views').select('offer_id, business_request_offers!inner(business_requests!inner(requester_id))', { count: 'exact', head: true }).eq('business_request_offers.business_requests.requester_id', R);
    if (!open) check('hasOpenedAnyReply shape: no error, 0', !r.error && r.count === 0, r.error ?? r.count);
    r = await C.from('business_request_offers').select(NEW_LIVE).eq('status', 'offered').eq('business_requests.requester_id', R).eq('business_requests.status', 'open');
    check('fetchMyLiveReplies shape: the reply, not viewed', !r.error && r.data.length === 1 && r.data[0].viewed_at === null, r.error ?? r.data);

    console.log('== the business tries to mark it / write a receipt');
    r = await B.rpc('mark_business_offer_viewed', { offer_id_param: O });
    const afterBizMark = (await db.query(`select (select count(*)::int from business_request_offers where id = $1 and viewed_at is not null) + coalesce((select count(*)::int from business_offer_views where offer_id = $1), 0) n`, [O]).catch(async () => db.query(`select count(*)::int n from business_request_offers where id = $1 and viewed_at is not null`, [O]))).rows[0].n;
    check('business calling mark_business_offer_viewed records nothing', !r.error && afterBizMark === 0, r.error ?? afterBizMark);
    if (!open) {
      r = await B.from('business_offer_views').insert({ offer_id: O });
      check('business insert into receipts: refused', r.error?.code === '42501', r.error);
    }

    console.log('== customer opens the reply (the app\'s own call)');
    const before = await xmin();
    r = await C.rpc('mark_business_offer_viewed', { offer_id_param: O });
    check('mark: no error', !r.error, r.error);
    if (!open) check('opening the reply does not touch the offer row (no realtime UPDATE event)', (await xmin()) === before, { before, after: await xmin() });
    const pub = (await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('business_offer_views', 'business_request_offers') order by 1`)).rows.map((x) => x.tablename);
    if (!open) check('receipts table is not in the realtime publication (offers table is)', JSON.stringify(pub) === JSON.stringify(['business_request_offers']), pub);

    const businessSees = async (label, client) => {
      const leaks = [];
      let q = await client.from('business_request_offers').select('*').eq('id', O);
      if (q.error || q.data.length !== 1) leaks.push(['offer row not readable as expected', q.error ?? q.data.length]);
      else if (q.data[0].viewed_at !== null) leaks.push(['select * viewed_at', q.data[0].viewed_at]);
      q = await client.from('business_request_offers').select('id', { count: 'exact', head: true }).eq('partner_id', P1).not('viewed_at', 'is', null);
      if (q.error || q.count !== 0) leaks.push(['count where viewed_at not null', q.error ?? q.count]);
      q = await client.from('business_request_offers').select('id, business_offer_views(viewed_at)').eq('id', O);
      if (!q.error) { const v = q.data?.[0]?.business_offer_views; if (v && (Array.isArray(v) ? v.length : true)) leaks.push(['embed', v]); }
      q = await client.from('business_offer_views').select('*');
      if (!q.error && q.data.length) leaks.push(['receipts table', q.data]);
      q = await client.from('business_offer_views').select('*', { count: 'exact', head: true });
      if (!q.error && q.count) leaks.push(['receipts count', q.count]);
      q = await client.rpc('get_business_opportunities', { partner_id_param: P1 });
      const row = (q.data ?? []).find((e) => e.id === O);
      if (q.error || !row) leaks.push(['opportunities not readable', q.error]);
      else if (JSON.stringify(row).includes('viewed')) leaks.push(['opportunities', row.viewed_at]);
      q = await client.rpc('get_partner_offer_performance', { partner_id_param: P1 });
      if (q.error) leaks.push(['performance error', q.error]);
      else if ((q.data ?? []).some((p) => 'viewed_count' in p)) leaks.push(['performance viewed_count', q.data]);
      check(`${label}: no read receipt by any path`, leaks.length === 0, leaks);
    };
    console.log('== the business that sent the reply (owner, also an approved attendee), a second staff account');
    await businessSees('business owner + attendee', B);
    await businessSees('second staff account', as(STAFF));

    console.log('== customer after opening (this branch\'s shapes)');
    r = await C.from('business_offer_views').select('offer_id, business_request_offers!inner(business_requests!inner(requester_id))', { count: 'exact', head: true }).eq('business_request_offers.business_requests.requester_id', R);
    if (!open) check('hasOpenedAnyReply: 1 (first-reply wording now off)', !r.error && r.count === 1, r.error ?? r.count);
    r = await C.from('business_offer_views').select('offer_id, viewed_at').in('offer_id', [O]);
    if (!open) check('withViewReceipts: the customer reads their receipt', !r.error && r.data.length === 1 && !!r.data[0].viewed_at, r.error ?? r.data);
    r = await C.from('business_request_offers').select('*, brand_partners(name, logo_url, address, latitude, longitude, location_source), business_reservations(status, business_payments(status, amount, provider, failure_reason))').eq('request_id', REQ).order('created_at', { ascending: true });
    check('getBusinessRequestWithOffers shape: no error', !r.error && r.data.length === 1, r.error);

    console.log('== build 87 (main) customer shapes: still work, read "not viewed"');
    r = await C.from('business_request_offers').select('id, business_requests!inner(requester_id)', { count: 'exact', head: true }).not('viewed_at', 'is', null).eq('business_requests.requester_id', R);
    if (!open) check('build 87 seenAny query: no error, 0 (first-reply wording may show again on 87: known transition)', !r.error && r.count === 0, r.error ?? r.count);
    r = await C.from('business_request_offers').select(NEW_LIVE).eq('status', 'offered').eq('business_requests.requester_id', R).eq('business_requests.status', 'open');
    if (!open) check('build 87 fetchMyLiveReplies: no error, viewed_at null', !r.error && r.data.length === 1 && r.data[0].viewed_at === null, r.error ?? r.data);
    r = await C.from('business_request_offers').update({ viewed_at: new Date().toISOString() }).eq('id', O).select();
    check('customer direct update of viewed_at: changes nothing', (!r.error && r.data.length === 0) || !!r.error, r);

    console.log('== after the offer is booked (the attendee policy now also shows the business owner the offer)');
    await claims(R);
    await db.query(`select accept_business_offer($1::uuid, null::timestamptz, 0::smallint)`, [O]);
    await db.query(`select set_config('request.jwt.claims', '', false)`);
    check('booked', (await db.query(`select status from business_request_offers where id = $1`, [O])).rows[0].status === 'accepted');
    await businessSees('business owner + attendee, booked', B);

    console.log('== everyone else');
    r = await as(OTHER).from('business_offer_views').select('*'); if (!open) check('another business: nothing', !r.error && r.data.length === 0, r);
    r = await as(S).from('business_offer_views').select('*'); if (!open) check('stranger: nothing', !r.error && r.data.length === 0, r);
    r = await anon.from('business_offer_views').select('*'); if (!open) check('signed out: refused', r.error?.code === '42501', r.error ?? r.data);
  } catch (e) {
    failed += 1; console.log(`FAIL  unexpected ${e.message}`);
  } finally {
    try { await clean(); } catch (e) { failed += 1; console.log(`FAIL  cleanup ${e.message}`); }
    const left = (await db.query(`select count(*)::int n from profiles where id = any($1::uuid[])`, [people])).rows[0].n;
    check('cleanup: no test rows left', left === 0, left);
    await db.end();
    try { sh(['rm', '-f', REST]); } catch { /* gone */ }
    console.log(`${passed} passed, ${failed} failed${open ? ' (EXPECT=open: business checks are meant to fail)' : ''}`);
    process.exit(failed ? 1 : 0);
  }
})();
