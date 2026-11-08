#!/usr/bin/env node
// ID-document deletion through the REAL Storage API (owner, 2026-11-07; migration 20270400), on the LOCAL replay stack only. Nothing
// is mocked: files are uploaded through the real Storage API under the person's own JWT (its real bucket policy), the real
// private.run_id_document_retention() runs, REAL pg_net sends each DELETE to the real Storage API, the real responses land in
// net._http_response, the next run reads them, and the bytes are checked on the Storage container's disk. Time is simulated only by
// moving a row's dates. Failures are real too: a key Storage really refuses, and an address that really refuses connections.
// The rule under test: an ID image leaves the queue only once Storage confirms it AND it is gone; a failure keeps it (logged,
// retried); a pending submission's or a held submission's files are never deleted; account deletion removes the whole folder.
//   KEEP=1 BEFORE_MIGRATIONS='node scripts/replay/account-takeover-auth-local.js prepare' bash scripts/replay/from-scratch-replay.sh
//   bash scripts/replay/storage-api-up.sh
//   NEARBY_LOCAL_DB_URL=... NEARBY_LOCAL_STORAGE_URL=... NEARBY_LOCAL_STORAGE_KEYS=... [NEARBY_PG_MODULE=...] node scripts/replay/id-document-storage-api.js
const dbUrl = process.env.NEARBY_LOCAL_DB_URL;
const api = process.env.NEARBY_LOCAL_STORAGE_URL;
const local = /^(postgres:\/\/[^@]+@|http:\/\/)(localhost|127\.|172\.|10\.|192\.168\.)/;
if (!dbUrl || !api || !local.test(dbUrl) || !local.test(api)) {
  console.error('NEARBY_LOCAL_DB_URL and NEARBY_LOCAL_STORAGE_URL must point at the local replay stack.');
  process.exit(2);
}
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const keys = JSON.parse(fs.readFileSync(process.env.NEARBY_LOCAL_STORAGE_KEYS, 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, msg, extra) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}${!ok && extra !== undefined ? ` ${JSON.stringify(extra)}` : ''}`); };

const [P, U, H, D, ADMIN] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const people = [P, U, H, D, ADMIN];
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

function jwt(sub) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 })}`;
  return `${body}.${crypto.createHmac('sha256', keys.secret).update(body).digest('base64url')}`;
}
const objectUrl = (name, route = '') => `${api}/object/${route}id-verification/${name.split('/').map(encodeURIComponent).join('/')}`;
const upload = (who, name) => fetch(objectUrl(name), { method: 'POST', headers: { apikey: keys.anon, Authorization: `Bearer ${jwt(who)}`, 'Content-Type': 'image/jpeg' }, body: JPEG });
const inStorage = async (name) => (await fetch(objectUrl(name, 'authenticated/'), { headers: { apikey: keys.service, Authorization: `Bearer ${keys.service}` } })).ok;
function onDisk(folder) {
  const out = execFileSync('docker', ['exec', 'nearby-storage', 'find', '/var/lib/storage', '-type', 'f', '-path', `*${folder}*`]).toString().trim();
  return out ? out.split('\n').length : 0;
}

(async () => {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  const original = (await db.query('select (select storage_url from private.story_media_settings) u, (select uploads_enabled from private.id_document_settings) e')).rows[0];
  const key = (await db.query(`select decrypted_secret s, id from vault.decrypted_secrets where name = 'service_role_key'`)).rows[0];
  const setKey = (k) => db.query('select vault.update_secret($1, $2)', [key.id, k]);
  const settle = async () => {
    for (let i = 0; i < 160; i += 1) {
      const open = (await db.query(`select count(*)::int n from private.id_document_cleanup q
        where q.request_id is not null and not exists (select 1 from net._http_response h where h.id = q.request_id)`)).rows[0].n;
      if (!open) return;
      await sleep(250);
    }
    throw new Error('pg_net never answered');
  };
  const run = async () => { await db.query('select private.run_id_document_retention()'); await settle(); };
  const due = () => db.query(`update private.id_document_cleanup set next_attempt_at = now() - interval '1 second' where request_id is null and gave_up_at is null`);
  const cycle = async () => { await due(); await run(); await db.query('select private.run_id_document_retention()'); await settle(); };
  const row = async (name) => (await db.query('select * from private.id_document_cleanup where object_path = $1', [name])).rows[0];
  const age = async (sub) => {
    await db.query('begin'); await db.query('set local session_replication_role = replica');
    await db.query(`update id_verification_submissions set reviewed_at = now() - interval '8 days', documents_delete_after = now() - interval '1 second' where id = $1`, [sub]);
    await db.query('commit');
  };
  const submit = async (who) => {
    for (const f of ['selfie.jpg', 'id.jpg']) {
      const r = await upload(who, `${who}/${f}`);
      if (!r.ok) throw new Error(`upload ${f}: ${r.status} ${await r.text()}`);
    }
    return (await db.query(`insert into id_verification_submissions (user_id, selfie_path, id_photo_path) values ($1::uuid, $1::text || '/selfie.jpg', $1::text || '/id.jpg') returning id`, [who])).rows[0].id;
  };
  const approve = (sub) => db.query(`update id_verification_submissions set status = 'approved', reviewed_at = now(), reviewed_by = $2 where id = $1`, [sub, ADMIN]);

  try {
    await db.query('update private.story_media_settings set storage_url = $1', [api]);
    await setKey(keys.service);  // the replay's vault holds a placeholder; the local Storage API's real service key, restored after
    await db.query('delete from private.id_document_cleanup');
    for (const [i, u] of people.entries()) {
      await db.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
        values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`, [u, `id${i}-${u.slice(0, 8)}@iddocs.invalid`, `1558${String(i).padStart(8, '0')}`]);
      await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, is_admin)
        values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', $3)`, [u, `IdDoc ${i}`, u === ADMIN]);
    }

    console.log('Closed: the real Storage API refuses an upload while ID verification is off');
    await db.query('update private.id_document_settings set uploads_enabled = false');
    const closed = await upload(P, `${P}/selfie.jpg`);
    check(!closed.ok && !(await inStorage(`${P}/selfie.jpg`)), `refused (${closed.status})`);
    await db.query('update private.id_document_settings set uploads_enabled = true');

    console.log('Approved, past 7 days: deleted from Storage, confirmed, recorded');
    const sp = await submit(P);
    check((await inStorage(`${P}/id.jpg`)) && onDisk(P) === 2, 'both images uploaded through the real Storage API');
    await approve(sp); await age(sp);

    console.log('  a key Storage really refuses: nothing deleted, failure logged, retried later');
    await setKey('not-a-real-key');
    await run(); await db.query('select private.run_id_document_retention()');
    let r = await row(`${P}/id.jpg`);
    check(r && r.attempts === 1 && r.request_id === null && r.last_status >= 400, 'still queued, one failed attempt', r && { a: r.attempts, s: r.last_status });
    check(await inStorage(`${P}/id.jpg`) && onDisk(P) === 2, 'the bytes are still there');
    await setKey(keys.service);

    console.log('  an address that refuses connections (real pg_net error): nothing deleted, logged');
    const ip = execFileSync('docker', ['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', 'nearby-storage']).toString().trim();
    await db.query('update private.story_media_settings set storage_url = $1', [`http://${ip}:1/storage/v1`]);
    await due(); await run(); await db.query('select private.run_id_document_retention()');
    r = await row(`${P}/id.jpg`);
    check(r && r.attempts === 2 && r.last_status === null, 'still queued, a network failure counted', r && { a: r.attempts, s: r.last_status, e: r.last_error });
    const kinds = (await db.query('select array_agg(kind order by id) k from private.id_document_cleanup_log where object_path = $1', [`${P}/id.jpg`])).rows[0].k;
    check(JSON.stringify(kinds) === JSON.stringify(['refused', 'network']), `each failure logged: ${kinds}`);
    await db.query('update private.story_media_settings set storage_url = $1', [api]);

    console.log('  working again: really deleted');
    await cycle();
    check(!(await row(`${P}/id.jpg`)) && !(await row(`${P}/selfie.jpg`)), 'both left the queue');
    check(!(await inStorage(`${P}/id.jpg`)) && !(await inStorage(`${P}/selfie.jpg`)), 'Storage no longer serves them');
    check(onDisk(P) === 0, 'no bytes left on the Storage disk');
    const sub = (await db.query('select documents_deleted_at, status from id_verification_submissions where id = $1', [sp])).rows[0];
    check(sub.documents_deleted_at !== null && sub.status === 'approved', 'the row stays, marked deleted');
    const audit = (await db.query('select image, reason from private.id_document_deletion_log where submission_id = $1 order by image', [sp])).rows;
    check(JSON.stringify(audit) === JSON.stringify([{ image: 'id_photo', reason: 'approved_7d' }, { image: 'selfie', reason: 'approved_7d' }]), 'audit rows (no path)');

    console.log('Pending: never deleted, even if queued');
    const su = await submit(U);
    await db.query(`insert into private.id_document_cleanup (object_path, submission_id, image, reason) values ($1, $2, 'selfie', 'orphan_24h')`, [`${U}/selfie.jpg`, su]);
    await cycle();
    check(await inStorage(`${U}/selfie.jpg`) && onDisk(U) === 2, 'still in Storage');

    console.log('Legal hold: kept past its period, deleted once released');
    const sh = await submit(H);
    await approve(sh); await age(sh);
    const hold = (await db.query(`insert into private.legal_holds (target_type, target_id, reason, placed_by) values ('id_submission', $1, 'Law enforcement request', $2) returning id`, [sh, ADMIN])).rows[0].id;
    await cycle(); await cycle();
    check(await inStorage(`${H}/id.jpg`) && onDisk(H) === 2, 'held: still in Storage');
    await db.query(`update private.legal_holds set released_at = now(), released_by = $2, release_reason = 'Request closed by the authority' where id = $1`, [hold, ADMIN]);
    await cycle(); await cycle();
    check(!(await inStorage(`${H}/id.jpg`)) && onDisk(H) === 0, 'released: gone from Storage');

    console.log('Account deletion: the whole folder, incl. an upload no submission named');
    await submit(D);
    const stray = await upload(D, `${D}/stray.jpg`);
    check(stray.ok && onDisk(D) === 3, 'three files uploaded');
    await db.query('delete from profiles where id = $1', [D]);
    await db.query('delete from auth.users where id = $1', [D]);
    await cycle(); await cycle();
    check(onDisk(D) === 0 && !(await inStorage(`${D}/stray.jpg`)), 'every file gone from Storage');
  } catch (e) {
    failures += 1;
    console.log(`  ✗ FAIL: ${e.message}`);
  } finally {
    await setKey(key.s);
    await db.query('update private.story_media_settings set storage_url = $1', [original.u]);
    await db.query('update private.id_document_settings set uploads_enabled = $1', [original.e]);
    await db.query('delete from private.id_document_cleanup where object_path like any($1)', [people.map((u) => `${u}/%`)]);
    await db.query('delete from profiles where id = any($1)', [people]);
    await db.query('delete from auth.users where id = any($1)', [people]);
    await db.end();
  }
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})();
