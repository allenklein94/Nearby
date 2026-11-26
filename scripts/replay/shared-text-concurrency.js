#!/usr/bin/env node
// Migration 20270378 (the same public text on several accounts) under real concurrency, on the LOCAL replay database only
// (NEARBY_LOCAL_DB_URL; refuses anything else). A journey is one transaction and cannot race, so here separate sessions
// really overlap, each holding its transaction open before committing. Every write is the app's own: a signed-in client
// updating its profile bio or creating a public gathering under the real `authenticated` role.
//   1. six accounts save the same bio from six parallel sessions: ONE case, six accounts, no deadlock, no failure.
//   2. that case is closed; four NEW accounts save it in parallel: still ONE case, still closed, four "new evidence".
//   3. the same group's bio AND gathering description reach the threshold at the same moment (two sessions): ONE case
//      holding both texts, never two (the cluster lock serializes the decision).
//   4. the same account saves the same bio from three sessions at once: one sighting, no error.
// 20270373 screens public text before it publishes: each text is first recorded as a low-risk English screening for its
// author (what the screen-user-content edge function records), with English temporarily calibrated. Uses test numbers on
// the replay database only; settings, calibration and every row it creates are restored / deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/shared-text-concurrency.js
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

async function together(steps) {
  const results = await Promise.all(steps.map(async (step) => {
    const c = await connect();
    try {
      await c.query('begin');
      await c.query(claims(step.sub, step.role));
      await c.query(`set local role ${step.role}`);
      const r = await c.query(step.sql, step.args);
      await sleep(step.hold ?? HOLD_MS);
      await c.query('commit');
      return { ok: true, row: r.rows[0] };
    } catch (e) {
      await c.query('rollback').catch(() => {});
      return { ok: false, error: e.message };
    } finally {
      await c.end();
    }
  }));
  return { results };
}
const errors = (run) => run.results.filter((r) => !r.ok).map((r) => r.error).join('; ') || 'no errors';
const BIO = 'update profiles set bio = $1 where id = auth.uid()';
const GATHERING = `insert into gatherings (host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
  values (auth.uid(), 'Race gathering', $1, now() + interval '3 days', 26.59, -80.03, 'Coffee', 'x', 'everyone')`;
const words = ['harbor', 'lantern', 'meadow', 'pottery', 'violin', 'canyon', 'orchard', 'sailing', 'bakery', 'mosaic', 'falcon',
  'lagoon', 'quilting', 'tandem', 'sketching', 'ferns', 'compost', 'kites', 'tidepool', 'banjo'];
// a fresh long, specific text per call (>= 80 characters, >= 12 distinct words)
const text = () => `Race ${crypto.randomBytes(4).toString('hex')} ${words.slice().sort(() => Math.random() - 0.5).join(' ')} every Saturday morning`;

(async () => {
  const admin = await connect();
  const ids = [];
  const person = async (label) => {
    const id = crypto.randomUUID();
    ids.push(id);
    await admin.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`,
    [id, `${label}-${id.slice(0, 8)}@concurrency.invalid`, `1558${String(ids.length).padStart(8, '0')}`]);
    await admin.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
      values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false)`, [id, `Race ${label}`]);
    return id;
  };
  const ugc = (await admin.query(`select to_regclass('private.ugc_screenings') is not null as x`)).rows[0].x;
  const savedCalibration = ugc ? (await admin.query(`select language, status, calibrated_at, evidence from private.ugc_language_calibration`)).rows : [];
  const screened = async (u, t) => {
    if (!ugc) return;
    await admin.query(`select public.record_ugc_screening($1, private.ugc_text_sha($2), 'bio', false, 'low', '{}', array['en'], 'race', 'race')`, [u, t]);
  };
  const bio = async (u, t) => { await screened(u, t); return { sub: u, role: 'authenticated', sql: BIO, args: [t] }; };
  const gathering = async (u, t) => { await screened(u, t); await screened(u, 'Race gathering'); return { sub: u, role: 'authenticated', sql: GATHERING, args: [t] }; };
  const casesFor = async (t) => (await admin.query(`select c.id, c.reason, c.status,
      (select count(*)::int from private.account_review_case_members m where m.case_id = c.id) members,
      (select count(*)::int from private.account_review_case_texts x where x.case_id = c.id) texts,
      (select count(*)::int from private.account_review_case_events e where e.case_id = c.id and e.kind = 'new_evidence') evidence_events
    from private.account_review_case_texts ct join private.account_review_cases c on c.id = ct.case_id
    where ct.text_key = private.shared_text_key($1)`, [t])).rows;
  const [{ s: saved }] = (await admin.query(`select to_jsonb(x) as s from private.account_signal_settings x`)).rows;
  const failuresBefore = (await admin.query('select count(*)::int n from private.text_signal_failures')).rows[0].n;
  const casesBefore = (await admin.query(`select coalesce(array_agg(id), '{}') a from private.account_review_cases where signal = 'shared_text'`)).rows[0].a;
  try {
    await admin.query(`update private.account_signal_settings set shared_text_min_accounts = 5 where id`);
    if (ugc) await admin.query(`update private.ugc_language_calibration set status = 'calibrated', calibrated_at = now(), evidence = 'race' where language in ('en', 'names')`);

    console.log('1. six accounts save the same bio at once');
    const t1 = text();
    const six = [];
    for (let i = 0; i < 6; i += 1) six.push(await person(`six${i}`));
    let run = await together(await Promise.all(six.map((u) => bio(u, t1))));
    let c = await casesFor(t1);
    check(run.results.every((x) => x.ok), `all six sessions committed (${errors(run)})`);
    check(c.length === 1 && c[0].members === 6 && c[0].reason === 'many_accounts', `ONE case, six accounts (${c.length}, ${c[0]?.members}, ${c[0]?.reason})`);

    console.log('2. the case is closed; four new accounts arrive at once');
    await admin.query(`update private.account_review_cases set status = 'closed', closed_at = now(), outcome = 'no_action', note = 'club text' where id = $1`, [c[0].id]);
    const four = [];
    for (let i = 0; i < 4; i += 1) four.push(await person(`four${i}`));
    run = await together(await Promise.all(four.map((u) => bio(u, t1))));
    c = await casesFor(t1);
    check(run.results.every((x) => x.ok), `all four sessions committed (${errors(run)})`);
    check(c.length === 1 && c[0].status === 'closed' && c[0].members === 10 && c[0].evidence_events === 4,
      `still ONE case, still closed, 10 accounts, four "new evidence" (${c.length}, ${c[0]?.status}, ${c[0]?.members}, ${c[0]?.evidence_events})`);

    console.log('3. one group\'s bio and gathering description reach five accounts at the same moment (three rounds)');
    for (let round = 0; round < 3; round += 1) {
      const tb = text();
      const tg = text();
      const group = [];
      for (let i = 0; i < 5; i += 1) group.push(await person(`grp${round}${i}`));
      for (const u of group.slice(0, 4)) {
        const prep = await together([{ ...(await bio(u, tb)), hold: 0 }, { ...(await gathering(u, tg)), hold: 0 }]);
        if (!prep.results.every((x) => x.ok)) check(false, `group setup (${errors(prep)})`);
      }
      run = await together([await bio(group[4], tb), await gathering(group[4], tg)]);
      const cb = await casesFor(tb);
      const cg = await casesFor(tg);
      check(run.results.every((x) => x.ok), `both committed (${errors(run)})`);
      check(cb.length === 1 && cg.length === 1 && cb[0].id === cg[0].id && cb[0].texts === 2 && cb[0].members === 5,
        `ONE case holding both texts, five accounts (${cb[0]?.id === cg[0]?.id}, texts ${cb[0]?.texts}, members ${cb[0]?.members})`);
    }

    console.log('4. one account saves the same bio from three sessions at once');
    const t4 = text();
    const one = await person('one');
    const step4 = await bio(one, t4);
    run = await together([step4, step4, step4]);
    const n4 = (await admin.query(`select count(*)::int n from private.text_sightings where user_id = $1`, [one])).rows[0].n;
    check(run.results.every((x) => x.ok), `all three committed (${errors(run)})`);
    check(n4 === 1, `one sighting (${n4})`);

    const f = (await admin.query('select count(*)::int n from private.text_signal_failures')).rows[0].n;
    check(f === failuresBefore, `no failure rows (${f - failuresBefore} new)`);
    const stuck = (await admin.query(`select count(*)::int n from profiles where id = any($1::uuid[]) and (profile_hidden or suspended_at is not null)`, [ids])).rows[0].n;
    check(stuck === 0, `no account restricted or hidden (${stuck})`);
  } finally {
    await admin.query(`update private.account_signal_settings set shared_text_min_accounts = $1 where id`, [saved.shared_text_min_accounts]);
    await admin.query(`delete from private.account_review_cases where signal = 'shared_text' and not (id = any($1::uuid[]))`, [casesBefore]);
    for (const r of savedCalibration) {
      await admin.query(`update private.ugc_language_calibration set status = $2, calibrated_at = $3, evidence = $4 where language = $1`,
        [r.language, r.status, r.calibrated_at, r.evidence]);
    }
    if (ugc) await admin.query(`delete from private.ugc_screenings where user_id = any($1::uuid[])`, [ids]);
    await admin.query(`delete from push_outbox where recipient_id = any($1::uuid[])`, [ids]);
    await admin.query(`delete from gatherings where host_id = any($1::uuid[])`, [ids]);
    await admin.query(`delete from profiles where id = any($1::uuid[])`, [ids]);
    await admin.query(`delete from auth.users where id = any($1::uuid[])`, [ids]);
    const left = (await admin.query(`select (select count(*)::int from auth.users where id = any($1::uuid[])) users,
      (select count(*)::int from private.account_review_cases where signal = 'shared_text' and not (id = any($2::uuid[]))) cases,
      (select count(*)::int from private.text_sightings where user_id = any($1::uuid[])) sightings,
      (select count(*)::int from gatherings where host_id = any($1::uuid[])) gatherings`, [ids, casesBefore])).rows[0];
    check(left.users === 0 && left.cases === 0 && left.sightings === 0 && left.gatherings === 0,
      `cleaned up (users ${left.users}, cases ${left.cases}, sightings ${left.sightings}, gatherings ${left.gatherings})`);
    await admin.end();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
