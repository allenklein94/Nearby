#!/usr/bin/env node
// Migration 20270406 under real concurrency, LOCAL replay database only.
//   1. The matching job runs twice at once while the same person returns by number and by device, 8 rounds: one case, never two, no error.
//   2. A report arrives while its target deletes, 8 rounds: the deletion never fails; the report is either on the record or was refused/cleared, never lost track of silently.
//   3. A legal hold is placed on an expired record's case while the purge runs, 8 rounds: either the hold wins and the case + record stay, or the case was already gone and the hold says so; never a hold on nothing.
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) { console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.'); process.exit(2); }
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const crypto = require('crypto');

let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
const connect = async () => { const c = new Client({ connectionString: url }); await c.connect(); return c; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const session = async (fn) => {
  const c = await connect();
  try { await c.query('begin'); const r = await fn(c); await sleep(100); await c.query('commit'); return { ok: true, r }; }
  catch (e) { await c.query('rollback').catch(() => {}); return { ok: false, error: e.message }; }
  finally { await c.end(); }
};
const asUser = (c, id) => c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: id, role: 'authenticated' })]);

(async () => {
  const db = await connect();
  const q = async (sql, args) => (await db.query(sql, args)).rows;
  const made = [];
  const number = () => `1561${crypto.randomInt(1000000, 9999999)}`;
  const person = async (phone) => {
    const id = crypto.randomUUID(); made.push(id);
    await q(`insert into auth.users (id, email, phone, phone_confirmed_at, aud, role, instance_id, created_at, updated_at, last_sign_in_at)
             values ($1, $2, $3, case when $3::text is null then null else now() end, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', now() - interval '30 days', now(), now())`,
      [id, `conc-${id}@local.invalid`, phone || number()]);
    await q(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
             values ($1, 'Concurrency Person', date '1995-03-01', now() - interval '30 days', now(), 'America/New_York', true, false) on conflict (id) do update set display_name = 'Concurrency Person'`, [id]);
    return id;
  };
  const del = async (c, id) => { await c.query('delete from public.profiles where id = $1', [id]); await c.query('delete from auth.users where id = $1', [id]); };
  const admin = await person();
  await q('update profiles set is_admin = true where id = $1', [admin]);
  const records = []; const cases = [];

  console.log('1. two matching runs and a device sighting at once');
  let wrong = [];
  for (let i = 0; i < 8; i += 1) {
    const n = number(); const reporter = await person(); const gone = await person(n);
    await q(`insert into reports (reporter_id, reported_id, reason) values ($1, $2, 'spam_scam')`, [reporter, gone]);
    const key = crypto.randomBytes(32);
    await q('insert into private.device_sightings (token_key, user_id) values ($1, $2)', [key, gone]);
    const s = await session((c) => del(c, gone));
    if (!s.ok) wrong.push(s.error);
    const back = await person(n);
    const [a, b, c] = await Promise.all([
      session((x) => x.query('select private.match_suspended_numbers()')),
      session((x) => x.query('select private.match_suspended_numbers()')),
      session((x) => x.query('insert into private.device_sightings (token_key, user_id) values ($1, $2)', [key, back])),
    ]);
    for (const r of [a, b, c]) if (!r.ok) wrong.push(r.error);
    await q('select private.match_suspended_numbers()');
    const [{ n: count }] = await q(`select count(*)::int n from private.account_review_cases where signal = 'prior_unresolved' and subject_user = $1`, [back]);
    if (count !== 1) wrong.push(`cases: ${count}`);
    const [{ f }] = await q(`select count(*)::int f from private.suspended_number_failures where step = 'match_unresolved'`);
    if (f) wrong.push(`match failures: ${f}`);
    const [{ id: rid }] = await q('select id from private.unresolved_account_records where former_account_id = $1', [gone]);
    records.push(rid);
  }
  check(wrong.length === 0, `8 rounds: one case each, no failure ${wrong.slice(0, 3).join(' | ')}`);

  console.log('2. a report arrives while its target deletes');
  wrong = []; const seen = { onRecord: 0, cleared: 0, refused: 0 };
  for (let i = 0; i < 8; i += 1) {
    const reporter = await person(); const gone = await person();
    const [x, y] = await Promise.all([
      session((c) => del(c, gone)),
      session(async (c) => { const r = await c.query(`insert into reports (reporter_id, reported_id, reason) values ($1, $2, 'spam_scam') returning id`, [reporter, gone]); return r.rows[0].id; }),
    ]);
    if (!x.ok) wrong.push(`deletion: ${x.error}`);
    if (!y.ok) { seen.refused += 1; continue; }
    const rows = await q('select id from private.unresolved_account_records where former_account_id = $1 and $2 = any(report_ids)', [gone, y.r]);
    if (rows.length) { seen.onRecord += 1; records.push(rows[0].id); } else seen.cleared += 1;
    const [rep] = await q('select reported_id from reports where id = $1', [y.r]);
    if (rep.reported_id) wrong.push('a report still names a deleted account');
  }
  check(wrong.length === 0, `8 rounds: the deletion never fails (on record ${seen.onRecord}, refused ${seen.refused}, arrived after the look ${seen.cleared}) ${wrong.slice(0, 3).join(' | ')}`);

  console.log('3. a hold on an expired record\'s case while the purge runs');
  wrong = []; const won = { hold: 0, purge: 0 };
  for (let i = 0; i < 8; i += 1) {
    const former = crypto.randomUUID();
    const [{ id: cid }] = await q(`insert into private.account_review_cases (signal, reason, former_subject_id, subject_deleted_at) values ('report', 'reported_profile', $1, now() - interval '91 days') returning id`, [former]);
    const [{ id: rid }] = await q(`insert into private.unresolved_account_records (former_account_id, reasons, case_ids, released_at, expires_at) values ($1, '{open_case}', array[$2]::uuid[], now() - interval '91 days', now() - interval '1 day') returning id`, [former, cid]);
    const [h, p] = await Promise.all([
      session(async (c) => { await asUser(c, admin); await c.query('set local role authenticated'); const r = await c.query(`select admin_place_legal_hold('review_case', $1, 'Preservation request from counsel', 'REF-1') j`, [cid]); return r.rows[0].j; }),
      session((c) => c.query('select private.purge_unresolved_account_records()')),
    ]);
    if (!p.ok) wrong.push(`purge: ${p.error}`);
    const [{ n: cn }] = await q('select count(*)::int n from private.account_review_cases where id = $1', [cid]);
    if (h.ok) {
      won.hold += 1;
      if (cn !== 1) wrong.push('a hold was accepted and the case went');
      const [{ n: rn }] = await q('select count(*)::int n from private.unresolved_account_records where id = $1', [rid]);
      if (rn !== 1) wrong.push('a hold was accepted and the record went');
      records.push(rid); cases.push(cid);
    } else { won.purge += 1; if (cn !== 0) wrong.push(`hold refused (${h.error}) and the case stayed`); }
  }
  check(wrong.length === 0, `8 rounds: a hold is never on nothing (hold won ${won.hold}, purge won ${won.purge}) ${wrong.slice(0, 3).join(' | ')}`);

  const su = new Client({ connectionString: url.replace(/\/\/[^:]+:/, '//supabase_admin:') }); await su.connect();
  await su.query(`alter table private.unresolved_account_records disable trigger user; alter table private.unresolved_account_events disable trigger user; alter table private.legal_holds disable trigger legal_hold_immutable;
    delete from private.legal_holds where reference = 'REF-1'; delete from private.account_review_cases where former_subject_id is not null or signal = 'prior_unresolved'; delete from private.unresolved_account_events; delete from private.unresolved_account_records;
    alter table private.unresolved_account_records enable trigger user; alter table private.unresolved_account_events enable trigger user; alter table private.legal_holds enable trigger legal_hold_immutable;`);
  await su.end();
  for (const id of made) { await q('delete from reports where reporter_id = $1', [id]).catch(() => {}); await q('delete from public.profiles where id = $1', [id]).catch(() => {}); await q('delete from auth.users where id = $1', [id]).catch(() => {}); }
  await db.end();
  console.log(failures ? `FAILED: ${failures}` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
