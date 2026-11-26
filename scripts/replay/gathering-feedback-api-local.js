#!/usr/bin/env node
// Gathering ratings through a REAL PostgREST with real JWTs (owner, 2026-11-09; migration 20270408), on the LOCAL replay database only.
// Runs the exact query shapes Build 87 sends (src/services/gatherings.js on main), with the same query builder the app uses
// (@supabase/postgrest-js), plus direct API attempts on other people's ratings. Rows it creates are deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg NAME=<db container> node scripts/replay/gathering-feedback-api-local.js
// EXPECT=open checks the OLD behaviour instead, to prove these checks can fail: run with the migration rolled back, each privacy check must fail.
const dbUrl = process.env.NEARBY_LOCAL_DB_URL;
const local = /^postgres:\/\/[^@]+@(localhost|127\.|172\.|10\.|192\.168\.)/;
if (!dbUrl || !local.test(dbUrl)) { console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.'); process.exit(2); }
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const { PostgrestClient } = require('@supabase/postgrest-js');

const DB = process.env.NAME || 'nearby-v407';
const REST = `${DB}-feedback-rest`;
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
const check = (name, ok, detail) => { if (ok) { passed += 1; console.log(`  ok  ${name}`); } else { failed += 1; console.log(`FAIL  ${name} ${detail === undefined ? '' : JSON.stringify(detail)}`); } };

(async () => {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  const H = crypto.randomUUID(); const R = crypto.randomUUID(); const O = crypto.randomUUID(); const S = crypto.randomUUID(); const BIZ = crypto.randomUUID();
  const PARTNER = crypto.randomUUID();
  const people = [H, R, O, S, BIZ];
  let G; let BG;
  const clean = async () => {
    await db.query(`delete from gathering_feedback where reviewer_id = any($1::uuid[])`, [people]);
    await db.query(`delete from gatherings where host_id = any($1::uuid[])`, [people]);
    await db.query(`delete from profiles where id = any($1::uuid[])`, [people]);
    await db.query(`delete from auth.users where id = any($1::uuid[])`, [people]);
    await db.query(`delete from brand_partners where id = $1`, [PARTNER]);
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
    const service = new PostgrestClient(url, { headers: { Authorization: `Bearer ${jwt({ role: 'service_role' })}` } });

    await db.query(`select set_config('app.trusted_update', 'on', false)`);
    for (const id of people) {
      await db.query(`insert into auth.users (id, aud, role, email, phone, phone_confirmed_at, created_at) values ($1::uuid, 'authenticated', 'authenticated', $1::text || '@feedback.invalid', '1555' || lpad((('x0' || substr(md5($1::text), 1, 7))::bit(32)::int % 100000000)::text, 8, '0'), now(), now() - interval '30 days')`, [id]);
      await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden) values ($1, 'Feedback Test', date '1994-05-01', now() - interval '30 days', now(), 'America/New_York', true, false) on conflict (id) do update set display_name = 'Feedback Test'`, [id]);
    }
    await db.query(`insert into brand_partners (id, name, active, latitude, longitude, address, category, subcategory, categories, max_group_size) values ($1, 'Feedback Cafe', true, 40, -75, '1 Test St', 'food_drink', 'Coffee', '{}', 40)`, [PARTNER]);
    await db.query(`update profiles set managed_partner_id = $1 where id = $2`, [PARTNER, BIZ]);
    const mk = async (host, title, partner) => (await db.query(`insert into gatherings (host_id, title, scheduled_at, duration_minutes, precise_lat, precise_lng, interest_tag, area, visibility, is_public, hosting_partner_id) values ($1::uuid, $2, now() - interval '3 hours', 60, 10.02, -10.03, 'Pickleball', 'j', 'everyone', true, $3::uuid) returning id`, [host, title, partner])).rows[0].id;
    G = await mk(H, 'Over', null); BG = await mk(BIZ, 'Business hosted', PARTNER);
    await db.query(`insert into gathering_interest (gathering_id, user_id, status) values ($1, $3, 'approved'), ($1, $4, 'approved'), ($2, $3, 'approved'), ($2, $4, 'approved')`, [G, BG, R, O]);
    await db.query(`insert into gathering_feedback (gathering_id, reviewer_id, felt_welcoming, would_attend_again, satisfaction_rating, great_because) values ($1, $3, true, true, 'loved_it', array['people']), ($2, $3, true, true, 'loved_it', array['host'])`, [G, BG, O]);

    const open = process.env.EXPECT === 'open';
    const none = (r) => !r.error && (r.data ?? []).length === 0;
    console.log('== direct API reads of other people\'s ratings');
    const S_ = as(S);
    let r = await S_.from('gathering_feedback').select('*'); check('stranger: select * returns nothing', none(r), r);
    r = await S_.from('gathering_feedback').select('reviewer_id, satisfaction_rating').eq('reviewer_id', O); check('stranger: filter by reviewer returns nothing', none(r), r);
    r = await S_.from('gathering_feedback').select('*').eq('gathering_id', G); check('stranger: filter by gathering returns nothing', none(r), r);
    r = await S_.from('gathering_feedback').select('*').contains('great_because', ['people']); check('stranger: filter by tag returns nothing', none(r), r);
    r = await S_.from('gathering_feedback').select('*', { count: 'exact', head: true }).eq('gathering_id', G); check('stranger: exact count is 0', !r.error && r.count === 0, r.count);
    r = await S_.from('gatherings').select('id, gathering_feedback(reviewer_id, satisfaction_rating)').eq('id', G); check('stranger: embed from gatherings returns no rating', !r.error && (r.data?.[0]?.gathering_feedback ?? []).length === 0, r);
    r = await as(H).from('gathering_feedback').select('*').eq('gathering_id', G); check('host: no individual rating of their own gathering', none(r), r);
    r = await as(BIZ).from('gathering_feedback').select('*').eq('gathering_id', BG); check('business owner: no individual rating of their own gathering', none(r), r);
    r = await anon.from('gathering_feedback').select('*'); check('signed out: refused or empty', open ? none(r) : r.error?.code === '42501', r.error ?? r.data);

    console.log('== writes to someone else\'s rating');
    r = await S_.from('gathering_feedback').update({ satisfaction_rating: 'okay' }).eq('reviewer_id', O).select(); check('stranger: update changes nothing', none(r) || r.error?.code === '42501', r);
    r = await S_.from('gathering_feedback').delete().eq('reviewer_id', O).select(); check('stranger: delete changes nothing', none(r) || r.error?.code === '42501', r);
    const kept = (await db.query(`select count(*)::int n from gathering_feedback where reviewer_id = $1 and satisfaction_rating = 'loved_it'`, [O])).rows[0].n;
    check('the rater\'s rows are intact', kept === 2, kept);

    console.log('== Build 87 query shapes (src/services/gatherings.js on main)');
    const R_ = as(R);
    r = await R_.from('gathering_feedback').select('id').eq('gathering_id', G).eq('reviewer_id', R).maybeSingle();
    check('hasSubmittedFeedback before rating: no error, no row', !r.error && r.data === null, r);
    r = await R_.from('gathering_feedback').select('gathering_id').eq('reviewer_id', R).in('gathering_id', [G, BG]);
    check('getUnratedAttendedGathering before rating: no error, no row', none(r), r);
    r = await R_.from('gathering_feedback').upsert({ gathering_id: G, reviewer_id: R, felt_welcoming: null, would_attend_again: null, satisfaction_rating: 'loved_it', great_because: ['people'] });
    check('submitGatheringFeedback (upsert, new rating): saved', !r.error, r.error);
    r = await R_.from('gathering_feedback').select('id').eq('gathering_id', G).eq('reviewer_id', R).maybeSingle();
    check('hasSubmittedFeedback after rating: found', !r.error && !!r.data, r);
    r = await R_.from('gathering_feedback').select('gathering_id').eq('reviewer_id', R).in('gathering_id', [G, BG]);
    check('getUnratedAttendedGathering after rating: finds it', !r.error && r.data.length === 1, r);
    r = await R_.from('gathering_feedback').upsert({ gathering_id: G, reviewer_id: R, satisfaction_rating: 'okay' });
    check('a second rating: the same duplicate refusal as today', r.error?.code === '23505', r.error);
    r = await R_.from('gathering_feedback').upsert({ gathering_id: BG, reviewer_id: O, satisfaction_rating: 'okay' });
    check('rating in someone else\'s name: refused', !!r.error, r);
    r = await S_.from('gathering_feedback').select('great_because, gatherings!inner(host_id)').eq('gatherings.host_id', H);
    check('getHostLovedTags (stranger): no error, nothing, the line hides', none(r), r);
    r = await S_.from('gathering_feedback').select('great_because, gatherings!inner(hosting_partner_id)').eq('gatherings.hosting_partner_id', PARTNER);
    check('getBusinessLovedTags (stranger): no error, nothing, the line hides', none(r), r);
    r = await S_.from('gathering_feedback').select('felt_welcoming, would_attend_again, gatherings!inner(hosting_partner_id)').eq('gatherings.hosting_partner_id', PARTNER);
    check('getBusinessReputation (stranger): no error, nothing, the line hides', none(r), r);
    r = await R_.from('gathering_feedback').select('great_because, gatherings!inner(host_id)').eq('gatherings.host_id', H);
    check(`getHostLovedTags (someone who rated this host): no error, own row only (known transitional behaviour on builds <= 87)`, !r.error && r.data.length === 1, r);
    r = await R_.rpc('get_host_reputation', { host_id_param: H });
    check('get_host_reputation: no error, no row', none(r), r);

    console.log('== server functions and server-side access');
    r = await R_.rpc('get_my_experience_feedback'); check('private ranking word still reads the person\'s own rating', !r.error && (r.data?.[0]?.loved_host_ids ?? []).includes(H), r);
    r = await R_.rpc('get_my_plans_this_month', { p_since: new Date(Date.now() - 864e5).toISOString(), p_until: new Date(Date.now() + 864e5).toISOString() });
    check('plans this month still counts a rated gathering', !r.error && (Array.isArray(r.data) ? r.data.length > 0 : r.data > 0), r);
    r = await S_.rpc('get_my_experience_feedback'); check('private ranking word holds nothing for a stranger', !r.error && (r.data?.[0]?.loved_host_ids ?? []).length === 0, r);
    r = await service.from('gathering_feedback').select('reviewer_id').eq('gathering_id', G);
    check('service role (moderation) still reads every row', !r.error && r.data.length === 2, r);
  } finally {
    await clean().catch((e) => console.log('cleanup error', e.message));
    await db.end();
    try { sh(['rm', '-f', REST]); } catch { /* gone */ }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
