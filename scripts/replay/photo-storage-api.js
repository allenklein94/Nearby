#!/usr/bin/env node
// Profile photos through the REAL Supabase Storage API (owner, 2026-10-28; migration 20270349), on the LOCAL replay
// stack only (refuses anything else): the replay database + scripts/replay/storage-api-up.sh's storage-api container.
// Every storage call is an HTTP request with a real JWT (an ordinary signed-in person, or signed out with the anon key),
// so the Storage API itself applies the storage.objects policies, exactly as on production.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg NEARBY_LOCAL_STORAGE_URL=http://...:5000 \
//   NEARBY_LOCAL_STORAGE_KEYS=/tmp/nearby-replay/storage-keys.json node scripts/replay/photo-storage-api.js
// Checks, for another signed-in person B and a signed-out caller: a pending, rejected, replaced, abandoned or re-uploaded
// photo of A can't be listed, downloaded (authenticated / legacy / public routes, HEAD, info), signed (single + batch),
// copied or moved, and B can't write into A's folder; only A's currently approved files are readable, and only those
// can be signed; losing approval (replacement or rejection) refuses NEW signed URLs at once; A keeps every own file and
// can't overwrite in place (x-upsert, PUT, move); hiding, suspending or blocking (either way) closes every route to
// known paths at once. State-aware: on a database without 0349 it records today's exposure and
// fails the run only on a regression of what 0349 promises. Rows and files it creates are deleted afterwards.
// Residual it MEASURES, never fixes: a signed URL issued while a photo was approved keeps working until it expires.
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

const BUCKET = 'profile-photos';
const A = crypto.randomUUID();
const B = crypto.randomUUID();
let failures = 0;
const results = [];
const check = (ok, msg) => { if (!ok) failures += 1; results.push(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); console.log(results[results.length - 1]); };
const note = (msg) => console.log(`  · ${msg}`);

function jwt(sub) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 })}`;
  return `${body}.${crypto.createHmac('sha256', keys.secret).update(body).digest('base64url')}`;
}
const tokens = { A: jwt(A), B: jwt(B), anon: keys.anon };
const headers = (who, extra = {}) => ({ apikey: keys.anon, Authorization: `Bearer ${tokens[who]}`, ...extra });
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

async function call(who, method, path, { json, body, extra } = {}) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: headers(who, { ...(json ? { 'Content-Type': 'application/json' } : {}), ...(body ? { 'Content-Type': 'image/jpeg' } : {}), ...extra }),
    body: json ? JSON.stringify(json) : body,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}
const key = (name) => `${A}/${name}`;
const upload = (who, name, extra) => call(who, 'POST', `/object/${BUCKET}/${key(name)}`, { body: JPEG, extra });
const listA = async (who) => {
  const r = await call(who, 'POST', `/object/list/${BUCKET}`, { json: { prefix: `${A}/`, limit: 100 } });
  return r.ok && Array.isArray(r.data) ? r.data.map((o) => o.name).filter((n) => n && n !== '.emptyFolderPlaceholder').sort() : [];
};
const sign = async (who, name, expiresIn = 600) => {
  const r = await call(who, 'POST', `/object/sign/${BUCKET}/${key(name)}`, { json: { expiresIn } });
  return r.ok && r.data?.signedURL ? r.data.signedURL : null;
};
const signBatch = async (who, names) => {
  const r = await call(who, 'POST', `/object/sign/${BUCKET}`, { json: { paths: names.map(key), expiresIn: 600 } });
  return r.ok && Array.isArray(r.data) ? r.data.filter((x) => x.signedURL && !x.error).map((x) => x.path.split('/')[1]).sort() : [];
};
const fetchSigned = async (signedURL) => (await fetch(`${api}${signedURL.replace(/^\/storage\/v1/, '')}`)).status;

// Every way to read one file. true = some route returned it.
async function readable(who, name) {
  const routes = {
    authenticated: (await call(who, 'GET', `/object/authenticated/${BUCKET}/${key(name)}`)).ok,
    legacy: (await call(who, 'GET', `/object/${BUCKET}/${key(name)}`)).ok,
    public: (await call(who, 'GET', `/object/public/${BUCKET}/${key(name)}`)).ok,
    head: (await call(who, 'HEAD', `/object/authenticated/${BUCKET}/${key(name)}`)).ok,
    info: (await call(who, 'GET', `/object/info/authenticated/${BUCKET}/${key(name)}`)).ok,
    sign: !!(await sign(who, name)),
  };
  const open = Object.entries(routes).filter(([, v]) => v).map(([k]) => k);
  return { any: open.length > 0, open };
}
// What `who` can reach of A's photos: the listing and each named file.
async function reach(who, names) {
  const files = [];
  for (const n of names) if ((await readable(who, n)).any) files.push(n);
  return { listed: await listA(who), files: files.sort() };
}

let db;
async function asUser(sub, sql, params = []) {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })]);
    await db.query('set local role authenticated');
    const r = await db.query(sql, params);
    await db.query('commit');
    return r;
  } catch (e) { await db.query('rollback'); throw e; }
}
let fixed = false;
// moderate-photo's verdict, as the service role: 0349's two calls, or (before 0349) its direct write.
async function screen(extraId, safe, { target } = {}) {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    await db.query('set local role service_role');
    let applied;
    if (fixed) {
      const t = target || (await db.query('select * from photo_screening_target($1, $2)', [A, extraId])).rows[0];
      applied = (await db.query('select record_photo_screening($1, $2, $3, $4, $5) as a', [A, extraId, t.path, t.object_id, safe])).rows[0].a;
    } else {
      if (extraId) await db.query('update profile_photos set photo_verified = $2 where id = $1', [extraId, safe]);
      else await db.query('update profiles set photo_verified = $2 where id = $1', [A, safe]);
      applied = safe;
    }
    await db.query('commit');
    return applied;
  } catch (e) { await db.query('rollback'); throw e; }
}
async function target(extraId) {
  await db.query('begin');
  await db.query('set local role service_role');
  const t = (await db.query('select * from photo_screening_target($1, $2)', [A, extraId])).rows[0];
  await db.query('commit');
  return t;
}
const setMain = (name) => asUser(A, `update profiles set photo_url = $2, photo_verified = false where id = $1`, [A, key(name)]);
const addExtra = async (name, position) => (await asUser(A,
  `insert into profile_photos (user_id, photo_url, position, photo_verified) values ($1, $2, $3, false) returning id`, [A, key(name), position])).rows[0].id;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  db = new Client({ connectionString: dbUrl });
  await db.connect();
  fixed = (await db.query(`select to_regprocedure('public.record_photo_screening(uuid,uuid,text,uuid,boolean)') is not null as f`)).rows[0].f;
  console.log(`photo-storage-api: database ${fixed ? 'WITH' : 'WITHOUT'} 0349's photo binding; Storage API ${api}`);
  for (const [id, n] of [[A, 'a'], [B, 'b']]) {
    await db.query(`insert into auth.users (id, email, aud, role, created_at, phone, phone_confirmed_at)
                    values ($1, $2, 'authenticated', 'authenticated', now() - interval '30 days', $3, now())`,
      [id, `photo-storage-${n}-${id.slice(0, 8)}@example.invalid`, `+1555${Math.floor(1e6 + Math.random() * 8e6)}`]);
    await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
                    values ($1, $2, date '1994-05-01', now() - interval '30 days', now(), 'America/New_York', false, false)`, [id, `Photo Storage ${n}`]);
  }
  const all = ['main-1.jpg', 'extra-1.jpg', 'extra-2.jpg', 'abandoned.jpg', 'main-2.jpg', 'main-3.jpg'];
  try {
    // 1. a new main photo, before and after screening
    check((await upload('A', 'main-1.jpg')).ok, 'A uploads main-1 through the Storage API');
    await setMain('main-1.jpg');
    const pending = await reach('B', ['main-1.jpg']);
    const anonPending = await reach('anon', ['main-1.jpg']);
    if (fixed) check(eq(pending, { listed: [], files: [] }), `B can't list/read/sign A's pending main photo (${JSON.stringify(pending)})`);
    else note(`today: B reaches A's pending main photo? ${JSON.stringify(pending)}`);
    check(eq(anonPending, { listed: [], files: [] }), 'signed out: nothing of A listed, read or signed');
    check(await screen(null, true) === true, 'main-1 passes screening');
    const signedMain1 = await sign('B', 'main-1.jpg', 600);
    check(!!signedMain1 && (await fetchSigned(signedMain1)) === 200, 'B gets a working 10-minute signed URL for the approved main-1');

    // 2. pending extra, abandoned upload (no row), rejected extra
    await upload('A', 'extra-1.jpg');
    await upload('A', 'abandoned.jpg');
    const e1 = await addExtra('extra-1.jpg', 1);
    await upload('A', 'extra-2.jpg');
    const e2 = await addExtra('extra-2.jpg', 2);
    const r2 = await reach('B', all);
    if (fixed) check(eq(r2, { listed: ['main-1.jpg'], files: ['main-1.jpg'] }), `pending extra + abandoned upload stay private, only main-1 reachable (${JSON.stringify(r2)})`);
    else note(`today, with main-1 approved B reaches: ${JSON.stringify(r2)}`);
    await screen(e1, true);
    await screen(e2, false);
    const r3 = await reach('B', all);
    const r3batch = await signBatch('B', all);
    if (fixed) {
      check(eq(r3, { listed: ['extra-1.jpg', 'main-1.jpg'], files: ['extra-1.jpg', 'main-1.jpg'] }), `after screening: approved extra-1 reachable, rejected extra-2 + abandoned not (${JSON.stringify(r3)})`);
      check(eq(r3batch, ['extra-1.jpg', 'main-1.jpg']), `batch signing gives only the approved files (${JSON.stringify(r3batch)})`);
    } else note(`today, batch signing gives B: ${JSON.stringify(r3batch)}`);

    // 3. B can't write into, copy out of, move or delete in A's folder
    check(!(await upload('B', 'planted.jpg')).ok, "B can't upload into A's folder");
    const copy = await call('B', 'POST', '/object/copy', { json: { bucketId: BUCKET, sourceKey: key('extra-2.jpg'), destinationKey: `${B}/copied.jpg` } });
    if (fixed) check(!copy.ok, `B can't copy A's rejected photo into B's own folder (${copy.status})`);
    else note(`today: B copying A's rejected photo -> ${copy.status}`);
    const del = await call('B', 'DELETE', `/object/${BUCKET}`, { json: { prefixes: [key('main-1.jpg')] } });
    check(Array.isArray(del.data) ? del.data.length === 0 : !del.ok, "B can't delete A's file");
    const moveB = await call('B', 'POST', '/object/move', { json: { bucketId: BUCKET, sourceKey: key('main-1.jpg'), destinationKey: `${B}/moved.jpg` } });
    check(!moveB.ok, "B can't move A's file");
    const signUpB = await call('B', 'POST', `/object/upload/sign/${BUCKET}/${key('planted2.jpg')}`, {});
    check(!signUpB.ok, `B can't get a signed upload URL into A's folder (${signUpB.status})`);

    // 4. A replaces the main photo: main-1 (replaced) and main-2 (pending) both private at once; old URL = residual
    await upload('A', 'main-2.jpg');
    await setMain('main-2.jpg');
    const r4 = await reach('B', ['main-1.jpg', 'main-2.jpg']);
    if (fixed) check(eq(r4, { listed: [], files: [] }), `replacing: the replaced main-1 and pending main-2 unreachable, no NEW signed URL; extras hidden until the new main passes (${JSON.stringify(r4)})`);
    else note(`today, after replacement B reaches: ${JSON.stringify(r4)}`);
    const oldUrlStatus = signedMain1 ? await fetchSigned(signedMain1) : null;
    note(`RESIDUAL: the signed URL B got for main-1 before the replacement still returns ${oldUrlStatus} (valid to its expiry)`);
    // late verdict: screening read main-2, A replaced it with main-3 before the verdict landed
    const t2 = fixed ? await target(null) : null;
    await upload('A', 'main-3.jpg');
    await setMain('main-3.jpg');
    if (fixed) {
      check(await screen(null, true, { target: t2 }) === false, 'a late "safe" verdict for main-2 is refused after the replacement');
      check(!(await readable('B', 'main-3.jpg')).any && !(await readable('B', 'main-2.jpg')).any, 'neither main-2 nor main-3 becomes reachable from it');
    }

    // 5. approval, then rejection: new signed URLs refused at once
    check(await screen(null, true) === true, 'main-3 passes screening');
    const signedMain3 = await sign('B', 'main-3.jpg', 600);
    check(!!signedMain3, 'B can sign the approved main-3');
    await screen(null, false);
    const afterReject = await readable('B', 'main-3.jpg');
    if (fixed) check(!afterReject.any, `rejecting main-3 refuses every route and NEW signed URLs at once (${afterReject.open})`);
    else check(!afterReject.any, `rejected main-3 not reachable (${afterReject.open})`);
    note(`RESIDUAL: main-3's earlier signed URL after rejection returns ${await fetchSigned(signedMain3)} (valid to its expiry)`);

    // 6. same path, new object: approved again, then A deletes + re-uploads at that path; overwrite in place refused
    await screen(null, true);
    const ups = await upload('A', 'main-3.jpg', { 'x-upsert': 'true' });
    const put = await call('A', 'PUT', `/object/${BUCKET}/${key('main-3.jpg')}`, { body: JPEG });
    if (fixed) {
      check(!ups.ok, `A can't overwrite an approved file in place with x-upsert (${ups.status})`);
      check(!put.ok, `A can't overwrite in place with PUT (${put.status})`);
    } else note(`today: A overwriting main-3 in place -> upsert ${ups.status}, PUT ${put.status}`);
    const moveA = await call('A', 'POST', '/object/move', { json: { bucketId: BUCKET, sourceKey: key('abandoned.jpg'), destinationKey: key('moved.jpg') } });
    if (fixed) check(!moveA.ok, `A can't move/rename a file (would keep its object id under a new name) (${moveA.status})`);
    else note(`today: A moving a file -> ${moveA.status}`);
    const delA = await call('A', 'DELETE', `/object/${BUCKET}`, { json: { prefixes: [key('main-3.jpg')] } });
    check(Array.isArray(delA.data) && delA.data.length === 1, 'A can delete own file');
    await upload('A', 'main-3.jpg');
    const r6 = await readable('B', 'main-3.jpg');
    if (fixed) check(!r6.any, `a NEW file at the approved path is not reachable by B (${r6.open})`);
    else note(`today: a new file re-uploaded at the approved path, B reaches it? ${r6.any} (${r6.open})`);

    // 7. the owner keeps everything; signed out still nothing
    const own = await listA('A');
    const expectOwn = (moveA.ok ? ['moved.jpg'] : ['abandoned.jpg']).concat(['extra-1.jpg', 'extra-2.jpg', 'main-1.jpg', 'main-2.jpg', 'main-3.jpg']).sort();
    check(eq(own, expectOwn), `A lists every own file (${JSON.stringify(own)})`);
    const ownRead = [];
    for (const n of own) if ((await readable('A', n)).any && (await sign('A', n))) ownRead.push(n);
    check(eq(ownRead, own), 'A can read and sign every own file (incl. pending and rejected, for editing)');
    const anon = await reach('anon', all);
    check(eq(anon, { listed: [], files: [] }), `signed out: nothing listed, read, signed or public (${JSON.stringify(anon)})`);

    // 8. visibility of the PROFILE, not only the file's screening (owner, 2026-10-28): hidden, suspended, blocked either
    // way. B already knows the exact paths (direct known-path requests on every route, single + batch signing).
    await screen(null, true); // the re-uploaded main-3 passes: B reaches main-3 + extra-1 again
    const approved = ['extra-1.jpg', 'main-3.jpg'];
    const extraRowsB = async () => (await asUser(B, 'select id from profile_photos where user_id = $1', [A])).rowCount;
    const r8 = await reach('B', all);
    check(eq(r8.files, approved), `baseline: B reaches A's approved files (${JSON.stringify(r8.files)})`);
    const signed8 = await sign('B', 'main-3.jpg', 600);
    const cut = async (label) => {
      const r = await reach('B', all);
      const batch = await signBatch('B', all);
      const rows = await extraRowsB();
      const closed = eq(r, { listed: [], files: [] }) && batch.length === 0 && rows === 0;
      if (fixed) check(closed, `${label}: B can't list, read, sign (single or batch) A's known paths or read A's extra-photo rows (${JSON.stringify({ ...r, batch, rows })})`);
      else note(`today, ${label}: B reaches ${JSON.stringify({ ...r, batch, rows })}`);
      const ownOk = (await readable('A', 'main-3.jpg')).any && !!(await sign('A', 'main-3.jpg'));
      check(ownOk, `${label}: A still reads and signs own photo`);
    };
    const back = async (label) => {
      const r = await reach('B', all);
      check(eq(r.files, approved), `${label}: B reaches the approved files again (${JSON.stringify(r.files)})`);
    };
    await asUser(A, 'update profiles set profile_hidden = true where id = $1', [A]);
    await cut('A hides the profile');
    await asUser(A, 'update profiles set profile_hidden = false where id = $1', [A]);
    await back('A unhides');
    await asUser(A, 'insert into blocks (blocker_id, blocked_id) values ($1, $2)', [A, B]);
    await cut('A blocks B');
    await db.query('delete from blocks where blocker_id = $1 and blocked_id = $2', [A, B]);
    await back('A unblocks B');
    await asUser(B, 'insert into blocks (blocker_id, blocked_id) values ($1, $2)', [B, A]);
    await cut('B blocks A');
    await db.query('delete from blocks where blocker_id = $1 and blocked_id = $2', [B, A]);
    await back('B unblocks A');
    const hasSuspension = (await db.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'suspended_at'`)).rowCount > 0;
    if (hasSuspension) {
      // as admin_suspend_user does (20270351): suspended + hidden in one write
      await db.query('update profiles set suspended_at = now(), profile_hidden = true where id = $1', [A]);
      await cut('A is suspended');
      await db.query('update profiles set suspended_at = null, profile_hidden = false where id = $1', [A]);
      await back('A is reinstated');
    } else note('suspension: 20270351 not applied on this database, not checked');
    note(`RESIDUAL: the signed URL B got for main-3 before hiding/blocking returns ${signed8 ? await fetchSigned(signed8) : 'n/a'} (valid to its expiry, at most 15 min from the app)`);
  } finally {
    await db.query(`delete from storage.objects where bucket_id = $1 and (name like $2 or name like $3)`, [BUCKET, `${A}/%`, `${B}/%`]);
    await db.query('delete from profile_photos where user_id = any($1)', [[A, B]]);
    await db.query('delete from blocks where blocker_id = any($1) or blocked_id = any($1)', [[A, B]]);
    await db.query('delete from profiles where id = any($1)', [[A, B]]);
    await db.query('delete from auth.users where id = any($1)', [[A, B]]);
    await db.end();
  }
  console.log(failures ? `photo-storage-api: ${failures} FAILED` : 'photo-storage-api: all checks passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
