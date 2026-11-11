#!/usr/bin/env node
// A host's attendance reads through a REAL PostgREST with real JWTs (owner, 2026-11-11; migration 20270411), on the LOCAL replay
// database only. Runs the host's query shapes from src/services/gatherings.js + homeDashboard.js with the app's query builder
// (@supabase/postgrest-js), plus direct API attempts at a blocked person's row in both directions. Rows it creates are deleted.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg NAME=<db container> node scripts/replay/host-attendance-api-local.js
// EXPECT=open: run with 20270411 rolled back; every privacy check must then FAIL (proves the checks can fail).
const dbUrl = process.env.NEARBY_LOCAL_DB_URL;
const local = /^postgres:\/\/[^@]+@(localhost|127\.|172\.|10\.|192\.168\.)/;
if (!dbUrl || !local.test(dbUrl)) { console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.'); process.exit(2); }
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const { PostgrestClient } = require('@supabase/postgrest-js');

const DB = process.env.NAME || 'nearby-v407';
const REST = `${DB}-attendance-rest`;
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
  const id = () => crypto.randomUUID();
  const H = id(); const OK = id(); const HB = id(); const AB = id(); const PB = id(); const PO = id();
  const people = [H, OK, HB, AB, PB, PO];
  const name = { [H]: 'H', [OK]: 'OK', [HB]: 'HB', [AB]: 'AB', [PB]: 'PB', [PO]: 'PO' };
  let G;
  const clean = async () => {
    await db.query(`delete from blocks where blocker_id = any($1::uuid[]) or blocked_id = any($1::uuid[])`, [people]);
    await db.query(`delete from gatherings where host_id = any($1::uuid[])`, [people]);
    await db.query(`delete from profiles where id = any($1::uuid[])`, [people]);
    await db.query(`delete from auth.users where id = any($1::uuid[])`, [people]);
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
    const as = (u) => new PostgrestClient(url, { headers: { Authorization: `Bearer ${jwt({ role: 'authenticated', sub: u })}` } });
    const service = new PostgrestClient(url, { headers: { Authorization: `Bearer ${jwt({ role: 'service_role' })}` } });

    await db.query(`select set_config('app.trusted_update', 'on', false)`);
    for (const u of people) {
      await db.query(`insert into auth.users (id, aud, role, email, phone, phone_confirmed_at, created_at) values ($1::uuid, 'authenticated', 'authenticated', $1::text || '@attendance.invalid', '1555' || lpad((('x0' || substr(md5($1::text), 1, 7))::bit(32)::int % 100000000)::text, 8, '0'), now(), now() - interval '30 days')`, [u]);
      await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden) values ($1, $2, date '1994-05-01', now() - interval '30 days', now(), 'America/New_York', true, false)`, [u, `Attendance ${name[u]}`]);
    }
    G = (await db.query(`insert into gatherings (host_id, title, scheduled_at, duration_minutes, precise_lat, precise_lng, interest_tag, area, visibility, is_public) values ($1::uuid, 'Attendance', now() + interval '2 days', 60, 10.02, -10.03, 'Coffee', 'j', 'everyone', true) returning id`, [H])).rows[0].id;
    await db.query(`insert into gathering_interest (gathering_id, user_id, status) values ($1, $2, 'approved'), ($1, $3, 'approved'), ($1, $4, 'approved'), ($1, $5, 'pending'), ($1, $6, 'pending')`, [G, OK, HB, AB, PB, PO]);
    await db.query(`insert into blocks (blocker_id, blocked_id) values ($1, $2), ($3, $1), ($1, $4)`, [H, HB, AB, PB]);

    const open = process.env.EXPECT === 'open';
    const blocked = new Set([HB, AB, PB]);
    const leaks = (rows) => (rows ?? []).filter((x) => blocked.has(x.user_id ?? x.profiles?.id)).map((x) => name[x.user_id ?? x.profiles?.id]);
    const priv = (n, ok, d) => check(n, open ? !ok : ok, d);
    const Hc = as(H);
    console.log(`== the host's reads (${open ? 'EXPECT=open: each must FAIL' : 'blocked people never appear'})`);
    let r = await Hc.from('gathering_interest').select('id, user_id, status, profiles(display_name)').eq('gathering_id', G);
    check('getGatheringRequestsForHost shape: no error', !r.error, r.error);
    priv('getGatheringRequestsForHost shape: no blocked person (either direction)', !r.error && leaks(r.data).length === 0 && r.data.length === 2, leaks(r.data));
    r = await Hc.from('gathering_interest').select('id, gathering_id, created_at, gatherings!inner(title, host_id), profiles(id, display_name, photo_url)').eq('status', 'pending').eq('gatherings.host_id', H);
    check('getAllPendingRequests shape: no error', !r.error, r.error);
    priv('getAllPendingRequests shape: only the unblocked request', !r.error && r.data.length === 1 && r.data[0].profiles?.id === PO, (r.data ?? []).map((x) => name[x.profiles?.id]));
    r = await Hc.from('gathering_interest').select('id, gatherings!inner(host_id)', { count: 'exact', head: true }).eq('status', 'pending').eq('gatherings.host_id', H);
    priv('Home pending count: 1 (the blocked request is not counted)', !r.error && r.count === 1, r.count);
    r = await Hc.from('gatherings').select('id, attendees:gathering_interest(status, user_id, created_at, on_my_way_at, checked_in_at)').eq('id', G);
    check('getGatheringDetail embed: no error', !r.error, r.error);
    priv('getGatheringDetail embed: attendees hold no blocked person', !r.error && leaks(r.data?.[0]?.attendees).length === 0, leaks(r.data?.[0]?.attendees));
    r = await Hc.from('gathering_interest').select('*').eq('user_id', HB);
    priv('direct: the host asks for the person they blocked by id: nothing', !r.error && r.data.length === 0, r.data);
    r = await Hc.from('gathering_interest').select('*').eq('user_id', AB);
    priv('direct: the host asks for the person who blocked them by id: nothing', !r.error && r.data.length === 0, r.data);
    r = await Hc.from('gathering_interest').select('*', { count: 'exact', head: true }).in('user_id', [HB, AB, PB]);
    priv('direct: exact count of the blocked people\'s rows is 0', !r.error && r.count === 0, r.count);
    r = await Hc.from('gathering_interest').select('user_id').eq('gathering_id', G).order('created_at').limit(10);
    priv('direct: ordered page of the gathering: no blocked person', !r.error && leaks(r.data).length === 0, leaks(r.data));

    console.log('== what keeps working');
    r = await Hc.rpc('get_gathering_approved_counts', { gathering_ids: [G] });
    check('approved count stays accurate (3, the blocked attendees included)', !r.error && r.data?.[0]?.approved_count === 3, r.data ?? r.error);
    for (const [who, label] of [[HB, 'HB (blocked by the host)'], [AB, 'AB (blocked the host)'], [PB, 'PB (pending, blocked by the host)']]) {
      r = await as(who).from('gathering_interest').select('user_id, status').eq('gathering_id', G).eq('user_id', who);
      check(`${label} still reads their own row`, !r.error && r.data.length === 1, r.data ?? r.error);
    }
    r = await as(OK).from('gathering_interest').select('user_id').eq('gathering_id', G).eq('status', 'approved');
    check('a fellow attendee with no block still sees all three approved', !r.error && r.data.length === 3, (r.data ?? []).map((x) => name[x.user_id]));
    r = await service.from('gathering_interest').select('user_id').eq('gathering_id', G);
    check('service role (moderation) still reads every row', !r.error && r.data.length === 5, r);
    const kept = (await db.query(`select count(*)::int n from gathering_interest where gathering_id = $1`, [G])).rows[0].n;
    check('no row was changed or removed', kept === 5, kept);
  } finally {
    await clean().catch((e) => console.log('cleanup error', e.message));
    await db.end();
    try { sh(['rm', '-f', REST]); } catch { /* gone */ }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
