#!/usr/bin/env node
// Migration 20270400 (ID-document retention + deletion) under real concurrency, on the LOCAL replay database only. A journey is one
// transaction and can't race, so here separate sessions really overlap, each holding its transaction open before committing, in
// both orders.
//   1. an admin's legal hold vs the hourly job on an approved submission past its 7 days (not queued yet): the hold's answer is
//      always true: "held" = no DELETE was sent for its files; "deleting" = the job sent both first (pg_net can't recall them).
//   2. the same with the files already queued from an earlier run (retry pending).
//   3. two jobs at once: each file is sent at most once.
//   No deadlock anywhere. The job's DELETEs go to the replay's (unreachable) Storage URL: only the queue's request ids are read.
// Every row it creates is deleted afterwards (holds included: their no-delete trigger is paused for the cleanup only); the upload
// switch, the queue and its log are restored.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/id-document-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const crypto = require('crypto');

const HOLD_MS = 120;
const ROUNDS = 8;
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadlock = (res) => res.some((r) => /deadlock/i.test(r.error || ''));

async function run(step) {
  if (step.wait) await sleep(step.wait);
  const c = await connect();
  try {
    await c.query('begin');
    if (step.sub) {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: step.sub, role: 'authenticated' })]);
      await c.query('set local role authenticated');
    }
    const r = await c.query(step.sql, step.args);
    await sleep(HOLD_MS);
    await c.query('commit');
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    return { ok: false, error: e.message, hint: e.hint };
  } finally {
    await c.end();
  }
}

(async () => {
  const db = await connect();
  const admin = crypto.randomUUID();
  const people = [admin];
  const { rows: [setting] } = await db.query('select uploads_enabled from private.id_document_settings where id');
  const savedQueue = (await db.query('select * from private.id_document_cleanup')).rows;
  const addPerson = async (i, isAdmin = false, u = crypto.randomUUID()) => {
    await db.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`,
    [u, `idc${i}-${u.slice(0, 8)}@concurrency.invalid`, `1557${String(i).padStart(7, '0')}${Date.now() % 100}`.slice(0, 13)]);
    await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden, is_admin)
      values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false, $3)`, [u, `Race ${i}`, isAdmin]);
    if (!people.includes(u)) people.push(u);
    return u;
  };
  // an approved submission whose 7 days are over, both images in the bucket
  const dueSubmission = async (i) => {
    const u = await addPerson(i);
    await db.query(`insert into storage.objects (bucket_id, name) values ('id-verification', $1 || '/selfie.jpg'), ('id-verification', $1 || '/id.jpg')`, [u]);
    const sub = (await db.query(`insert into id_verification_submissions (user_id, selfie_path, id_photo_path) values ($1::uuid, $1::text || '/selfie.jpg', $1::text || '/id.jpg') returning id`, [u])).rows[0].id;
    await db.query(`update id_verification_submissions set status = 'approved', reviewed_at = now(), reviewed_by = $2 where id = $1`, [sub, admin]);
    await db.query('begin');
    await db.query('set local session_replication_role = replica');
    await db.query(`update id_verification_submissions set documents_delete_after = now() - interval '1 day' where id = $1`, [sub]);
    await db.query('commit');
    return { u, sub };
  };
  const sentFor = async (u) => (await db.query(`select count(*)::int as n from private.id_document_cleanup where object_path like $1 || '/%' and request_id is not null`, [u])).rows[0].n;
  const job = (wait = 0) => ({ wait, sql: 'select private.run_id_document_retention()' });
  const hold = (sub, wait = 0) => ({ sub: admin, wait, sql: `select public.admin_place_legal_hold('id_submission', $1, 'Preservation request from counsel', null) as h`, args: [sub] });
  const truthful = (photo, sent) => (photo === 'held' && sent === 0) || (photo === 'deleting' && sent === 2);

  try {
    await addPerson(0, true, admin);
    await db.query('update private.id_document_settings set uploads_enabled = true where id');
    await db.query('delete from private.id_document_cleanup');

    for (const [title, queuedFirst] of [['1. a legal hold vs the job, files not queued yet, both orders', false],
      ['2. a legal hold vs the job, files already queued (a retry), both orders', true]]) {
      console.log(title);
      for (let i = 0; i < ROUNDS; i += 1) {
        const { u, sub } = await dueSubmission(10 + i + (queuedFirst ? 50 : 0));
        if (queuedFirst) {
          await db.query(`insert into private.id_document_cleanup (object_path, submission_id, image, reason)
            values ($1 || '/selfie.jpg', $2, 'selfie', 'approved_7d'), ($1 || '/id.jpg', $2, 'id_photo', 'approved_7d')`, [u, sub]);
        }
        const res = await Promise.all([run(hold(sub, i % 2 ? 40 : 0)), run(job(i % 2 ? 0 : 40))]);
        const sent = await sentFor(u);
        const photo = res[0].ok ? res[0].rows[0].h.photo : null;
        const ok = res.every((x) => x.ok) && !deadlock(res) && truthful(photo, sent);
        check(ok, `round ${i} (${i % 2 ? 'job first' : 'hold first'}): hold says "${photo}", ${sent} DELETE(s) sent${ok ? '' : ` ${JSON.stringify(res)}`}`);
        await db.query('delete from private.id_document_cleanup where object_path like $1', [`${u}/%`]);
      }
    }

    console.log('3. two jobs at once: each file sent at most once');
    for (let i = 0; i < ROUNDS; i += 1) {
      const { u } = await dueSubmission(100 + i);
      const res = await Promise.all([run(job(0)), run(job(i % 2 ? 0 : 30))]);
      const sent = await sentFor(u);
      const ok = res.every((x) => x.ok) && !deadlock(res) && sent === 2;
      check(ok, `round ${i}: ${sent} DELETE(s) for 2 files${ok ? '' : ` ${JSON.stringify(res)}`}`);
      await db.query('delete from private.id_document_cleanup where object_path like $1', [`${u}/%`]);
    }
  } finally {
    await db.query('alter table private.legal_holds disable trigger legal_hold_immutable');
    await db.query(`delete from private.legal_holds where placed_by = any($1)`, [people]);
    await db.query('alter table private.legal_holds enable trigger legal_hold_immutable');
    await db.query(`delete from id_verification_submissions where user_id = any($1)`, [people]);
    await db.query(`delete from storage.objects where bucket_id = 'id-verification' and (storage.foldername(name))[1] = any($1::text[])`, [people]);
    await db.query(`delete from push_outbox where recipient_id = any($1)`, [people]);
    await db.query(`delete from auth.users where id = any($1)`, [people]);
    await db.query('delete from private.id_document_cleanup');
    for (const q of savedQueue) {
      const keys = Object.keys(q);
      await db.query(`insert into private.id_document_cleanup (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map((k) => q[k]));
    }
    await db.query(`delete from private.id_document_cleanup_log where created_at > now() - interval '1 hour' and kind in ('job_error', 'alert_error')`);
    await db.query('update private.id_document_settings set uploads_enabled = $1 where id', [setting.uploads_enabled]);
    const left = (await db.query(`select (select count(*)::int from auth.users where id = any($1)) users,
      (select count(*)::int from private.legal_holds where placed_by = any($1)) holds,
      (select count(*)::int from id_verification_submissions where user_id = any($1)) subs,
      (select count(*)::int from storage.objects where bucket_id = 'id-verification' and (storage.foldername(name))[1] = any($2::text[])) files,
      (select count(*)::int from private.id_document_cleanup) queued,
      (select uploads_enabled from private.id_document_settings where id) uploads`, [people, people])).rows[0];
    check(left.users + left.holds + left.subs + left.files === 0 && left.queued === savedQueue.length && left.uploads === setting.uploads_enabled,
      `cleaned up (${JSON.stringify(left)})`);
    await db.end();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
