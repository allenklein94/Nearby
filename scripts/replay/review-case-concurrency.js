#!/usr/bin/env node
// Migrations 20270368 + 20270369 (similar photos, review case history) under real concurrency, on the LOCAL replay database
// only (NEARBY_LOCAL_DB_URL; refuses anything else). A journey is one transaction and cannot race, so here separate sessions
// really overlap, each holding its transaction open before committing.
//   1. six accounts' copies of the same file are recorded from six parallel sessions (as moderate-photo does): ONE case,
//      six accounts, six photos, the history complete, no deadlock.
//   2. that case is closed; four NEW accounts with the file arrive in parallel: still ONE case, still closed, four
//      "new evidence" events, nothing reopened.
//   3. five accounts' similar copies recorded in parallel: ONE similar-photo case with all five.
//   4. two admins reopen the same closed case at the same moment: one reopens it, the other is told it is already open;
//      exactly one "reopened" event. Then two admins close it at once: exactly one "closed" event.
//   5. two admins open an investigation from two reports about the same person at the same moment: ONE report case, both
//      reports linked.
// Uses test distances on the replay database only; settings and every row it creates are restored / deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/review-case-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const crypto = require('crypto');

const HOLD_MS = 300;
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = (sub, role) => `select set_config('request.jwt.claims', $$${JSON.stringify({ sub, role })}$$, true)`;

// each step = { sub, role, sql, args }: its own session, as that role, holds HOLD_MS, then commits
async function together(steps) {
  const t0 = Date.now();
  const results = await Promise.all(steps.map(async (step) => {
    const c = await connect();
    try {
      await c.query('begin');
      await c.query(claims(step.sub, step.role));
      await c.query(`set local role ${step.role}`);
      const r = await c.query(step.sql, step.args);
      await sleep(HOLD_MS);
      await c.query('commit');
      return { ok: true, row: r.rows[0] };
    } catch (e) {
      await c.query('rollback').catch(() => {});
      return { ok: false, error: e.message };
    } finally {
      await c.end();
    }
  }));
  return { results, ms: Date.now() - t0 };
}
const errors = (run) => run.results.filter((r) => !r.ok).map((r) => r.error).join('; ') || 'no errors';

(async () => {
  const admin = await connect();
  const ids = [];
  const person = async (label, name = `Race ${label}`) => {
    const id = crypto.randomUUID();
    ids.push(id);
    await admin.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`,
    [id, `${label}-${id.slice(0, 8)}@concurrency.invalid`, `1556${String(ids.length).padStart(8, '0')}`]);
    await admin.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
      values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false)`, [id, name]);
    return id;
  };
  // a photo the account uses (storage object + main photo), returns the object id
  const photo = async (u, file) => {
    const o = (await admin.query(`insert into storage.objects (bucket_id, name, owner, metadata) values ('profile-photos', $1, $2, '{}'::jsonb) returning id`,
      [`${u}/${file}`, u])).rows[0].id;
    await admin.query(`select set_config('app.trusted_update', 'on', false)`);
    await admin.query(`update profiles set photo_url = $1 where id = $2`, [`${u}/${file}`, u]);
    return o;
  };
  const NAMES = ['Alex Park', 'Maria Lopez', 'Sam Chen', 'Dana Fox', 'Lee Moss', 'Kim Wu', 'Ravi Shah', 'Olu Ade', 'Tess Nguyen', 'Ivy Bell',
    'Omar Haddad', 'Jo Kent', 'Pia Lund', 'Ken Ito', 'Ana Silva', 'Bo Grant'];
  const sha = crypto.randomBytes(32).toString('hex');
  const D = 1234567890123456789n;
  const P = -987654321987654321n;

  const [{ s: saved }] = (await admin.query(`select to_jsonb(x) as s from private.account_signal_settings x`)).rows;
  const caseIds = [];
  try {
    await admin.query(`update private.account_signal_settings set duplicate_photo_min_accounts = 3, similar_name_min_similarity = 0.5,
      similar_photo_max_dhash = 10, similar_photo_max_phash = 10 where id`);
    const adminA = await person('adminA', 'Admin A');
    const adminB = await person('adminB', 'Admin B');
    await admin.query(`select set_config('app.trusted_update', 'on', false)`);
    await admin.query(`update profiles set is_admin = true where id = any($1::uuid[])`, [[adminA, adminB]]);
    let n = 0;
    const named = async (label) => person(label, NAMES[n++ % NAMES.length]);

    console.log('1. six accounts, the same file, six parallel sessions');
    const six = [];
    for (let i = 0; i < 6; i += 1) { const u = await named(`same${i}`); six.push({ u, o: await photo(u, 'same.jpg') }); }
    let run = await together(six.map(({ u, o }) => ({ sub: u, role: 'service_role', sql: 'select public.record_photo_fingerprint($1, $2, $3) ok', args: [u, o, sha] })));
    const c1 = (await admin.query(`select id, status, reason, (select count(*)::int from private.account_review_case_members m where m.case_id = c.id) members,
        (select count(*)::int from private.account_review_case_photos p where p.case_id = c.id) photos,
        (select count(*)::int from private.account_review_case_events e where e.case_id = c.id and e.kind = 'opened') opened,
        (select count(*)::int from private.account_review_case_events e where e.case_id = c.id and e.kind = 'member_added') added
      from private.account_review_cases c where sha256 = $1`, [sha])).rows;
    c1.forEach((c) => caseIds.push(c.id));
    check(run.results.every((r) => r.ok && r.row.ok), `every session recorded its fingerprint (${errors(run)}), ${run.ms} ms`);
    check(c1.length === 1, `one case (${c1.length})`);
    check(c1[0] && c1[0].members === 6 && c1[0].photos === 6, `six accounts, six photos (${c1[0]?.members}, ${c1[0]?.photos})`);
    check(c1[0] && c1[0].opened === 1 && c1[0].added === 6, `history: one opened, six added (${c1[0]?.opened}, ${c1[0]?.added})`);

    console.log('2. the case is closed; four NEW accounts with the file arrive in parallel');
    const caseId = c1[0].id;
    let r = await together([{ sub: adminA, role: 'authenticated', sql: `select public.admin_close_account_review_case($1, 'no_action', 'Stock photo') x`, args: [caseId] }]);
    check(r.results[0].ok, `closed (${errors(r)})`);
    const four = [];
    for (let i = 0; i < 4; i += 1) { const u = await named(`late${i}`); four.push({ u, o: await photo(u, 'late.jpg') }); }
    run = await together(four.map(({ u, o }) => ({ sub: u, role: 'service_role', sql: 'select public.record_photo_fingerprint($1, $2, $3) ok', args: [u, o, sha] })));
    const c2 = (await admin.query(`select count(*)::int cases, min(status) status,
        (select count(*)::int from private.account_review_case_events e where e.case_id = $2 and e.kind = 'new_evidence') new_evidence,
        (select count(*)::int from private.account_review_case_members m where m.case_id = $2 and m.after_close) after_close
      from private.account_review_cases where sha256 = $1`, [sha, caseId])).rows[0];
    check(run.results.every((x) => x.ok), `every session committed (${errors(run)}), ${run.ms} ms`);
    check(c2.cases === 1 && c2.status === 'closed', `still one case, still closed (${c2.cases}, ${c2.status})`);
    check(c2.new_evidence === 4 && c2.after_close === 4, `four new-evidence events, four accounts added after closing (${c2.new_evidence}, ${c2.after_close})`);

    console.log('3. five similar copies recorded in parallel');
    const five = [];
    for (let i = 0; i < 5; i += 1) { const u = await named(`sim${i}`); five.push({ u, o: await photo(u, 'sim.jpg'), k: BigInt(i) }); }
    run = await together(five.map(({ u, o, k }) => ({ sub: u, role: 'service_role', sql: 'select public.record_photo_perceptual_hashes($1, $2, $3::jsonb) ok',
      args: [u, o, JSON.stringify([{ variant: 'full', dhash: String(D ^ k), phash: String(P ^ k) }])] })));
    const c3 = (await admin.query(`select c.id, (select count(*)::int from private.account_review_case_members m where m.case_id = c.id) members
      from private.account_review_cases c where c.signal = 'similar_photo'
       and exists (select 1 from private.account_review_case_photos p where p.case_id = c.id and p.user_id = any($1::uuid[]))`, [five.map((x) => x.u)])).rows;
    c3.forEach((c) => caseIds.push(c.id));
    check(run.results.every((x) => x.ok && x.row.ok), `every session recorded its hashes (${errors(run)}), ${run.ms} ms`);
    check(c3.length === 1 && c3[0].members === 5, `one similar-photo case with all five (${c3.length}, ${c3[0]?.members})`);

    console.log('4. two admins reopen the same closed case at once, then close it at once');
    run = await together([adminA, adminB].map((a) => ({ sub: a, role: 'authenticated',
      sql: `select public.admin_reopen_account_review_case($1, 'Four new accounts appeared with this photo') x`, args: [caseId] })));
    const reopened = run.results.map((x) => x.ok && x.row.x.already);
    const reEvents = (await admin.query(`select count(*)::int n from private.account_review_case_events where case_id = $1 and kind = 'reopened'`, [caseId])).rows[0].n;
    check(run.results.every((x) => x.ok), `both sessions committed (${errors(run)})`);
    check(reopened.filter((x) => x === false).length === 1 && reopened.filter((x) => x === true).length === 1, `one reopened it, one was told it already was (${JSON.stringify(reopened)})`);
    check(reEvents === 1, `exactly one "reopened" event (${reEvents})`);
    run = await together([adminA, adminB].map((a) => ({ sub: a, role: 'authenticated',
      sql: `select public.admin_close_account_review_case($1, 'action_taken', 'Reviewed') x`, args: [caseId] })));
    const clEvents = (await admin.query(`select count(*)::int n from private.account_review_case_events where case_id = $1 and kind = 'closed'`, [caseId])).rows[0].n;
    check(run.results.every((x) => x.ok), `both sessions committed (${errors(run)})`);
    check(clEvents === 2, `exactly one more "closed" event (first close + this one = ${clEvents})`);

    console.log('5. two admins open an investigation from two reports about the same person at once');
    const target = await named('target');
    await photo(target, 't.jpg');
    const reporter = await named('reporter');
    const rep = [];
    for (let i = 0; i < 2; i += 1) {
      rep.push((await admin.query(`insert into reports (reporter_id, reported_id, reason) values ($1, $2, 'Fake profile') returning id`, [reporter, target])).rows[0].id);
    }
    run = await together(rep.map((id, i) => ({ sub: i ? adminB : adminA, role: 'authenticated', sql: 'select public.admin_open_case_from_report($1) x', args: [id] })));
    const c5 = (await admin.query(`select c.id, (select count(*)::int from private.account_review_case_reports r where r.case_id = c.id) reports
      from private.account_review_cases c where c.signal = 'report' and c.subject_user = $1`, [target])).rows;
    c5.forEach((c) => caseIds.push(c.id));
    check(run.results.every((x) => x.ok), `both sessions committed (${errors(run)})`);
    check(c5.length === 1 && c5[0].reports === 2, `one report case, both reports linked (${c5.length}, ${c5[0]?.reports})`);
  } finally {
    await admin.query(`update private.account_signal_settings set duplicate_photo_min_accounts = $1, similar_name_min_similarity = $2,
      similar_photo_max_dhash = $3, similar_photo_max_phash = $4 where id`,
    [saved.duplicate_photo_min_accounts, saved.similar_name_min_similarity, saved.similar_photo_max_dhash, saved.similar_photo_max_phash]);
    if (caseIds.length) await admin.query(`delete from private.account_review_cases where id = any($1::uuid[])`, [caseIds]);
    await admin.query(`delete from storage.objects where bucket_id = 'profile-photos' and owner = any($1::uuid[])`, [ids]);
    await admin.query(`delete from auth.users where id = any($1::uuid[])`, [ids]);
    const left = (await admin.query(`select (select count(*)::int from auth.users where id = any($1::uuid[])) users,
      (select count(*)::int from private.account_review_cases where id = any($2::uuid[])) cases`, [ids, caseIds])).rows[0];
    check(left.users === 0 && left.cases === 0, `cleaned up (users ${left.users}, cases ${left.cases})`);
    await admin.end();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
