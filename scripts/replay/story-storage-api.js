#!/usr/bin/env node
// Stories + gathering covers through the REAL Supabase Storage API (owner, 2026-11-05; migration 20270390), on the LOCAL replay
// stack only (refuses anything else): the replay database + scripts/replay/storage-api-up.sh's storage-api container. Every
// storage call is an HTTP request with a real JWT, so the Storage API itself applies the storage.objects rules and bucket limits.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg NEARBY_LOCAL_STORAGE_URL=http://...:5000 \
//   NEARBY_LOCAL_STORAGE_KEYS=/tmp/nearby-replay/storage-keys.json node scripts/replay/story-storage-api.js
// Checks: a friends-only file is closed to a stranger; a Story naming someone else's file is refused and, even if such a row
// already exists, opens nothing; a forged 2099 expiry doesn't keep a file open; only the host can read a gathering cover, by
// every route; the buckets refuse video and oversized files. Switches are turned on only to reach the rules behind them and put
// back; rows and files it creates are deleted afterwards. Exits non-zero on the database before 20270390 (the attack succeeds).
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

const [A, F, X, D] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const G = crypto.randomUUID();
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };

function jwt(sub) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 })}`;
  return `${body}.${crypto.createHmac('sha256', keys.secret).update(body).digest('base64url')}`;
}
const tokens = { A: jwt(A), F: jwt(F), X: jwt(X), D: jwt(D), anon: keys.anon };
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

async function call(who, method, path, { json, body, type } = {}) {
  const headers = { apikey: keys.anon, Authorization: `Bearer ${tokens[who]}` };
  if (json) headers['Content-Type'] = 'application/json';
  if (body) headers['Content-Type'] = type;
  const res = await fetch(`${api}${path}`, { method, headers, body: json ? JSON.stringify(json) : body });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, data };
}
const upload = (who, bucket, name, body = JPEG, type = 'image/jpeg') => call(who, 'POST', `/object/${bucket}/${name}`, { body, type });
// Every way to read one file: true = some route returned it.
async function readable(who, bucket, name) {
  const s = await call(who, 'POST', `/object/sign/${bucket}/${name}`, { json: { expiresIn: 600 } });
  const routes = [
    s.ok && !!s.data?.signedURL,
    (await call(who, 'GET', `/object/authenticated/${bucket}/${name}`)).ok,
    (await call(who, 'GET', `/object/${bucket}/${name}`)).ok,
    (await call(who, 'GET', `/object/public/${bucket}/${name}`)).ok,
    (await call(who, 'HEAD', `/object/authenticated/${bucket}/${name}`)).ok,
    (await call(who, 'GET', `/object/info/authenticated/${bucket}/${name}`)).ok,
  ];
  return routes.some(Boolean);
}
async function listed(who, bucket, prefix) {
  const r = await call(who, 'POST', `/object/list/${bucket}`, { json: { prefix, limit: 100 } });
  return r.ok && Array.isArray(r.data) ? r.data.filter((o) => o.name && o.name !== '.emptyFolderPlaceholder').length : 0;
}

let db;
async function asUser(sub, sql, params = []) {
  await db.query('begin');
  try {
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub, role: 'authenticated' })]);
    await db.query('set local role authenticated');
    const r = await db.query(sql, params);
    await db.query('commit');
    return { ok: true, r };
  } catch (e) { await db.query('rollback'); return { ok: false, hint: e.hint, message: e.message }; }
}
const setSwitches = async (on) => {
  if ((await db.query(`select to_regclass('private.story_media_settings') t`)).rows[0].t) {
    await db.query('update private.story_media_settings set public_stories_enabled = $1, friends_stories_enabled = $1 where id', [on]);
  }
};

async function main() {
  db = new Client({ connectionString: dbUrl });
  await db.connect();
  const all = [A, F, X, D];
  try {
    for (const [i, id] of all.entries()) {
      await db.query(`insert into auth.users (id, email, aud, role, created_at, phone, phone_confirmed_at)
                      values ($1, $2, 'authenticated', 'authenticated', now() - interval '30 days', $3, now())`,
        [id, `story-storage-${i}-${id.slice(0, 8)}@example.invalid`, `+1555${Math.floor(1e6 + Math.random() * 8e6)}`]);
      await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
                      values ($1, $2, date '1994-05-01', now() - interval '30 days', now(), 'America/New_York', true, false)`, [id, `Story Storage ${i}`]);
    }
    await db.query(`insert into friendships (user_a, user_b, status, requested_by) values ($1, $2, 'accepted', $1)`, [A, F]);
    await db.query(`insert into gatherings (id, host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
                    values ($1, $2, 'Story storage', now() + interval '1 day', 26.4, -80.1, 'Volleyball', 'x', 'everyone')`, [G, A]);
    await db.query(`insert into gathering_interest (gathering_id, user_id, status) values ($1, $2, 'approved')`, [G, F]);

    console.log('Ownership');
    await setSwitches(true);
    const secret = `${A}/secret.jpg`;
    check((await upload('A', 'stories', secret)).ok, 'A uploads a photo into their own folder');
    check(!(await upload('X', 'stories', `${A}/planted.jpg`)).ok, "X can't upload into A's folder");
    const posted = await asUser(A, 'insert into stories (user_id, media_path) values ($1, $2)', [A, secret]);
    check(posted.ok, 'A posts it as a friends-only Story');
    check(await readable('F', 'stories', secret), 'friend F can read it');
    check(!(await readable('X', 'stories', secret)), "stranger X can't, by any route");
    check(!(await readable('D', 'stories', secret)), "stranger D can't either");
    const forged = await asUser(X, 'insert into stories (user_id, media_path, is_public) values ($1, $2, true)', [X, secret]);
    check(!forged.ok && forged.hint === 'story_media_not_yours', `X's public Story naming A's file is refused (${forged.hint || forged.message || 'ACCEPTED'})`);
    check(!(await readable('D', 'stories', secret)), "after that attempt D still can't read A's file");
    // the same row arriving another way (an older row, a bypassed trigger): the storage rule itself refuses
    await db.query('begin');
    await db.query(`set local session_replication_role = replica`);
    await db.query(`insert into stories (user_id, media_path, is_public, expires_at) values ($1, $2, true, now() + interval '1 day')
                    on conflict do nothing`, [X, secret]);
    await db.query('commit');
    check(!(await readable('D', 'stories', secret)), "with such a row already present, D still can't read A's file");
    await db.query('delete from stories where user_id = $1', [X]);

    console.log('Expiry');
    const pub = `${A}/public.jpg`;
    await upload('A', 'stories', pub);
    await asUser(A, `insert into stories (user_id, media_path, is_public, expires_at) values ($1, $2, true, '2099-01-01')`, [A, pub]);
    check(await readable('D', 'stories', pub), 'with the public switch on, D can read a public Story while it is live');
    const left = (await db.query(`select extract(epoch from expires_at - now()) s from stories where media_path = $1`, [pub])).rows[0].s;
    check(Number(left) <= 86400, `a forged 2099 expiry became 24 h (${Math.round(left / 3600)} h left)`);
    await db.query(`update stories set expires_at = now() - interval '1 minute' where media_path = $1`, [pub]);
    check(!(await readable('D', 'stories', pub)), 'once expired, D can no longer read it');

    console.log('Paused Stories');
    await setSwitches(false);
    const off = await asUser(A, 'insert into stories (user_id, media_path, is_public) values ($1, $2, true)', [A, `${A}/off.jpg`]);
    check(!off.ok && off.hint === 'stories_paused', `a public Story is refused with the switch off (${off.hint || off.message || 'ACCEPTED'})`);

    console.log('Buckets');
    check(!(await upload('A', 'stories', `${A}/v.mov`, Buffer.from('x'), 'video/quicktime')).ok, 'stories bucket refuses a video');
    check(!(await upload('A', 'stories', `${A}/big.jpg`, Buffer.alloc(10485761), 'image/jpeg')).ok, 'stories bucket refuses a file over 10 MB');

    console.log('Gathering covers');
    const cover = `${G}/cover-1.jpg`;
    check((await upload('A', 'gathering-photos', cover)).ok, 'the host uploads a cover');
    check(!(await upload('X', 'gathering-photos', `${G}/cover-x.jpg`)).ok, "someone else can't");
    check(await readable('A', 'gathering-photos', cover), 'the host can read it');
    check(!(await readable('F', 'gathering-photos', cover)), "an approved attendee can't, by any route");
    check(!(await readable('X', 'gathering-photos', cover)), "a stranger can't");
    check(!(await readable('anon', 'gathering-photos', cover)), "a signed-out caller can't");
    check((await listed('X', 'gathering-photos', `${G}/`)) === 0, 'a stranger can list nothing there');
    check(!(await upload('A', 'gathering-photos', `${G}/v.mov`, Buffer.from('x'), 'video/quicktime')).ok, 'the cover bucket refuses a video');
  } finally {
    await setSwitches(false);
    await db.query(`delete from storage.objects where (bucket_id = 'stories' and name like any($1)) or (bucket_id = 'gathering-photos' and name like $2)`,
      [all.map((u) => `${u}/%`), `${G}/%`]);
    await db.query('delete from stories where user_id = any($1)', [all]);
    // Deleting a story queues its file for the expiry job; this script's own rows must not reach the next script's job.
    await db.query('delete from private.story_file_cleanup where media_path like any($1)', [all.map((u) => `${u}/%`)]);
    await db.query('delete from gathering_interest where gathering_id = $1', [G]);
    await db.query('delete from gatherings where id = $1', [G]);
    await db.query('delete from friendships where user_a = any($1)', [all]);
    await db.query('delete from profiles where id = any($1)', [all]);
    await db.query('delete from auth.users where id = any($1)', [all]);
    await db.end();
  }
  console.log(failures ? `story-storage-api: ${failures} FAILED` : 'story-storage-api: all checks passed');
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
