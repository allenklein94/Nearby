#!/usr/bin/env node
// Migration 20270402 under real concurrency, on the LOCAL replay database only. Separate sessions really overlap, each holding its
// transaction open before committing, in both orders.
//   1. a hold on a review case vs deleting its subject account: a hold that commits first means the evidence is copied; a deletion
//      that commits first means the hold is refused as not found. Never an active hold + a vanished case + no copy.
//   2. a hold on a report vs deleting the reported account: a hold that commits first means the evidence is copied.
//   3. a pause being created vs the deletion: a pause that commits is in the copy; otherwise it's refused. Never committed and lost.
//   4. two accounts under one hold deleted at once: both finish (deletions don't queue behind each other), both copied, no deadlock.
//   5. the same account preserved twice at once: one row per record.
//   6. the purge vs a deletion under an active hold: no deadlock, the hold keeps the evidence whichever runs first.
//   7. a hold on a report vs the purge of an expired suspended-account record naming it: a hold that commits first keeps the record.
//   8. a hold vs handing a deleted account's file over for removal: a hold first keeps the file; a hand-over first is answered 'deleting',
//      never 'kept'. Never kept AND handed over.
//   9. a hold vs the person deleting their own photo: a hold first keeps the file; a delete first is answered 'already deleted'.
//  10. a release vs a deletion copying under that hold: no deadlock, the copy is complete either way, the file stays listed.
//  11. the whole deletion (copy, profile, auth, as separate transactions) with a hold arriving at a random point, in a loop: the outcome
//      always agrees with the answer the hold got.
//  12. the purge vs a hold placed again on the same target: the hold first keeps everything; never purged under an active hold.
// Everything it creates is deleted afterwards (the guard triggers are paused for the cleanup only).
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/held-evidence-concurrency.js
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
    let r = null;
    for (const q of Array.isArray(step.sql) ? step.sql : [step.sql]) r = await c.query(q, step.args);
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

const WHY = 'Preservation request from counsel';
const delAccount = (u) => [`delete from profiles where id = '${u}'`, `delete from auth.users where id = '${u}'`];

(async () => {
  const db = await connect();
  const made = [];
  const person = async (admin = false) => {
    const u = crypto.randomUUID();
    made.push(u);
    await db.query(`insert into auth.users (id, aud, role, email, created_at) values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days')`,
      [u, `he-${u.slice(0, 8)}@concurrency.invalid`]);
    await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden, is_admin)
      values ($1, 'Race', date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false, $2)`, [u, admin]);
    return u;
  };
  const { rows: caps } = await db.query('delete from private.rate_limit_rules returning *');
  const cases = [];
  const reports = [];
  const admin = await person(true);
  const reporter = await person();
  const newCase = async (u) => {
    const { rows } = await db.query(`insert into private.account_review_cases (signal, reason, subject_user) values ('report', 'reported_profile', $1) returning id`, [u]);
    await db.query(`insert into private.account_review_case_members (case_id, user_id) values ($1, $2)`, [rows[0].id, u]);
    await db.query(`insert into account_moderation_actions (user_id, action, reason, admin_id) values ($1, 'suspend', 'Decision to keep', $2)`, [u, admin]);
    cases.push(rows[0].id);
    return rows[0].id;
  };
  const placeSql = (type, id) => `select public.admin_place_legal_hold('${type}', '${id}', '${WHY}', null) as r`;
  const count = async (u, type) => Number((await db.query(`select count(*) n from private.held_account_evidence where account_id = $1 and record_type = $2`, [u, type])).rows[0].n);
  const orders = (i, a, b) => (i % 2 === 0 ? [{ ...a, wait: 0 }, { ...b, wait: 30 }] : [{ ...a, wait: 30 }, { ...b, wait: 0 }]);
  const roundsResults = { first: 0, second: 0 };

  try {
    console.log('1. hold on a case vs deleting its subject');
    let bad = 0; let dl = 0; roundsResults.first = 0; roundsResults.second = 0;
    for (let i = 0; i < ROUNDS; i += 1) {
      const u = await person();
      const c = await newCase(u);
      const [a, b] = orders(i, { sub: admin, sql: placeSql('review_case', c) }, { sql: delAccount(u) });
      const res = await Promise.all([run(a), run(b)]);
      if (deadlock(res)) dl += 1;
      const hold = res[0];
      const copied = await count(u, 'review_case');
      const gone = (await db.query('select count(*) n from auth.users where id = $1', [u])).rows[0].n === '0';
      if (!res[1].ok || !gone) bad += 1;
      if (hold.ok && copied !== 1) bad += 1;
      if (!hold.ok && (hold.hint !== 'legal_hold_not_found' || copied !== 0)) bad += 1;
      if (hold.ok) roundsResults.first += 1; else roundsResults.second += 1;
    }
    check(bad === 0, `every hold that committed has its copy; every other was refused as not found (held ${roundsResults.first}, not found ${roundsResults.second})`);
    check(roundsResults.first > 0 && roundsResults.second > 0, 'both orders really happened');
    check(dl === 0, 'no deadlock');

    console.log('2. hold on a report vs deleting the reported account');
    bad = 0; dl = 0; let held = 0; let late = 0;
    for (let i = 0; i < ROUNDS; i += 1) {
      const u = await person();
      const { rows } = await db.query(`insert into reports (reporter_id, reported_id, reason) values ($1, $2, 'Spam or scam') returning id`, [reporter, u]);
      await db.query(`insert into account_moderation_actions (user_id, action, reason, report_id, admin_id) values ($1, 'suspend', 'Decision to keep', $3, $2)`, [u, admin, rows[0].id]);
      reports.push(rows[0].id);
      const [a, b] = orders(i, { sub: admin, sql: placeSql('report', rows[0].id) }, { sql: delAccount(u) });
      const started = Date.now();
      const res = await Promise.all([run(a), run(b)]);
      if (deadlock(res) || !res[0].ok || !res[1].ok) { dl += 1; continue; }
      const copied = await count(u, 'suspension_decision');
      const placedFirst = i % 2 === 0; // the hold's session started first and holds its lock until it commits
      if (placedFirst && copied !== 1) bad += 1;
      if (copied === 1) held += 1; else late += 1;
      void started;
    }
    check(bad === 0, `a hold that commits before the deletion means a copy (copied ${held}, deletion first ${late})`);
    check(dl === 0, 'no deadlock, nothing refused');

    console.log('3. a pause being created vs the deletion');
    bad = 0; dl = 0; let kept = 0; let refused = 0;
    for (let i = 0; i < ROUNDS; i += 1) {
      const u = await person();
      const c = await newCase(u);
      await run({ sub: admin, sql: placeSql('review_case', c) });
      // the pause either comes first, or well after the deletion's second step has the account locked
      const res = await Promise.all([
        run({ sub: admin, sql: `select public.admin_restrict_account('${u}', array['messages'], 7, 'Paused during the review', null, '${c}') as r`, wait: i % 2 === 0 ? 0 : 200 }),
        run({ sql: delAccount(u), wait: i % 2 === 0 ? 30 : 0 }),
      ]);
      if (deadlock(res)) dl += 1;
      const pauses = await count(u, 'pause');
      if (res[0].ok && pauses !== 1) bad += 1;
      if (!res[1].ok) bad += 1;
      if (res[0].ok) kept += 1; else refused += 1;
    }
    check(bad === 0, `every pause that committed is in the copy (kept ${kept}, refused ${refused})`);
    check(kept > 0 && refused > 0, 'both orders really happened');
    check(dl === 0, 'no deadlock');

    console.log('4. two accounts under one hold, deleted at once');
    bad = 0; dl = 0;
    for (let i = 0; i < ROUNDS; i += 1) {
      const u1 = await person(); const u2 = await person();
      const { rows } = await db.query(`insert into private.account_review_cases (signal, sha256, reason) values ('identical_photo', $1, 'many_accounts') returning id`, [`race-${crypto.randomUUID()}`]);
      cases.push(rows[0].id);
      await db.query(`insert into private.account_review_case_members (case_id, user_id) values ($1, $2), ($1, $3)`, [rows[0].id, u1, u2]);
      await run({ sub: admin, sql: placeSql('review_case', rows[0].id) });
      const t0 = Date.now();
      const res = await Promise.all([run({ sql: delAccount(u1) }), run({ sql: delAccount(u2) })]);
      if (deadlock(res)) dl += 1;
      if (!res.every((r) => r.ok) || await count(u1, 'case_member') !== 1 || await count(u2, 'case_member') !== 1) bad += 1;
      if (Date.now() - t0 > HOLD_MS * 2 + 400) bad += 1; // would mean one waited for the other's commit
    }
    check(bad === 0, 'both finish side by side, both copied');
    check(dl === 0, 'no deadlock');

    console.log('5. the same account preserved twice at once');
    bad = 0;
    for (let i = 0; i < ROUNDS; i += 1) {
      const u = await person();
      const c = await newCase(u);
      await run({ sub: admin, sql: placeSql('review_case', c) });
      const q = `select private.preserve_held_account_evidence('${u}')`;
      const res = await Promise.all([run({ sql: q }), run({ sql: q })]);
      if (!res.every((r) => r.ok) || await count(u, 'review_case') !== 1 || await count(u, 'case_member') !== 1) bad += 1;
    }
    check(bad === 0, 'one row per record');

    console.log('6. the purge vs a deletion');
    bad = 0; dl = 0;
    for (let i = 0; i < ROUNDS; i += 1) {
      const u = await person();
      const c = await newCase(u);
      await run({ sub: admin, sql: placeSql('review_case', c) });
      const res = await Promise.all([run({ sql: 'select private.purge_held_account_evidence()', wait: i % 2 ? 30 : 0 }), run({ sql: delAccount(u), wait: i % 2 ? 0 : 30 })]);
      if (deadlock(res)) dl += 1;
      if (!res.every((r) => r.ok) || await count(u, 'review_case') !== 1) bad += 1;
    }
    check(bad === 0, 'an active hold keeps its copy whichever runs first');
    check(dl === 0, 'no deadlock');

    console.log('7. a hold on a report vs the purge of an expired suspended-account record');
    bad = 0; dl = 0; let kept7 = 0; let purged7 = 0;
    for (let i = 0; i < ROUNDS; i += 1) {
      const { rows } = await db.query(`insert into reports (reporter_id, reason) values ($1, 'Spam or scam') returning id`, [reporter]);
      reports.push(rows[0].id);
      const { rows: rec } = await db.query(`insert into private.suspended_account_records (former_account_id, released, suspended_at, released_at, expires_at, decisions)
        values (gen_random_uuid(), 'account_deleted', now() - interval '14 months', now() - interval '13 months', now() - interval '1 month',
                jsonb_build_array(jsonb_build_object('action', 'suspend', 'report_id', $1::uuid))) returning id`, [rows[0].id]);
      const [a, b] = orders(i, { sub: admin, sql: placeSql('report', rows[0].id) }, { sql: 'select private.purge_suspended_account_records()' });
      const res = await Promise.all([run(a), run(b)]);
      if (deadlock(res)) dl += 1;
      const left = Number((await db.query('select count(*) n from private.suspended_account_records where id = $1', [rec[0].id])).rows[0].n);
      if (!res.every((r) => r.ok)) bad += 1;
      if (i % 2 === 0 && left !== 1) bad += 1; // the hold's session started first and holds the lock until it commits
      if (left === 1) kept7 += 1; else purged7 += 1;
      await db.query('delete from private.suspended_account_records where id = $1', [rec[0].id]);
    }
    check(bad === 0, `a hold that commits first keeps the record (kept ${kept7}, purged first ${purged7})`);
    check(kept7 > 0 && purged7 > 0, 'both orders really happened');
    check(dl === 0, 'no deadlock');

    const fileFor = async (u, name = 'main.jpg') => {
      const { rows } = await db.query(`insert into storage.objects (bucket_id, name, metadata) values ('profile-photos', $1, '{"size": 1}') returning id`, [`${u}/${name}`]);
      await db.query(`update profiles set photo_url = $1 where id = $2`, [`${u}/${name}`, u]);
      return rows[0].id;
    };
    const profileReport = async (u) => {
      const { rows } = await db.query(`insert into reports (reporter_id, reported_id, reason) values ($1, $2, 'Inappropriate photo') returning id`, [reporter, u]);
      reports.push(rows[0].id);
      return rows[0].id;
    };
    const fileState = async (o) => (await db.query(`select (select count(*) from private.legal_hold_files where object_id = $1)::int as listed,
      (select count(*) from private.account_file_cleanup where object_id = $1 and claimed_at is not null)::int as claimed,
      (select count(*) from storage.objects where id = $1)::int as present`, [o])).rows[0];

    console.log('8. a hold vs handing a file over for removal');
    bad = 0; dl = 0; let kept8 = 0; let deleting8 = 0;
    for (let i = 0; i < ROUNDS * 2; i += 1) {
      const u = await person();
      const o = await fileFor(u);
      const r = await profileReport(u);
      await db.query('delete from profiles where id = $1', [u]);
      await db.query('delete from auth.users where id = $1', [u]);
      const [a, b] = orders(i, { sub: admin, sql: placeSql('report', r) }, { sql: `select count(*) n from public.account_file_cleanup_claim('${u}')` });
      const res = await Promise.all([run(a), run(b)]);
      if (deadlock(res)) dl += 1;
      if (!res[0].ok || !res[1].ok) { bad += 1; console.log(res); continue; }
      const files = res[0].rows[0].r.files;
      const st = await fileState(o);
      if (st.claimed === 1) { deleting8 += 1; if (files.kept !== 0 || files.deleting !== 1) bad += 1; }
      else { kept8 += 1; if (files.kept !== 1 || files.deleting !== 0 || st.listed !== 1) bad += 1; }
    }
    check(bad === 0, `the answer always matches: kept ${kept8}, deleting ${deleting8}, never kept AND handed over`);
    check(kept8 > 0 && deleting8 > 0, 'both orders really happened');
    check(dl === 0, 'no deadlock');

    console.log('9. a hold vs the person deleting their own photo');
    bad = 0; dl = 0; let kept9 = 0; let gone9 = 0;
    for (let i = 0; i < ROUNDS * 2; i += 1) {
      const u = await person();
      const o = await fileFor(u);
      const r = await profileReport(u);
      const [a, b] = orders(i, { sub: admin, sql: placeSql('report', r) }, { sub: u, sql: `delete from storage.objects where id = '${o}'` });
      const res = await Promise.all([run(a), run(b)]);
      if (deadlock(res)) dl += 1;
      if (!res[0].ok || !res[1].ok) { bad += 1; console.log(res); continue; }
      const st = await fileState(o);
      const files = res[0].rows[0].r.files;
      if (st.present === 1) { kept9 += 1; if (files.kept !== 1 || st.listed !== 1) bad += 1; }
      else { gone9 += 1; if (files.kept !== 0 || st.listed !== 0) bad += 1; }
    }
    check(bad === 0, `a listed file is always there; a deleted one is never listed (kept ${kept9}, deleted first ${gone9})`);
    check(kept9 > 0 && gone9 > 0, 'both orders really happened');
    check(dl === 0, 'no deadlock');

    console.log('10. a release vs a deletion copying under that hold');
    bad = 0; dl = 0;
    for (let i = 0; i < ROUNDS; i += 1) {
      const u = await person();
      const c = await newCase(u);
      const { rows } = await db.query(`insert into storage.objects (bucket_id, name, metadata) values ('profile-photos', $1, '{"size": 1}') returning id`, [`${u}/case.jpg`]);
      await db.query(`insert into private.account_review_case_photos (case_id, object_id, user_id) values ($1, $2, $3)`, [c, rows[0].id, u]);
      const place = await run({ sub: admin, sql: placeSql('review_case', c) });
      const holdId = place.rows[0].r.hold_id;
      const [a, b] = orders(i, { sub: admin, sql: `select public.admin_release_legal_hold('${holdId}', 'Counsel confirmed the matter is closed') as r` }, { sql: delAccount(u) });
      const res = await Promise.all([run(a), run(b)]);
      if (deadlock(res)) dl += 1;
      if (!res[0].ok || !res[1].ok) { bad += 1; console.log(res); continue; }
      const st = await fileState(rows[0].id);
      if (st.listed !== 1 || st.present !== 1) bad += 1;  // listed at placing, kept: no policy, nothing purges
    }
    check(bad === 0, 'the deletion finishes and the file stays listed and present, in both orders');
    check(dl === 0, 'no deadlock');

    console.log('11. the whole deletion with a hold arriving at a random point');
    bad = 0; dl = 0; const seen = { kept: 0, deleting: 0, late: 0 };
    for (let i = 0; i < ROUNDS * 3; i += 1) {
      const u = await person();
      const o = await fileFor(u);
      const r = await profileReport(u);
      const del = (async () => {
        await run({ sql: `select public.account_deletion_preserve_held_evidence('${u}')` });
        await run({ sql: `delete from profiles where id = '${u}'` });
        await run({ sql: `delete from auth.users where id = '${u}'` });
        return run({ sql: `select count(*) n from public.account_file_cleanup_claim('${u}')` });
      })();
      const hold = run({ sub: admin, wait: (i * 67) % 700, sql: placeSql('report', r) });
      const [dres, hres] = await Promise.all([del, hold]);
      if (deadlock([dres, hres])) dl += 1;
      if (!hres.ok) { bad += 1; console.log(hres); continue; }
      const files = hres.rows[0].r.files;
      const st = await fileState(o);
      // Storage is not running here: 'present' stays 1, so the claim is the fact that decides
      if (files.kept === 1) { seen.kept += 1; if (st.claimed !== 0 || st.listed !== 1) bad += 1; }
      else if (files.deleting === 1) { seen.deleting += 1; if (st.claimed !== 1) bad += 1; }
      else { seen.late += 1; if (st.listed !== 0) bad += 1; }  // after the marker's report list is gone it has nothing to reach
    }
    check(bad === 0, `the file's fate always agrees with the answer (${JSON.stringify(seen)})`);
    check(seen.kept > 0, 'the hold landed in time at least once');
    check(dl === 0, 'no deadlock');

    console.log('12. the purge vs a hold placed again');
    bad = 0; dl = 0;
    await db.query(`select private.set_held_evidence_retention(interval '1 second', 'Concurrency test policy', 'concurrency')`);
    for (let i = 0; i < ROUNDS; i += 1) {
      const u = await person();
      const c = await newCase(u);
      const first = await run({ sub: admin, sql: placeSql('review_case', c) });
      await run({ sql: delAccount(u).slice(0, 1) });
      const { rows: other } = await db.query(`select id from private.legal_holds where id = $1`, [first.rows[0].r.hold_id]);
      await run({ sub: admin, sql: `select public.admin_release_legal_hold('${other[0].id}', 'Counsel confirmed the matter is closed') as r` });
      await sleep(1100);
      const [a, b] = orders(i, { sub: admin, sql: placeSql('review_case', c) }, { sql: 'select private.purge_held_account_evidence()' });
      const res = await Promise.all([run(a), run(b)]);
      if (deadlock(res)) dl += 1;
      const n = await count(u, 'coverage');
      const active = (await db.query(`select count(*)::int n from private.legal_holds where target_id = $1 and released_at is null`, [c])).rows[0].n;
      if (res[0].ok && res[0].rows[0].r.hold_id && active === 1) {
        // the case still exists until the auth delete; the copy stays if the hold came first
        const purgedFirst = n === 0;
        if (purgedFirst && i % 2 === 0) bad += 1;
      }
      await db.query('delete from auth.users where id = $1', [u]);
    }
    check(bad === 0, 'a hold placed first keeps the copy; the purge never removes under an active hold');
    check(dl === 0, 'no deadlock');
  } finally {
    await db.query('alter table private.held_account_evidence disable trigger held_evidence_guard');
    await db.query('alter table private.legal_hold_files disable trigger legal_hold_files_guard');
    await db.query('alter table private.held_evidence_retention_policy disable trigger held_evidence_policy_guard');
    await db.query('delete from private.held_account_evidence');
    await db.query('delete from private.legal_hold_files');
    await db.query('delete from private.held_evidence_retention_policy');
    await db.query('alter table private.held_account_evidence enable trigger held_evidence_guard');
    await db.query('alter table private.legal_hold_files enable trigger legal_hold_files_guard');
    await db.query('alter table private.held_evidence_retention_policy enable trigger held_evidence_policy_guard');
    await db.query('delete from private.account_file_cleanup');
    await db.query('delete from private.account_deletion_markers');
    await db.query("delete from storage.objects where bucket_id = 'profile-photos' and (storage.foldername(name))[1] = any($1::text[])", [made]);
    await db.query('alter table private.legal_holds disable trigger legal_hold_immutable');
    await db.query('delete from private.legal_holds where target_id = any($1::uuid[]) or target_id = any($2::uuid[])', [cases, reports]);
    await db.query('alter table private.legal_holds enable trigger legal_hold_immutable');
    await db.query('delete from reports where id = any($1::uuid[])', [reports]);
    await db.query('delete from private.account_review_cases where id = any($1::uuid[])', [cases]);
    await db.query('delete from profiles where id = any($1::uuid[])', [made]);
    await db.query('delete from auth.users where id = any($1::uuid[])', [made]);
    // 20270374 rightly kept a record for each suspended account deleted here; append-only, so paused for this cleanup too
    await db.query('alter table private.suspended_account_records disable trigger suspended_record_guard');
    await db.query('delete from private.suspended_account_records where former_account_id = any($1::uuid[])', [made]);
    await db.query('alter table private.suspended_account_records enable trigger suspended_record_guard');
    for (const r of caps) {
      const keys = Object.keys(r);
      await db.query(`insert into private.rate_limit_rules (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`, keys.map((k) => r[k]));
    }
    await db.end();
  }
  console.log(failures ? `FAILED: ${failures}` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
