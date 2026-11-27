#!/usr/bin/env node
// Minimum supported app version (20270434) for Storage WRITES, through the REAL Supabase Storage API on the LOCAL replay
// stack only (scripts/replay/storage-api-up.sh). Storage requests never pass PostgREST's pre-request hook; 0434's
// restrictive storage.objects policies ask the same gate from the request.headers the Storage API sets. Proves: with iOS
// enforced at 90, an upload / overwrite / delete from build 89 or the native "Nearby/87" user agent is refused and leaves
// nothing behind, build 90 goes through, reads stay open; strict mode refuses an unidentified upload; service role passes;
// switching off takes effect on the next request. A throwaway bucket with permissive policies is created and removed.
// MUTATE=1: runs with 0434's three storage policies dropped (then restored); every refusal check must then fail.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg NEARBY_LOCAL_STORAGE_URL=http://...:5000 \
//   NEARBY_LOCAL_STORAGE_KEYS=/tmp/nearby-replay/storage-keys.json node scripts/replay/version-gate-storage-local.js
const dbUrl = process.env.NEARBY_LOCAL_DB_URL;
const api = process.env.NEARBY_LOCAL_STORAGE_URL;
const local = /^(postgres:\/\/[^@]+@|http:\/\/)(localhost|127\.|172\.|10\.|192\.168\.)/;
if (!dbUrl || !api || !local.test(dbUrl) || !local.test(api)) {
  console.error('NEARBY_LOCAL_DB_URL and NEARBY_LOCAL_STORAGE_URL must point at the local replay stack.');
  process.exit(2);
}
const fs = require('fs');
const crypto = require('crypto');
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const keys = JSON.parse(fs.readFileSync(process.env.NEARBY_LOCAL_STORAGE_KEYS, 'utf8'));
const mutate = process.env.MUTATE === '1';

const BUCKET = 'version-gate-test';
const U = crypto.randomUUID();
const OLD_UA = 'Nearby/87 CFNetwork/3826.500.111 Darwin/25.0.0';
let failed = 0; let passed = 0;
const check = (name, ok, detail) => {
  if (ok) { passed += 1; console.log(`  ok  ${name}`); } else { failed += 1; console.log(`FAIL  ${name} ${detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)}`); }
};
const refusal = (name, ok, detail) => check(mutate ? `${name} (policies dropped: goes through)` : name, mutate ? !ok : ok, detail);

function jwt(claims) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ iat: now, exp: now + 3600, ...claims })}`;
  return `${body}.${crypto.createHmac('sha256', keys.secret).update(body).digest('base64url')}`;
}
const userToken = jwt({ sub: U, role: 'authenticated', aud: 'authenticated' });
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

async function call(method, path, { build, ua, token = userToken, body, json } = {}) {
  const headers = { apikey: keys.anon, Authorization: `Bearer ${token}` };
  if (build !== undefined) { headers['x-nearby-build'] = String(build); headers['x-nearby-platform'] = 'ios'; }
  if (ua) headers['User-Agent'] = ua;
  if (body) headers['Content-Type'] = 'image/png';
  if (json) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${api}${path}`, { method, headers, body: json ? JSON.stringify(json) : body });
  const text = await res.text();
  return { status: res.status, ok: res.ok, data: text.slice(0, 200) };
}
const up = (name, opts) => call('POST', `/object/${BUCKET}/${U}/${name}`, { body: PNG, ...opts });
const over = (name, opts) => call('PUT', `/object/${BUCKET}/${U}/${name}`, { body: PNG, ...opts });
const del = (name, opts) => call('DELETE', `/object/${BUCKET}/${U}/${name}`, opts);
const get = (name, opts) => call('GET', `/object/authenticated/${BUCKET}/${U}/${name}`, opts);

(async () => {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  const q = (sql, args) => db.query(sql, args);
  const exists = async (name) => (await q('select 1 from storage.objects where bucket_id = $1 and name = $2', [BUCKET, `${U}/${name}`])).rowCount > 0;
  let saved = [];
  try {
    if (!(await q(`select to_regproc('public.app_version_allows') is not null x`)).rows[0].x) throw new Error('0434 is not installed');
    await q(`insert into storage.buckets (id, name, public) values ($1, $1, false) on conflict do nothing`, [BUCKET]);
    for (const cmd of ['select', 'insert', 'update', 'delete']) {
      const clause = cmd === 'insert' ? `with check (bucket_id = '${BUCKET}')` : cmd === 'update' ? `using (bucket_id = '${BUCKET}') with check (bucket_id = '${BUCKET}')` : `using (bucket_id = '${BUCKET}')`;
      await q(`create policy vg_test_${cmd} on storage.objects for ${cmd} to authenticated ${clause}`);
    }
    if (mutate) {
      saved = (await q(`select 'create policy '||quote_ident(policyname)||' on storage.objects as restrictive for '||cmd||' to '||array_to_string(roles, ', ')||coalesce(' using ('||qual||')','')||coalesce(' with check ('||with_check||')','') s
        from pg_policies where schemaname = 'storage' and policyname like 'nearby_app_version_%'`)).rows.map((r) => r.s);
      for (const p of ['insert', 'update', 'delete']) await q(`drop policy nearby_app_version_${p} on storage.objects`);
    }
    await q(`insert into private.app_build_availability (platform, build, channel, recorded_by, evidence) values ('ios', 90, 'testflight', 'version-gate-storage-local', 'local test fixture') on conflict do nothing`);
    await q(`update private.app_version_policy set min_supported_build = 90, latest_build = 90, enforced = true, update_url = 'itms-beta://testflight.apple.com/v1/app/0' where platform = 'ios'`);

    const r89 = await up('a89.png', { build: 89 });
    refusal('upload from build 89 refused, nothing stored', !r89.ok && !(await exists('a89.png')), r89);
    const rUa = await up('a87.png', { ua: OLD_UA });
    refusal('upload from the native Nearby/87 user agent refused', !rUa.ok && !(await exists('a87.png')), rUa);
    const r90 = await up('a90.png', { build: 90 });
    check('upload from build 90 stored', r90.ok && (await exists('a90.png')), r90);
    const rOver = await over('a90.png', { build: 89 });
    refusal('overwrite from build 89 refused', !rOver.ok, rOver);
    const rDel = await del('a90.png', { build: 89 });
    refusal('delete from build 89 refused, file kept', !rDel.ok && (await exists('a90.png')), rDel);
    const rRead = await get('a90.png', { build: 89 });
    check('read from build 89 still allowed (reads stay open)', rRead.ok, rRead);
    const rBrowser = await up('browser.png', { ua: 'Mozilla/5.0 (Macintosh)' });
    check('strict off: an unidentified upload goes through', rBrowser.ok, rBrowser);

    await q(`update private.app_version_settings set refuse_unidentified = true, updated_by = 'version-gate-storage-local'`);
    const rStrict = await up('strict.png', {});
    refusal('strict on: an upload with no build identity refused', !rStrict.ok && !(await exists('strict.png')), rStrict);
    const rStrict95 = await up('strict95.png', { build: 95 });
    check('strict on: an identified build 95 upload stored', rStrict95.ok, rStrict95);
    const rSvc = await up('svc.png', { token: keys.service });
    check('strict on: service role upload with no build passes', rSvc.ok, rSvc);
    await q(`update private.app_version_settings set refuse_unidentified = false, updated_by = 'version-gate-storage-local'`);

    await q(`update private.app_version_policy set enforced = false where platform = 'ios'`);
    const rOff = await del('a90.png', { build: 89 });
    check('switched off: build 89 delete goes through on the next request', rOff.ok && !(await exists('a90.png')), rOff);
  } catch (e) {
    failed += 1; console.log(`FAIL  run aborted: ${e.message}`);
  } finally {
    await q(`update private.app_version_policy set enforced = false, min_supported_build = null, latest_build = null, update_url = null where platform = 'ios'`).catch(() => {});
    await q(`update private.app_version_settings set refuse_unidentified = false, updated_by = 'version-gate-storage-local'`).catch(() => {});
    await q(`delete from private.app_build_availability where recorded_by = 'version-gate-storage-local'`).catch(() => {});
    for (const s of saved) await q(s).catch((e) => { failed += 1; console.log(`FAIL  restoring a policy: ${e.message}`); });
    for (const cmd of ['select', 'insert', 'update', 'delete']) await q(`drop policy if exists vg_test_${cmd} on storage.objects`).catch(() => {});
    await q(`delete from storage.objects where bucket_id = $1`, [BUCKET]).catch(() => {});
    await q(`delete from storage.buckets where id = $1`, [BUCKET]).catch(() => {});
    const left = (await q(`select count(*)::int n from pg_policies where schemaname = 'storage' and policyname like 'nearby_app_version_%'`)).rows[0].n;
    check('the three 0434 storage policies are in place after the run', left === 3, left);
    await db.end();
    console.log(`\n${passed} passed, ${failed} failed${mutate ? ' (MUTATE=1)' : ''}`);
    process.exit(failed ? 1 : 0);
  }
})();
