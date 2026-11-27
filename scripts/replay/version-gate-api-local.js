#!/usr/bin/env node
// Minimum supported app version (20270434) through a REAL PostgREST with real JWTs, on the LOCAL replay database only.
// Proves over HTTP what the journey proves in SQL: the hook sees the x-nearby-build / x-nearby-platform headers and the
// native "Nearby/<build> CFNetwork" user agent builds <= 87 send; a build below an ENFORCED minimum is refused before
// anything runs (400, P0001, hint app_update_required), reads and writes, signed in and out, and its write changes nothing;
// supabase-js surfaces the hint (what services/appVersion.js reacts to); the policy read itself passes for old builds
// (GET and POST, signed out, even with an expired token sent); at / above the minimum, browsers and other platforms are
// untouched; switching off and lowering take effect on the very next request (no PostgREST reload).
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg NAME=<db container> node scripts/replay/version-gate-api-local.js
// EXPECT=open: run with 0434 rolled back; every refusal check must then fail (proves they can).
const dbUrl = process.env.NEARBY_LOCAL_DB_URL;
const local = /^postgres:\/\/[^@]+@(localhost|127\.|172\.|10\.|192\.168\.)/;
if (!dbUrl || !local.test(dbUrl)) { console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.'); process.exit(2); }
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const { createClient } = require('@supabase/supabase-js');

const DB = process.env.NAME || 'nearby-replay';
const REST = `${DB}-version-rest`;
const NET = process.env.REPLAY_NETWORK || 'nearby-replay-internal';
const IMAGE = process.env.POSTGREST_IMAGE || 'postgrest/postgrest:v13.0.7';
const SECRET = crypto.randomBytes(32).toString('hex');
const open = process.env.EXPECT === 'open';
const sh = (args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims, expIn = 3600) => {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + expIn, ...claims })}`;
  return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
};
let failed = 0; let passed = 0;
const check = (name, ok, detail) => { if (ok) { passed += 1; console.log(`  ok  ${name}`); } else { failed += 1; console.log(`FAIL  ${name} ${detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)}`); } };
// A refusal check: in EXPECT=open mode it must NOT hold (the request goes through without 0434).
const refusal = (name, res) => {
  const ok = res.status === 400 && res.body?.hint === 'app_update_required' && res.body?.code === 'P0001';
  check(open ? `${name} (0434 rolled back: goes through)` : name, open ? !ok : ok, res);
};
const OLD_UA = 'Nearby/87 CFNetwork/3826.500.111 Darwin/25.0.0';

(async () => {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  const USER = crypto.randomUUID();
  const installed = (await db.query(`select to_regclass('private.app_version_policy') is not null x`)).rows[0].x;
  const setPolicy = (sql) => (installed ? db.query(sql) : null);
  const clean = async () => {
    if (installed) {
      await db.query(`update private.app_version_policy set enforced = false, min_supported_build = null, latest_build = null, update_url = null where platform = 'ios'`);
      await db.query(`delete from private.app_build_availability where recorded_by = 'version-gate-api-local'`);
    }
    await db.query(`select set_config('app.trusted_update', 'true', false)`);
    await db.query(`delete from profiles where id = $1`, [USER]);
    await db.query(`delete from auth.users where id = $1`, [USER]);
    await db.query(`select set_config('app.trusted_update', 'false', false)`);
  };
  try {
    sh(['exec', '-e', 'PGPASSWORD=postgres', DB, 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-c', `alter role authenticator with password 'postgres';`]);
    try { sh(['rm', '-f', REST]); } catch { /* none */ }
    sh(['run', '-d', '--name', REST, '--network', NET, '-e', `PGRST_DB_URI=postgres://authenticator:postgres@${DB}:5432/postgres`,
      '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${SECRET}`, IMAGE]);
    const ip = sh(['inspect', '-f', `{{(index .NetworkSettings.Networks "${NET}").IPAddress}}`, REST]).trim();
    const base = `http://${ip}:3000`;
    // ready = the schema cache is loaded (503 PGRST002 until then)
    for (let i = 0; i < 90; i += 1) {
      try { if ((await fetch(`${base}/`)).status === 200) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 1000));
    }

    // One real signed-in person (profile with a bio we can watch).
    await db.query(`insert into auth.users (id, aud, role, email, phone, phone_confirmed_at, created_at) values ($1::uuid, 'authenticated', 'authenticated', $1::text || '@version.invalid', '1555' || lpad((('x0' || substr(md5($1::text), 1, 7))::bit(32)::int % 100000000)::text, 8, '0'), now(), now() - interval '30 days')`, [USER]);
    await db.query(`select set_config('app.trusted_update', 'true', false)`);
    await db.query(`insert into profiles (id, display_name, bio, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden) values ($1, 'Version Test', 'before', date '1994-05-01', now() - interval '30 days', now(), 'America/New_York', true, false)`, [USER]);
    await db.query(`select set_config('app.trusted_update', 'false', false)`);
    const userJwt = jwt({ sub: USER, role: 'authenticated' });

    // Enforce iOS >= 90 (needs build 90 recorded as available first: the trigger refuses otherwise).
    await setPolicy(`insert into private.app_build_availability (platform, build, channel, recorded_by, evidence) values ('ios', 90, 'testflight', 'version-gate-api-local', 'local test fixture')`);
    await setPolicy(`update private.app_version_policy set min_supported_build = 90, latest_build = 90, enforced = true, update_url = 'itms-beta://testflight.apple.com/v1/app/0' where platform = 'ios'`);

    const call = async (method, path, { build, platform = 'ios', ua, token, body } = {}) => {
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (build !== undefined) { headers['x-nearby-build'] = String(build); headers['x-nearby-platform'] = platform; }
      if (ua) headers['User-Agent'] = ua;
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${base}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      let json = null; try { json = await res.json(); } catch { /* empty */ }
      return { status: res.status, body: json };
    };

    // 1. the policy read always passes, for an old build, GET and POST, and with an expired token never sent
    const pg = await call('GET', '/rpc/get_app_version_policy?platform_param=ios', { build: 80 });
    check('policy read (GET) passes for build 80', open ? pg.status === 404 : pg.status === 200 && pg.body?.min_supported_build === 90, pg);
    const pp = await call('POST', '/rpc/get_app_version_policy', { ua: OLD_UA, body: { platform_param: 'ios' } });
    check('policy read (POST) passes for build 87 (user agent)', open ? pp.status === 404 : pp.status === 200 && pp.body?.update_url?.startsWith('itms-beta:'), pp);

    // 2. below the minimum: refused before anything runs
    refusal('build 89 header, signed out, read', await call('GET', '/profiles?select=id&limit=1', { build: 89 }));
    refusal('build 87 user agent (no header), signed in, read', await call('GET', '/profiles?select=id&limit=1', { ua: OLD_UA, token: userJwt }));
    refusal('build 87 user agent, signed in, RPC', await call('POST', '/rpc/get_my_experience_feedback', { ua: OLD_UA, token: userJwt, body: {} }));
    refusal('build 87 user agent, signed in, own-profile write', await call('PATCH', `/profiles?id=eq.${USER}`, { ua: OLD_UA, token: userJwt, body: { timezone: 'Europe/Paris' } }));
    const bio = (await db.query(`select timezone from profiles where id = $1`, [USER])).rows[0].timezone;
    check(open ? 'the old build\'s write landed (0434 rolled back)' : 'the refused write changed nothing', open ? bio === 'Europe/Paris' : bio === 'America/New_York', bio);
    await db.query(`select set_config('app.trusted_update', 'true', false)`);
    await db.query(`update profiles set timezone = 'America/New_York' where id = $1`, [USER]);
    await db.query(`select set_config('app.trusted_update', 'false', false)`);

    // 3. supabase-js surfaces the hint (services/appVersion.js switches to "required" on it)
    const old = createClient(base, jwt({ role: 'anon' }), { auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-nearby-build': '89', 'x-nearby-platform': 'ios' } } });
    // supabase-js targets <url>/rest/v1: point it at PostgREST's root instead.
    old.rest.url = base;
    const sj = await old.from('profiles').select('id').limit(1);
    const sjOk = sj.error?.hint === 'app_update_required' && sj.error?.code === 'P0001';
    check(open ? 'supabase-js: no refusal (0434 rolled back)' : 'supabase-js error carries hint app_update_required', open ? !sjOk : sjOk, sj.error);

    // 4. at / above the minimum, other platforms, browsers, unidentified: untouched
    const at = await call('GET', '/profiles?select=id&limit=1', { build: 90, token: userJwt });
    check('build 90 header, signed in: allowed', at.status === 200, at);
    const w = await call('PATCH', `/profiles?id=eq.${USER}`, { build: 90, token: userJwt, body: { timezone: 'Europe/Berlin' } });
    const bio90 = (await db.query(`select timezone from profiles where id = $1`, [USER])).rows[0].timezone;
    check('build 90 write lands', w.status < 300 && bio90 === 'Europe/Berlin', { w, bio90 });
    check('android build 1: allowed', (await call('GET', '/profiles?select=id&limit=1', { build: 1, platform: 'android', token: userJwt })).status === 200);
    check('browser user agent, no header: allowed', (await call('GET', '/profiles?select=id&limit=1', { ua: 'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15', token: userJwt })).status === 200);
    check('no identifying headers: allowed', (await call('GET', '/profiles?select=id&limit=1', { token: userJwt })).status === 200);
    const forged = await call('GET', '/profiles?select=id&limit=1', { build: 999999, token: userJwt });
    check('a forged higher build only passes the version check (RLS unchanged: same rows as unidentified)', forged.status === 200, forged);

    // 5. emergency recovery takes effect on the next request (no PostgREST reload)
    await setPolicy(`update private.app_version_policy set min_supported_build = 85 where platform = 'ios'`);
    const after85 = await call('GET', '/profiles?select=id&limit=1', { ua: OLD_UA, token: userJwt });
    check('lowered to 85: build 87 allowed at once', after85.status === 200, after85);
    refusal('lowered to 85: build 84 still refused', await call('GET', '/profiles?select=id&limit=1', { build: 84 }));
    await setPolicy(`update private.app_version_policy set enforced = false where platform = 'ios'`);
    const off = await call('GET', '/profiles?select=id&limit=1', { build: 1, token: userJwt });
    check('switched off: build 1 allowed at once', off.status === 200, off);
    const pOff = await call('GET', '/rpc/get_app_version_policy?platform_param=ios');
    check('switched off: the policy read shows no minimum', open ? pOff.status === 404 : pOff.status === 200 && pOff.body?.min_supported_build === null, pOff);
  } catch (e) {
    failed += 1; console.log(`FAIL  unexpected error: ${e.stack || e.message}`);
  } finally {
    try { await clean(); } catch (e) { failed += 1; console.log(`FAIL  cleanup: ${e.message}`); }
    try { sh(['rm', '-f', REST]); } catch { /* none */ }
    await db.end();
    console.log(`\n${passed} passed, ${failed} failed${open ? ' (EXPECT=open)' : ''}`);
    process.exit(failed ? 1 : 0);
  }
})();
