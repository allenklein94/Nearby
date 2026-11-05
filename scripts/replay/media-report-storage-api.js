#!/usr/bin/env node
// A reported Story / gathering memory through the REAL Supabase Storage API (owner, 2026-11-05; migration 20270391), on the LOCAL
// replay stack only (refuses anything else). Same setup as story-storage-api.js. Every storage call is an HTTP request with a real
// JWT, so the Storage API itself applies the storage.objects rules.
// Checks: the poster can't overwrite or delete a reported file; once the row is gone only an admin can read it, and a non-admin
// who could see it before can't; an unreported file gives the admin nothing; the job queues a DELETE that the real API accepts,
// and the file is then gone; a released file closes to the admin.
// The job's own HTTP call can't leave the isolated database (its URL is production's), so this script reads the queued call and
// sends the same method + path to the local API with the local service key. Rows and files it creates are deleted afterwards.
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

const [P, R, X, ADMIN, H] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const G = crypto.randomUUID();
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };

function jwt(sub) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 })}`;
  return `${body}.${crypto.createHmac('sha256', keys.secret).update(body).digest('base64url')}`;
}
const tokens = { P: jwt(P), R: jwt(R), X: jwt(X), ADMIN: jwt(ADMIN), service: keys.service };
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const OTHER = Buffer.from('ffd8ffe000104a46494600010100000100020000ffd9', 'hex');

async function call(who, method, path, { json, body, type, headers: extra } = {}) {
  const headers = { apikey: keys.anon, Authorization: `Bearer ${tokens[who]}`, ...extra };
  if (json) headers['Content-Type'] = 'application/json';
  if (body) headers['Content-Type'] = type;
  const res = await fetch(`${api}${path}`, { method, headers, body: json ? JSON.stringify(json) : body });
  const buf = Buffer.from(await res.arrayBuffer());
  let data = buf;
  try { data = JSON.parse(buf.toString()); } catch { /* bytes */ }
  return { ok: res.ok, status: res.status, data, buf };
}
const upload = (who, name, body = JPEG, extra) => call(who, 'POST', `/object/stories/${name}`, { body, type: 'image/jpeg', headers: extra });
async function readable(who, name) {
  const s = await call(who, 'POST', `/object/sign/stories/${name}`, { json: { expiresIn: 600 } });
  const routes = [s.ok && !!s.data?.signedURL, (await call(who, 'GET', `/object/authenticated/stories/${name}`)).ok,
    (await call(who, 'GET', `/object/stories/${name}`)).ok, (await call(who, 'GET', `/object/public/stories/${name}`)).ok];
  return routes.some(Boolean);
}
const exists = async (name) => (await call('service', 'GET', `/object/authenticated/stories/${name}`)).ok;

(async () => {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  const asUser = async (u, sql, args) => {
    await db.query('begin');
    try {
      await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: u, role: 'authenticated' })]);
      await db.query('set local role authenticated');
      const r = await db.query(sql, args);
      await db.query('commit');
      return { ok: true, rows: r.rows, count: r.rowCount };
    } catch (e) {
      await db.query('rollback');
      return { ok: false, message: e.message, hint: e.hint };
    }
  };
  const job = async () => {
    await db.query('delete from net.http_request_queue');
    await db.query('select delete_expired_stories()');
    const q = await db.query(`select method, url from net.http_request_queue where url like '%/object/stories/%'`);
    const out = [];
    for (const r of q.rows) {
      const name = r.url.split('/object/stories/')[1];
      out.push({ name, res: await call('service', r.method, `/object/stories/${name}`) });
    }
    return out;
  };
  const people = [P, R, X, ADMIN, H];
  try {
    for (const [i, u] of people.entries()) {
      await db.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
        values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`, [u, `m${i}-${u.slice(0, 8)}@storage.invalid`, `1558${String(i).padStart(8, '0')}`]);
      await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden, is_admin)
        values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false, $3)`, [u, `Media ${i}`, u === ADMIN]);
    }
    await db.query(`insert into gatherings (id, host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
      values ($1, $2, 'S memories', now() - interval '2 days', 26.4, -80.1, 'Volleyball', 'x', 'everyone')`, [G, H]);
    await db.query(`insert into gathering_interest (gathering_id, user_id, status) values ($1, $2, 'approved'), ($1, $3, 'approved')`, [G, P, R]);

    const reported = `${P}/reported.jpg`;
    const plain = `${P}/plain.jpg`;
    const reportedName = `${reported}`;
    check((await upload('P', reported)).ok && (await upload('P', plain)).ok, 'poster uploads two memory photos');
    const m = await asUser(P, `insert into stories (user_id, media_path, gathering_id) values ($1, $2, $3), ($1, $4, $3) returning id, media_path`, [P, reported, G, plain]);
    const idOf = (p) => m.rows.find((r) => r.media_path === p).id;
    check(await readable('R', reported), 'an attendee can read it');
    check(!(await readable('X', reported)), "a stranger can't");
    check(!(await readable('ADMIN', reported)), "before any report, an admin who wasn't there can't");

    console.log('Report');
    const rep = await asUser(R, `insert into reports (reporter_id, reason, content_type, content_id) values ($1, 'Other', 'story', $2) returning id`, [R, idOf(reported)]);
    check(rep.ok, `the attendee reports it (${rep.message || 'filed'})`);
    const repId = rep.rows[0].id;
    check(await readable('ADMIN', reported), 'an admin can now read the held file');
    check(!(await readable('ADMIN', plain)), 'the same admin still gets nothing from an unreported file');
    const before = (await call('ADMIN', 'GET', `/object/authenticated/stories/${reported}`)).buf;

    console.log('Evidence can\'t be changed by the poster');
    const over = await upload('P', reported, OTHER, { 'x-upsert': 'true' });
    check(!over.ok, `overwrite refused (${over.status})`);
    const put = await call('P', 'PUT', `/object/stories/${reported}`, { body: OTHER, type: 'image/jpeg' });
    check(!put.ok, `PUT refused (${put.status})`);
    await call('P', 'DELETE', `/object/stories/${reported}`);
    await call('P', 'DELETE', '/object/stories', { json: { prefixes: [reported] } });
    check(await exists(reported), 'delete, single and bulk, removes nothing');
    const moved = await call('P', 'POST', '/object/move', { json: { bucketId: 'stories', sourceKey: reported, destinationKey: `${P}/moved.jpg` } });
    check(!moved.ok && await exists(reported), `move refused (${moved.status})`);
    check(Buffer.compare((await call('ADMIN', 'GET', `/object/authenticated/stories/${reported}`)).buf, before) === 0, 'the bytes are unchanged');

    console.log('After removal');
    await asUser(P, 'delete from stories where id = $1', [idOf(reported)]);
    check(!(await readable('R', reported)), 'the row gone, the attendee can no longer read it');
    check(!(await readable('P', reported)), 'nor can the poster');
    check(await readable('ADMIN', reported), 'the admin still can');
    await asUser(H, 'select remove_gathering_memory($1)', [idOf(plain)]);
    const first = await job();
    check(first.length === 1 && first[0].name === plain && first[0].res.ok, `the job deletes only the unreported file (${first.map((f) => `${f.name.split('/')[1]}: ${f.res.status}`).join(', ')})`);
    check(!(await exists(plain)), 'that file is really gone');
    check(await exists(reported), 'the held file is not');

    console.log('Release');
    await asUser(ADMIN, `select admin_resolve_report($1, 'no_action')`, [repId]);
    check(!(await readable('ADMIN', reported)), 'after no_action the admin can no longer read it');
    const second = await job();
    check(second.length === 1 && second[0].name === reported && second[0].res.ok, 'the job deletes it now');
    check(!(await exists(reportedName)), 'and it is gone');
  } finally {
    await db.query('delete from reports where reporter_id = any($1)', [people]).catch(() => {});
    await db.query('delete from private.story_media_removals where gathering_id = $1', [G]).catch(() => {});
    await db.query('delete from stories where user_id = any($1)', [people]).catch(() => {});
    await db.query('delete from gatherings where id = $1', [G]).catch(() => {});
    await db.query(`delete from private.story_file_cleanup where media_path like $1`, [`${P}/%`]).catch(() => {});
    await db.query('delete from profiles where id = any($1)', [people]).catch(() => {});
    await db.query('delete from auth.users where id = any($1)', [people]).catch(() => {});
    await db.end();
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
