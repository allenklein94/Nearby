// Items 146/147/148: the signed-in real-API test (owner-approved 2026-10-20). Database-level journeys prove the policies; this proves
// the REAL PostgREST API, with real signed-in JWTs, enforces them. It is the only live-verify script that writes to production, so:
//   - two dedicated accounts, created only at run time, clearly named (signed-in-api-test-<run>-a/b@nearby-app.test, display name
//     "API test"), no friends, no communities, no gender: B is a pure signed-in stranger to A;
//   - A creates ONE friends-only gathering (discoverable = to its own audience, CHECK gatherings_discoverable_needs_everyone) at an open-ocean point (the "new gathering nearby" push returns early
//     for anything not public, so nobody is notified);
//   - cleanup runs in `finally` (even on failure): the gathering, its plan and events (the location pin is computed, never stored), then both accounts; then EVERY
//     uuid column in public / private / auth / storage is scanned for the run's ids and the result printed. Nothing is claimed
//     clean unless that scan returns zero.
// Run: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/signed-in-api-privacy.js
const crypto = require('crypto');
const { runSql } = require('./lib/db');

const REF = process.env.SUPABASE_PROJECT_REF || 'enmosvippabmuqslzrox';
const URL = `https://${REF}.supabase.co`;
const RUN = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`;
const OCEAN = { lat: 0.5, lng: -160.5 };

async function keys() {
  // The legacy anon / service_role JWT keys are disabled on this project (2026-07-23): the new publishable + secret keys.
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, { headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` } });
  const list = await r.json();
  const get = (type) => list.find((k) => k.type === type)?.api_key;
  if (!get('publishable') || !get('secret')) throw new Error('could not read the project API keys');
  return { anon: get('publishable'), service: get('secret') };
}

async function call(method, path, { key, jwt, body, prefer } = {}) {
  // New-style keys go in `apikey` only; Authorization carries a real user JWT when signed in.
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${URL}${path}`, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: r.status, body: json };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`);
}
const denied = (res) => res.status >= 400 && /permission denied|42501/i.test(JSON.stringify(res.body));

(async () => {
  const k = await keys();
  const ids = { users: [], gathering: null };
  try {
    // ---- setup: two accounts through the real Auth admin API, signed in through the real password grant
    const accounts = {};
    for (const who of ['a', 'b']) {
      const email = `signed-in-api-test-${RUN}-${who}@nearby-app.test`;
      const password = crypto.randomBytes(18).toString('base64url');
      const created = await call('POST', '/auth/v1/admin/users', { key: k.service, body: { email, password, email_confirm: true, user_metadata: { purpose: 'signed-in-api-test', run: RUN } } });
      if (!created.body?.id) throw new Error(`create ${who}: ${created.status} ${JSON.stringify(created.body)}`);
      ids.users.push(created.body.id);
      const session = await call('POST', '/auth/v1/token?grant_type=password', { key: k.anon, body: { email, password } });
      if (!session.body?.access_token) throw new Error(`sign in ${who}: ${session.status}`);
      accounts[who] = { id: created.body.id, jwt: session.body.access_token };
      // the profile row a real person has, written by the person themself (as the app does)
      const prof = await call('POST', '/rest/v1/profiles', { key: k.anon, jwt: accounts[who].jwt, prefer: 'return=minimal',
        body: { id: created.body.id, display_name: `API test ${who.toUpperCase()}`, birthdate: '1990-01-01' } });
      if (prof.status >= 300) throw new Error(`profile ${who}: ${prof.status} ${JSON.stringify(prof.body)}`);
    }
    const A = accounts.a; const B = accounts.b;
    console.log(`run ${RUN}: accounts created + signed in`);

    const g = await call('POST', '/rest/v1/gatherings?select=id', { key: k.anon, jwt: A.jwt, prefer: 'return=representation',
      body: { host_id: A.id, title: 'API privacy test (auto-deleted)', scheduled_at: new Date(Date.now() + 86400e3).toISOString(),
        precise_lat: OCEAN.lat, precise_lng: OCEAN.lng, interest_tag: 'Coffee', area: 'api-test', capacity: 4,
        visibility: 'friends', is_public: false, discoverable: true, show_on_map: false } });
    ids.gathering = g.body?.[0]?.id ?? null;
    check('A (signed in) creates a friends-only gathering through the API', g.status === 201 && ids.gathering, g.status === 201 ? undefined : g.body);
    if (!ids.gathering) throw new Error('no gathering');
    const G = ids.gathering;

    // ---- item 147: non-public rows
    const aOwn = await call('GET', `/rest/v1/gatherings?select=id,visibility&id=eq.${G}`, { key: k.anon, jwt: A.jwt });
    check('control: the host reads their own friends-only gathering', aOwn.status === 200 && aOwn.body.length === 1);
    const bById = await call('GET', `/rest/v1/gatherings?select=id&id=eq.${G}`, { key: k.anon, jwt: B.jwt });
    check('147: a signed-in stranger reading it by id gets nothing', bById.status === 200 && bById.body.length === 0, bById.body);
    const expected = (await runSql(`select coalesce(jsonb_agg(id order by id), '[]') ids from gatherings
      where visibility = 'everyone' and not coalesce(women_only, false)`))[0].ids;
    const bAll = await call('GET', '/rest/v1/gatherings?select=id&order=id', { key: k.anon, jwt: B.jwt });
    const got = (bAll.body ?? []).map((r) => r.id);
    check('147: the stranger\'s full list = exactly the public, non-women-only rows (the policy\'s answer)',
      bAll.status === 200 && JSON.stringify(got) === JSON.stringify(expected) && !got.includes(G), { got: got.length, expected: expected.length });
    const anon = await call('GET', '/rest/v1/gatherings?select=id&limit=5', { key: k.anon });
    check('147: signed out sees no gathering rows', anon.status === 200 && anon.body.length === 0, anon.body);
    const counts = await call('POST', '/rest/v1/rpc/get_gathering_approved_counts', { key: k.anon, jwt: B.jwt, body: { gathering_ids: [G] } });
    check('147: an id-list RPC gives the stranger nothing for it', counts.status === 200 && !JSON.stringify(counts.body).includes(G), counts.body);
    const dist = await call('POST', '/rest/v1/rpc/get_gathering_distances', { key: k.anon, jwt: B.jwt, body: { my_lat: OCEAN.lat, my_lng: OCEAN.lng, gathering_ids: [G] } });
    check('147/146: the distance RPC gives the stranger nothing for it', dist.status === 200 && !JSON.stringify(dist.body).includes(G), dist.body);

    // ---- item 146: the precise point
    const bPrecise = await call('GET', '/rest/v1/gatherings?select=precise_lat,precise_lng&limit=1', { key: k.anon, jwt: B.jwt });
    check('146: precise_lat/lng are not selectable by a signed-in user', denied(bPrecise), bPrecise.status);
    const aPrecise = await call('GET', `/rest/v1/gatherings?select=precise_lat&id=eq.${G}`, { key: k.anon, jwt: A.jwt });
    check('146: not even by the host (the point comes only from get_gathering_meetup_point)', denied(aPrecise), aPrecise.status);
    const bPoint = await call('POST', '/rest/v1/rpc/get_gathering_meetup_point', { key: k.anon, jwt: B.jwt, body: { gathering_id_param: G } });
    const bPointLeak = JSON.stringify(bPoint.body ?? '').includes(String(OCEAN.lng));
    check('146: the stranger cannot get the meet-up point', !bPointLeak, { status: bPoint.status, body: bPoint.body });
    const aPoint = await call('POST', '/rest/v1/rpc/get_gathering_meetup_point', { key: k.anon, jwt: A.jwt, body: { gathering_id_param: G } });
    check('146 control: the host gets the meet-up point', aPoint.status === 200 && JSON.stringify(aPoint.body).includes(String(OCEAN.lng)), aPoint.status);
    const oracle = await call('POST', '/rest/v1/rpc/count_gatherings_near_batch', { key: k.anon, jwt: B.jwt, body: {} });
    check('146: the place-count oracle is gone from the API', oracle.status === 404, oracle.status);

    // ---- Interested is private: host-only aggregate
    const bInt = await call('POST', '/rest/v1/rpc/get_gathering_interested_count', { key: k.anon, jwt: B.jwt, body: { gathering_id_param: G } });
    check('Interested count: refused / empty for a non-host', bInt.status >= 400 || bInt.body == null, { status: bInt.status, body: bInt.body });
    const aInt = await call('POST', '/rest/v1/rpc/get_gathering_interested_count', { key: k.anon, jwt: A.jwt, body: { gathering_id_param: G } });
    check('Interested count control: the host gets 0', aInt.status === 200 && Number(aInt.body) === 0, aInt.body);

    // ---- item 148: story / sighting location columns
    const sLat = await call('GET', '/rest/v1/stories?select=latitude,longitude&limit=1', { key: k.anon, jwt: B.jwt });
    check('148: stories.latitude/longitude are not selectable', denied(sLat), sLat.status);
    const sArea = await call('GET', '/rest/v1/sightings?select=approx_area&limit=1', { key: k.anon, jwt: B.jwt });
    check('148: sightings.approx_area is not selectable', denied(sArea), sArea.status);
    const sOwn = await call('GET', '/rest/v1/sightings?select=id', { key: k.anon, jwt: B.jwt });
    check('148: a stranger sees no one else\'s sightings', sOwn.status === 200 && sOwn.body.length === 0, sOwn.body);
  } catch (e) {
    check(`run aborted: ${e.message}`, false);
  } finally {
    // ---- cleanup, always
    const uidList = ids.users.map((u) => `'${u}'`).join(',') || 'null';
    const g = ids.gathering ? `'${ids.gathering}'` : 'null';
    try {
      await runSql(`begin;
        delete from gatherings where id = ${g};
        delete from plans where created_by in (${uidList}) or resulting_gathering_id = ${g};
        delete from domain_events where object_id = ${g} or actor_id in (${uidList}) or object_id in (${uidList});
        commit;`);
    } catch (e) { console.log(`cleanup SQL error: ${e.message}`); }
    for (const u of ids.users) {
      const d = await call('DELETE', `/auth/v1/admin/users/${u}`, { key: k.service });
      console.log(`delete account ${u}: ${d.status}`);
    }
    // ---- verify: every uuid column in public/private/auth/storage, scanned for the run's ids
    const all = [...ids.users, ids.gathering].filter(Boolean);
    if (all.length) try {
      const arr = `array[${all.map((x) => `'${x}'::uuid`).join(',')}]`;
      const left = await runSql(`do $$ declare r record; n bigint; out jsonb := '[]'; begin
        for r in select table_schema s, table_name t, column_name c from information_schema.columns
                 where data_type = 'uuid' and table_schema in ('public','private','auth','storage')
                   and (table_schema, table_name) in (select table_schema, table_name from information_schema.tables where table_type = 'BASE TABLE') loop
          execute format('select count(*) from %I.%I where %I = any($1)', r.s, r.t, r.c) into n using ${arr};
          if n > 0 then out := out || jsonb_build_object('table', r.s || '.' || r.t, 'column', r.c, 'rows', n); end if;
        end loop;
        perform set_config('scan.out', out::text, false); end $$; select current_setting('scan.out')::jsonb leftover;`);
      const leftover = left[left.length - 1]?.leftover ?? left[0]?.leftover;
      const emails = await runSql(`select count(*) n from auth.users where email like 'signed-in-api-test-${RUN}-%'`);
      check('cleanup: no row anywhere references the test accounts or gathering', Array.isArray(leftover) && leftover.length === 0, leftover);
      check('cleanup: no auth account with this run\'s email remains', Number(emails[0].n) === 0, emails[0]);
    } catch (e) {
      check(`cleanup scan could not run (NOT verified clean; ids ${JSON.stringify(all)}): ${e.message}`, false);
    }
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} passed (run ${RUN})`);
    process.exitCode = failed ? 1 : 0;
  }
})();
