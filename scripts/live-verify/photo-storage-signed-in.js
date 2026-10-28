#!/usr/bin/env node
// Profile photos through PRODUCTION's real Storage API as an ordinary signed-in person and signed out (owner, 2026-10-28;
// with 20270349). READ-ONLY: lists folders and asks for signed URLs; never uploads, downloads file contents, moves or
// deletes. For every OTHER person's photo folder it compares what the test account can list / sign with what is
// currently approved (main photo passed + current, or an extra that passed, with the main approved), and signed out
// it expects nothing. Prints counts only, never paths, ids or URLs.
//   Before 20270349: reports today's exposure (exit 0). After: any unapproved file listed or signable = FAIL (exit 1).
// Credentials: the DEDICATED test account only (never the owner's): NEARBY_TEST_EMAIL / NEARBY_TEST_PASSWORD, else the
// gitignored .claude/live-test-account.json. SUPABASE_ACCESS_TOKEN reads the approved set (Management API, read-only).
//   node scripts/live-verify/photo-storage-signed-in.js
const fs = require('fs');
const path = require('path');
const { runSql } = require('./lib/db');

const URL = 'https://enmosvippabmuqslzrox.supabase.co';
const ANON = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW';
const BUCKET = 'profile-photos';
let file = {};
try { file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '.claude', 'live-test-account.json'), 'utf8')); } catch { /* env only */ }
const EMAIL = process.env.NEARBY_TEST_EMAIL || file.email;
const PASSWORD = process.env.NEARBY_TEST_PASSWORD || file.password;
if (!EMAIL || !PASSWORD) { console.error('No dedicated test account credentials.'); process.exit(2); }

async function storage(token, method, p, json) {
  const res = await fetch(`${URL}/storage/v1${p}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  const auth = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json());
  if (!auth.access_token) { console.error('Sign-in failed for the test account.'); process.exit(2); }
  const me = auth.user.id;
  const [state] = await runSql(`select
      to_regprocedure('public.record_photo_screening(uuid,uuid,text,uuid,boolean)') is not null as fixed,
      (select coalesce(jsonb_agg(distinct (storage.foldername(name))[1]), '[]') from storage.objects where bucket_id = '${BUCKET}') as folders,
      (select coalesce(jsonb_agg(name), '[]') from storage.objects o where bucket_id = '${BUCKET}' and (
         exists (select 1 from profiles p where p.photo_url = o.name and p.photo_verified)
         or exists (select 1 from profile_photos pp join profiles p on p.id = pp.user_id
                     where pp.photo_url = o.name and pp.photo_verified and p.photo_verified and not coalesce(p.profile_hidden, false)))) as approved,
      (select count(*) from storage.objects where bucket_id = '${BUCKET}') as total`);
  const approved = new Set(state.approved);
  const others = state.folders.filter((f) => f !== me);
  let listedBad = 0; let signedBad = 0; let listedOk = 0; let signedOk = 0; let anonAny = 0; let files = 0;
  for (const folder of others) {
    const names = (await runSql(`select coalesce(jsonb_agg(name), '[]') as n from storage.objects where bucket_id = '${BUCKET}' and name like '${folder.replace(/'/g, "''")}/%'`))[0].n;
    files += names.length;
    const list = await storage(auth.access_token, 'POST', `/object/list/${BUCKET}`, { prefix: `${folder}/`, limit: 1000 });
    for (const o of Array.isArray(list.data) ? list.data : []) {
      if (!o.id) continue;
      if (approved.has(`${folder}/${o.name}`)) listedOk += 1; else listedBad += 1;
    }
    const signed = await storage(auth.access_token, 'POST', `/object/sign/${BUCKET}`, { paths: names, expiresIn: 60 });
    for (const s of Array.isArray(signed.data) ? signed.data : []) {
      if (!s.signedURL || s.error) continue;
      if (approved.has(s.path)) signedOk += 1; else signedBad += 1;
    }
    const anonList = await storage(ANON, 'POST', `/object/list/${BUCKET}`, { prefix: `${folder}/`, limit: 1000 });
    const anonSign = await storage(ANON, 'POST', `/object/sign/${BUCKET}`, { paths: names, expiresIn: 60 });
    anonAny += (Array.isArray(anonList.data) ? anonList.data.filter((o) => o.id).length : 0)
      + (Array.isArray(anonSign.data) ? anonSign.data.filter((s) => s.signedURL && !s.error).length : 0);
  }
  console.log(`photo-storage-signed-in: database ${state.fixed ? 'WITH' : 'WITHOUT'} 20270349; ${others.length} other folders, ${files} files, ${[...approved].filter((n) => !n.startsWith(`${me}/`)).length} approved`);
  console.log(`  signed in: listed ${listedOk} approved + ${listedBad} NOT approved; signable ${signedOk} approved + ${signedBad} NOT approved`);
  console.log(`  signed out: ${anonAny} listed or signable`);
  const bad = listedBad + signedBad + anonAny;
  if (!state.fixed) { console.log(`  (before 20270349: ${listedBad + signedBad} unapproved exposures recorded, not a failure)`); return anonAny ? 1 : 0; }
  console.log(bad ? `photo-storage-signed-in: FAIL (${bad})` : 'photo-storage-signed-in: all checks passed');
  return bad ? 1 : 0;
}
main().then((c) => process.exit(c)).catch((e) => { console.error(e.message); process.exit(1); });
