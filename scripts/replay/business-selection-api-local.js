#!/usr/bin/env node
// Stale-location guard through a REAL PostgREST with real JWTs (owner, 2026-11-16; migration 20270426), on the LOCAL
// replay database only. One account owns locations A and B. "Device 1" (the phone) shows A and names it on every request
// (x-nearby-business, as the app from this branch does); "device 2" (the website) switches the account to B. Then device 1
// tries EVERY client-callable business function (every public function a client can execute whose body reads the
// selected location), every direct business-table write and a read: each must be refused before it runs (400, P0001,
// hint business_selection_changed), and B (every row of every table with a partner_id column, its brand_partners row and
// its private contact details) must be byte-identical afterwards. Also: the matching screen works, switching / listing
// still work from the stale screen, a GET (read-only transaction) is checked too, A-only staff naming B are refused, a
// switch racing a write waits for it (the write lands on the location the screen named), and (20270427) an old build that
// sends NO header and signed in after the second location was added: every location-specific write refused, A and B
// byte-identical, while its person-level settings, reads, switching and personal story still work; single-location
// staff unchanged; a revoked membership brings the account back to one location.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg NAME=<db container> node scripts/replay/business-selection-api-local.js
// EXPECT=open: run with 0427 + 0426 rolled back; the stale-screen and old-build checks must then fail (proves they can).
const dbUrl = process.env.NEARBY_LOCAL_DB_URL;
const local = /^postgres:\/\/[^@]+@(localhost|127\.|172\.|10\.|192\.168\.)/;
if (!dbUrl || !local.test(dbUrl)) { console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.'); process.exit(2); }
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');

const DB = process.env.NAME || 'nearby-v452';
const REST = `${DB}-selection-rest`;
const NET = process.env.REPLAY_NETWORK || 'nearby-replay-internal';
const IMAGE = process.env.POSTGREST_IMAGE || 'postgrest/postgrest:v13.0.7';
const SECRET = crypto.randomBytes(32).toString('hex');
const open = process.env.EXPECT === 'open';
const sh = (args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (claims) => {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}`;
  return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
};
let failed = 0; let passed = 0;
const check = (name, ok, detail) => { if (ok) { passed += 1; console.log(`  ok  ${name}`); } else { failed += 1; console.log(`FAIL  ${name} ${detail === undefined ? '' : JSON.stringify(detail).slice(0, 400)}`); } };
const HINT = 'business_selection_changed';

(async () => {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  const OWNER = crypto.randomUUID(); const STAFF = crypto.randomUUID();
  const A = crypto.randomUUID(); const B = crypto.randomUUID();
  const people = [OWNER, STAFF];
  const trusted = async (sql, params) => { await db.query(`select set_config('app.trusted_update', 'true', false)`); return db.query(sql, params); };
  const clean = async () => {
    await db.query(`select set_config('request.jwt.claims', '', false)`);
    await db.query(`select set_config('app.trusted_update', 'true', false)`);
    await db.query(`update profiles set managed_partner_id = null where id = any($1::uuid[])`, [people]);
    for (const { s: sc, t } of (await db.query(`select table_schema s, table_name t from information_schema.columns c join information_schema.tables x using (table_schema, table_name)
        where c.column_name = 'partner_id' and c.table_schema in ('public', 'private') and x.table_type = 'BASE TABLE' and c.table_name <> 'business_memberships'`)).rows) {
      await db.query(`delete from ${sc}.${t} where partner_id = any($1::uuid[])`, [[A, B]]);
    }
    await db.query(`delete from private.business_memberships where user_id = any($1::uuid[])`, [people]);
    if ((await db.query(`select to_regclass('private.location_aware_sessions') is not null x`)).rows[0].x) await db.query(`delete from private.location_aware_sessions where user_id = any($1::uuid[])`, [people]);
    await db.query(`delete from auth.sessions where user_id = any($1::uuid[])`, [people]);
    await db.query(`delete from brand_partners where id = any($1::uuid[])`, [[A, B]]);
    await db.query(`delete from profiles where id = any($1::uuid[])`, [people]);
    await db.query(`delete from auth.users where id = any($1::uuid[])`, [people]);
    await db.query(`select set_config('app.trusted_update', 'false', false)`);
  };
  // Every row about a location, in every table that names one (+ its brand_partners row and private contact details).
  const snapshot = async (p) => {
    const cols = (await db.query(`select table_schema s, table_name t from information_schema.columns c
        join information_schema.tables x using (table_schema, table_name)
        where c.column_name = 'partner_id' and c.table_schema in ('public', 'private') and x.table_type = 'BASE TABLE' order by 1, 2`)).rows;
    const out = {};
    for (const { s, t } of cols) {
      const r = await db.query(`select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by to_jsonb(x)::text), '')) h, count(*)::int n from ${s}.${t} x where partner_id = $1`, [p]);
      out[`${s}.${t}`] = r.rows[0];
    }
    out['public.brand_partners'] = (await db.query(`select md5(to_jsonb(b)::text) h from brand_partners b where id = $1`, [p])).rows[0];
    return out;
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
    // device = { sub, shows }: shows = the location the screen names (null = no header, like build <= 87)
    const call = async (dev, method, path, body) => {
      const headers = { Authorization: `Bearer ${jwt({ role: 'authenticated', sub: dev.sub })}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
      if (dev.shows) headers['x-nearby-business'] = dev.shows;
      const r = await fetch(`${url}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      let json = null; try { json = await r.json(); } catch { /* empty */ }
      return { status: r.status, json };
    };
    const isRefusal = (r) => r.status === 400 && r.json?.code === 'P0001' && r.json?.hint === HINT;

    // --- fixtures (service connection, deleted afterwards)
    for (const id of people) {
      await db.query(`insert into auth.users (id, aud, role, email, phone, phone_confirmed_at, created_at) values ($1::uuid, 'authenticated', 'authenticated', $1::text || '@selection.invalid', '1555' || lpad((('x0' || substr(md5($1::text), 1, 7))::bit(32)::int % 100000000)::text, 8, '0'), now(), now() - interval '30 days')`, [id]);
      await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden) values ($1, 'Selection Test', date '1994-05-01', now() - interval '30 days', now(), 'America/New_York', true, false) on conflict (id) do update set display_name = 'Selection Test'`, [id]);
    }
    for (const [p, n] of [[A, 'Selection Loc A'], [B, 'Selection Loc B']]) {
      await db.query(`insert into brand_partners (id, name, active, latitude, longitude, address, category, subcategory, categories, max_group_size) values ($1, $2, true, 40, -75, '1 Test St', 'food_drink', 'Coffee', '{}', 20)`, [p, n]);
    }
    // rollout gate (0426): the owner's one live session is location-aware before a second location can be added
    const SESSION = crypto.randomUUID();
    await db.query(`insert into auth.sessions (id, user_id, created_at, updated_at) values ($1, $2, now(), now())`, [SESSION, OWNER]);
    await trusted(`update profiles set managed_partner_id = $1 where id = $2`, [B, OWNER]); // membership B (the first)
    let gateRefused = false;
    try { await trusted(`update profiles set managed_partner_id = $1 where id = $2`, [A, OWNER]); } catch (e) { gateRefused = /multi_location_not_ready|several locations/.test(`${e.hint} ${e.message}`); }
    if (!open) check('rollout gate: second location refused while the session is not location-aware', gateRefused);
    {
      const headers = { Authorization: `Bearer ${jwt({ role: 'authenticated', sub: OWNER, session_id: SESSION })}`, 'Content-Type': 'application/json', 'x-nearby-business': crypto.randomUUID() };
      const r0 = await fetch(`${url}/rpc/note_location_aware_session`, { method: 'POST', headers, body: '{}' });
      check('the session records itself (allowed even with a stale header)', r0.status < 300, r0.status);
    }
    await trusted(`update profiles set managed_partner_id = $1 where id = any($2::uuid[])`, [A, people]); // A (owner + staff)
    await db.query(`select set_config('app.trusted_update', 'false', false)`);
    check('fixtures: owner holds A and B, selected A', (await db.query(`select count(*)::int n from private.business_memberships where user_id = $1`, [OWNER])).rows[0].n === 2);

    const phone = { sub: OWNER, shows: A }; const website = { sub: OWNER, shows: null };
    console.log('== the phone shows A, A selected');
    let r = await call(phone, 'POST', '/rpc/set_business_max_group_size', { partner_id_param: A, max_group_size_param: 12 });
    check('phone (A) saves to A', r.status < 300, r);
    check('A really changed', (await db.query(`select max_group_size from brand_partners where id = $1`, [A])).rows[0].max_group_size === 12);
    r = await call(phone, 'GET', `/brand_partners?id=eq.${A}&select=id`);
    check('phone (A) reads (GET, read-only transaction)', r.status === 200, r);

    console.log('== the website switches the account to B');
    r = await call(website, 'POST', '/rpc/select_managed_business', { partner_id_param: B });
    check('website switched to B', r.status < 300, r);
    const before = await snapshot(B);

    console.log('== the phone still shows A: every business path must be refused before it runs');
    const fns = (await db.query(`select p.proname, case when p.proargnames is null then '[]'::json else coalesce((select json_agg(n) from unnest(p.proargnames, coalesce(p.proargmodes, array_fill('i'::"char", array[cardinality(p.proargnames)]))) u(n, m) where m in ('i', 'b', 'v') and n <> ''), '[]') end args
        from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
          and p.prosrc ~ '(managed_partner_id|my_managed_partner_id)' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
          and p.proname not in ('select_managed_business', 'get_my_businesses', 'nearby_pre_request')
        order by 1`)).rows;
    const seen = new Set(); let reached = 0; const notRefused = [];
    for (const f of fns) {
      if (seen.has(f.proname)) continue; seen.add(f.proname);
      const body = Object.fromEntries((f.args || []).map((n) => [n, null]));
      const res = await call(phone, 'POST', `/rpc/${f.proname}`, body);
      reached += 1;
      if (!isRefusal(res)) notRefused.push([f.proname, res.status, res.json?.code, res.json?.hint]);
    }
    if (open) console.log(`  (EXPECT=open) ${notRefused.length} of ${reached} functions not refused`);
    else check(`all ${reached} client-callable business functions refused for the stale screen`, reached > 50 && notRefused.length === 0, notRefused);
    const direct = [
      ['POST', '/brand_offers', { partner_id: B, title: 'stale', description: 'stale' }],
      ['PATCH', `/brand_offers?partner_id=eq.${B}`, { title: 'stale' }],
      ['DELETE', `/brand_offers?partner_id=eq.${B}`, undefined],
      ['POST', '/business_messages', { partner_id: B, body: 'stale' }],
      ['POST', '/business_updates', { partner_id: B, body: 'stale' }],
      ['PATCH', `/brand_partners?id=eq.${B}`, { name: 'stale' }],
      ['GET', `/brand_partners?id=eq.${B}&select=*`, undefined],
      ['GET', '/rpc/get_business_opportunities?partner_id_param=' + B, undefined],
    ];
    for (const [m, p, b] of direct) {
      r = await call(phone, m, p, b);
      if (!open) check(`stale screen ${m} ${p.split('?')[0]}: refused`, isRefusal(r), r);
    }
    // a real write with real arguments and no location argument (the shape that would land on B without the guard)
    r = await call(phone, 'POST', '/rpc/create_occasion_package', { occasion_type_param: 'birthday', name_param: 'Stale screen package', description_param: null, included_items_param: null, min_guests_param: null, price_per_person_param: null, available_days_param: null });
    if (!open) check('stale screen creating a package (no location argument): refused', isRefusal(r), r);
    const after = await snapshot(B);
    const changed = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (!open) check(`B byte-identical across ${Object.keys(before).length} tables`, changed.length === 0, changed);
    else console.log(`  (EXPECT=open) B tables changed: ${changed.join(', ') || 'none'}`);

    console.log('== recovery and the other roles');
    r = await call(phone, 'POST', '/rpc/get_my_businesses', {});
    check('stale screen can still list its locations', r.status === 200 && Array.isArray(r.json) && r.json.length === 2, r);
    const reloaded = { sub: OWNER, shows: B };
    r = await call(reloaded, 'POST', '/rpc/set_business_max_group_size', { partner_id_param: B, max_group_size_param: 15 });
    check('after reloading for B, the phone saves to B', r.status < 300, r);
    r = await call({ sub: STAFF, shows: B }, 'GET', `/brand_partners?id=eq.${A}&select=id`);
    if (!open) check('A-only staff naming B: refused (the header never grants)', isRefusal(r), r);
    r = await call({ sub: STAFF, shows: A }, 'POST', '/rpc/set_business_max_group_size', { partner_id_param: A, max_group_size_param: 9 });
    check('A-only staff naming A: saves', r.status < 300, r);
    r = await call(phone, 'POST', '/rpc/select_managed_business', { partner_id_param: A });
    check('stale screen can switch back to A', r.status < 300, r);
    r = await call(phone, 'POST', '/rpc/set_business_max_group_size', { partner_id_param: A, max_group_size_param: 13 });
    check('showing A again with A selected: saves', r.status < 300, r);

    console.log('== a switch racing a write: the switch waits, the write lands on the location the screen named');
    if (!open) {
      const c1 = new Client({ connectionString: dbUrl }); const c2 = new Client({ connectionString: dbUrl });
      await c1.connect(); await c2.connect();
      try {
        const claimsA = JSON.stringify({ sub: OWNER, role: 'authenticated' });
        await c1.query('begin');
        await c1.query(`select set_config('request.jwt.claims', $1, true), set_config('request.headers', $2, true), set_config('request.path', '/rpc/set_business_max_group_size', true)`, [claimsA, JSON.stringify({ 'x-nearby-business': A })]);
        await c1.query('set local role authenticated');
        await c1.query('select public.nearby_pre_request()');
        await c2.query(`select set_config('request.jwt.claims', $1, false)`, [claimsA]);
        await c2.query('set role authenticated');
        let switched = false;
        const sw = c2.query('select select_managed_business($1)', [B]).then(() => { switched = true; });
        await new Promise((f) => setTimeout(f, 700));
        check('the switch waits while the checked write is open', switched === false);
        await c1.query('select set_business_max_group_size($1, 14)', [A]);
        await c1.query('commit');
        await sw;
        check('the switch completes after the write', switched === true);
        const rows = (await db.query(`select id, max_group_size from brand_partners where id = any($1::uuid[])`, [[A, B]])).rows;
        const g = Object.fromEntries(rows.map((x) => [x.id, x.max_group_size]));
        check('the raced write landed on A (14), B untouched (15)', g[A] === 14 && g[B] === 15, g);
        r = await call(phone, 'POST', '/rpc/set_business_max_group_size', { partner_id_param: A, max_group_size_param: 16 });
        if (!open) check('the next request from the screen still showing A: refused', isRefusal(r), r);
      } finally { try { await c1.query('rollback'); } catch { /* done */ } await c1.end(); await c2.end(); }
    }

    console.log('== an old build (no header) signed in AFTER the second location was added (20270427)');
    // A fresh session that never recorded itself (the 0426 gate can't see it coming). Selection is B after the race.
    const oldBuild = { sub: OWNER, shows: null };
    const HINT_OLD = 'location_aware_client_required';
    const isOld = (x) => x.status === 400 && x.json?.code === 'P0001' && x.json?.hint === HINT_OLD;
    const has0427 = (await db.query(`select to_regprocedure('private._location_scoped_path(text)') is not null x`)).rows[0].x;
    const beforeA = await snapshot(A); const beforeB = await snapshot(B);
    // Which functions act for the selection, computed HERE, independently of the rule under test (20270427's
    // private._selection_reaching_function): itself or through any public/private function it calls, never through
    // recovery, the object-bound customer functions, or a read-only yes/no check (owner 2026-11-17: the trust stack's
    // screening wrappers reach the selection only through private._caller_partner() / *_unscreened).
    const EXEMPT = ['select_managed_business', 'get_my_businesses', 'note_location_aware_session', 'nearby_pre_request', 'my_managed_partner_id',
      'complete_business_reservation', 'cancel_business_reservation', 'approve_business_partner_request'];
    const allFns = (await db.query(`select n.nspname, p.proname, p.prosrc, p.prorettype = 'boolean'::regtype and p.provolatile <> 'v' as ro_bool,
        l.lanname in ('sql', 'plpgsql') as walkable
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
        where n.nspname in ('public', 'private') and p.prokind = 'f'`)).rows;
    const byName = new Map(); for (const f of allFns) { if (!byName.has(f.proname)) byName.set(f.proname, []); byName.get(f.proname).push(f); }
    const readsSel = (src) => ((src || '').match(/(managed_partner_id|my_managed_partner_id\(\))/g) || []).length
      > ((src || '').match(/(managed_partner_id|my_managed_partner_id\(\))\s+is\s+(not\s+)?null/gi) || []).length;
    const CAP = 16; const atCap = new Set();
    const reaches = (root) => {
      const seen = new Set([root]); let frontier = [root];
      for (let depth = 0; depth <= CAP && frontier.length; depth += 1) {
        const next = [];
        for (const name of frontier) {
          for (const f of byName.get(name) || []) {
            if (depth > 0 && f.ro_bool) continue;
            if (readsSel(f.prosrc)) return true;
            if (!f.walkable) continue;
            if (depth === CAP) { atCap.add(root); return true; } // fail closed: deeper than CAP counts (its calls were never read)
            for (const m of (f.prosrc || '').matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)) {
              if (!EXEMPT.includes(m[1]) && !seen.has(m[1])) { seen.add(m[1]); next.push(m[1]); }
            }
          }
        }
        frontier = next;
      }
      return false;
    };
    const callable = (await db.query(`select p.proname, case when p.proargnames is null then '[]'::json else coalesce((select json_agg(n) from unnest(p.proargnames, coalesce(p.proargmodes, array_fill('i'::"char", array[cardinality(p.proargnames)]))) u(n, m) where m in ('i', 'b', 'v') and n <> ''), '[]') end args,
        ${has0427 ? "private._location_scoped_path('/rpc/' || p.proname)" : 'null'} as rule_says
        from pg_proc p join pg_namespace s on s.oid = p.pronamespace
        where s.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') and p.prokind = 'f'
          and p.provolatile = 'v' and p.prorettype <> 'trigger'::regtype order by 1`)).rows;
    const scopedFns = callable.filter((f) => !EXEMPT.includes(f.proname) && reaches(f.proname));
    const scopedNames = new Set(scopedFns.map((f) => f.proname));
    const mustInclude = ['set_business_want_more', ...callable.map((f) => f.proname).filter((n) => byName.has(`${n}_unscreened`))];
    if (!open) {
      check(`old build: the independent list holds every wrapper (${[...new Set(mustInclude)].length}: set_business_want_more + every *_unscreened screening wrapper)`,
        mustInclude.every((n) => scopedNames.has(n)), mustInclude.filter((n) => !scopedNames.has(n)));
      const ruleYes = new Set(callable.filter((f) => f.rule_says).map((f) => f.proname));
      const missed = [...scopedNames].filter((n) => !ruleYes.has(n)); const extra = [...ruleYes].filter((n) => !scopedNames.has(n) && !EXEMPT.includes(n));
      check(`old build: no real function reaches the ${CAP}-level cap (one that did would be refused for a 2+-location account: visible here, never silent)`, atCap.size === 0, [...atCap]);
      check(`old build: the database rule agrees with the independent list (${scopedNames.size} functions)`, missed.length === 0 && extra.length === 0, { missed, extra });
    }
    const oldNotRefused = []; const oldSeen = new Set();
    for (const f of scopedFns) {
      if (oldSeen.has(f.proname)) continue; oldSeen.add(f.proname);
      const res = await call(oldBuild, 'POST', `/rpc/${f.proname}`, Object.fromEntries((f.args || []).map((n) => [n, null])));
      if (!isOld(res)) oldNotRefused.push([f.proname, res.status, res.json?.code, res.json?.hint]);
    }
    if (open) console.log(`  (EXPECT=open) old build: ${oldNotRefused.length} of ${oldSeen.size} write functions not refused`);
    else check(`old build: all ${oldSeen.size} location-specific write functions refused`, oldSeen.size > 50 && oldNotRefused.length === 0, oldNotRefused);
    for (const [m, p, b] of [
      ['POST', '/brand_offers', { partner_id: B, title: 'old', description: 'old' }],
      ['PATCH', `/brand_offers?partner_id=eq.${B}`, { title: 'old' }],
      ['DELETE', `/brand_offers?partner_id=eq.${B}`, undefined],
      ['POST', '/business_updates', { partner_id: B, body: 'old' }],
      ['POST', '/business_messages', { partner_id: B, sender_id: OWNER, conversation_with_id: STAFF, from_business: true, body: 'old reply' }],
      ['POST', '/stories', { user_id: OWNER, partner_id: B, media_path: `${B}/old.jpg`, media_type: 'image' }],
    ]) {
      r = await call(oldBuild, m, p, b);
      if (!open) check(`old build ${m} ${p.split('?')[0]}${b?.from_business || b?.partner_id && p === '/stories' ? ' (as the business)' : ''}: refused`, isOld(r), r);
    }
    r = await call(oldBuild, 'POST', '/rpc/create_occasion_package', { occasion_type_param: 'birthday', name_param: 'Old build package', description_param: null, included_items_param: null, min_guests_param: null, price_per_person_param: null, available_days_param: null });
    const oldPkg = (await db.query(`select partner_id from business_occasion_packages where name = 'Old build package' and partner_id = any($1::uuid[])`, [[A, B]])).rows;
    if (open) console.log(`  (EXPECT=open) old build package landed on: ${oldPkg.map((x) => (x.partner_id === B ? 'B' : 'A')).join(',') || 'nowhere'} (status ${r.status} ${r.json?.hint || ''})`);
    else check('old build creating a package (no location argument): refused, nothing created', isOld(r) && oldPkg.length === 0, { r, oldPkg });
    const afterA = await snapshot(A); const afterB = await snapshot(B);
    const changedAB = [...Object.keys(beforeA).filter((k) => JSON.stringify(beforeA[k]) !== JSON.stringify(afterA[k])).map((k) => `A:${k}`),
      ...Object.keys(beforeB).filter((k) => JSON.stringify(beforeB[k]) !== JSON.stringify(afterB[k])).map((k) => `B:${k}`)];
    if (!open) check('old build: A and B byte-identical', changedAB.length === 0, changedAB);
    else console.log(`  (EXPECT=open) old build changed: ${changedAB.join(', ') || 'none'}`);
    // the same old build still works as a person / customer, reads, and can recover
    r = await call(oldBuild, 'POST', '/rpc/set_my_notification_group', { group_param: 'messages', enabled_param: true });
    check('old build: person-level setting still saves', r.status < 300, r);
    r = await call(oldBuild, 'GET', `/brand_partners?id=eq.${B}&select=id`);
    check('old build: reads still work (GET)', r.status === 200, r);
    r = await call(oldBuild, 'POST', '/rpc/get_business_opportunities', { partner_id_param: B });
    check('old build: a read-only business function still answers', r.status === 200 || (r.json?.hint !== HINT_OLD && r.json?.hint !== HINT), r);
    r = await call(oldBuild, 'POST', '/rpc/select_managed_business', { partner_id_param: A });
    check('old build: switching still works', r.status < 300, r);
    r = await call(oldBuild, 'POST', '/stories', { user_id: OWNER, media_path: `${OWNER}/personal.jpg`, media_type: 'image' });
    check('old build: a personal story is not touched by the location check', r.json?.hint !== HINT_OLD, r);
    // single-location staff: no header still works
    r = await call({ sub: STAFF, shows: null }, 'POST', '/rpc/set_business_max_group_size', { partner_id_param: A, max_group_size_param: 8 });
    check('single-location staff, no header: saves (unchanged)', r.status < 300, r);
    // revoked membership: B removed, the account is back to one location, so the old build works again (A only)
    await db.query(`delete from private.business_memberships where user_id = $1 and partner_id = $2`, [OWNER, B]);
    r = await call(oldBuild, 'POST', '/rpc/set_business_max_group_size', { partner_id_param: A, max_group_size_param: 7 });
    check('membership B revoked, back to one location: old build saves to A', r.status < 300 && (await db.query(`select max_group_size from brand_partners where id = $1`, [A])).rows[0].max_group_size === 7, r);
    r = await call({ sub: OWNER, shows: B }, 'POST', '/rpc/set_business_max_group_size', { partner_id_param: B, max_group_size_param: 6 });
    if (!open) check('naming the revoked location B: refused', r.status === 400 && r.json?.code === 'P0001', r);
  } catch (e) {
    failed += 1; console.log(`FAIL  unexpected ${e.message}`);
  } finally {
    try { await clean(); } catch (e) { failed += 1; console.log(`FAIL  cleanup ${e.message}`); }
    const left = (await db.query(`select count(*)::int n from profiles where id = any($1::uuid[])`, [people])).rows[0].n
      + (await db.query(`select count(*)::int n from brand_partners where id = any($1::uuid[])`, [[A, B]])).rows[0].n;
    check('cleanup: no test rows left', left === 0, left);
    await db.end();
    try { sh(['rm', '-f', REST]); } catch { /* gone */ }
    console.log(`${passed} passed, ${failed} failed${open ? ' (EXPECT=open: stale-screen checks are meant to fail)' : ''}`);
    process.exit(failed ? 1 : 0);
  }
})();
