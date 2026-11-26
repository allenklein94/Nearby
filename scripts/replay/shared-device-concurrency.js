#!/usr/bin/env node
// Migration 20270376 (shared device notification token signals) under real concurrency, on the LOCAL replay database only
// (NEARBY_LOCAL_DB_URL; refuses anything else). A journey is one transaction and cannot race, so here separate sessions
// really overlap, each holding its transaction open before committing. Every token write is the app's own: a signed-in
// client updating profiles.expo_push_token under the real `authenticated` role.
//   1. six accounts register the same token from six parallel sessions: ONE case, six accounts, no deadlock, no failure.
//   2. that case is closed; four NEW accounts register it in parallel: still ONE case, still closed, four "new evidence".
//   3. a new account registers a token at the same moment an admin suspends the other account on it: whichever commits
//      first, ONE suspended-device case exists afterwards (the lock on the key serializes the two evaluations).
//   4. the same account registers the same token from three sessions at once: one sighting, no error.
//   5. option 3 (owner 2026-11-01): the corroborating photo case is created at the same moment the last account registers
//      the token (both orders): ONE many-accounts case afterwards (one evaluation at a time, after each side's own write).
// (Scenarios 1-2 first record a photo case tying two of the six accounts together: since option 3 the many-accounts rule
// needs one, and a phone shared by accounts with no other case opens nothing.)
// Uses test numbers on the replay database only; settings and every row it creates are restored / deleted afterwards
// (incl. what deleting the suspended test accounts keeps: 20270374's number record, 20270376's device keys).
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/shared-device-concurrency.js
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
const REGISTER = 'update profiles set expo_push_token = $1 where id = auth.uid()';

(async () => {
  const admin = await connect();
  const ids = [];
  const caseIds = [];
  const person = async (label) => {
    const id = crypto.randomUUID();
    ids.push(id);
    await admin.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`,
    [id, `${label}-${id.slice(0, 8)}@concurrency.invalid`, `1557${String(ids.length).padStart(8, '0')}`]);
    await admin.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
      values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false)`, [id, `Race ${label}`]);
    return id;
  };
  const token = () => `ExponentPushToken[race-${crypto.randomBytes(6).toString('hex')}]`;
  const caseFor = async (t) => (await admin.query(`select c.id, c.reason, c.status, c.new_evidence_at is not null as new_evidence,
      (select count(*)::int from private.account_review_case_members m where m.case_id = c.id) members,
      (select count(*)::int from private.account_review_case_events e where e.case_id = c.id and e.kind = 'new_evidence') evidence_events
    from private.account_review_case_devices cd join private.account_review_cases c on c.id = cd.case_id
    where cd.token_key = private.device_token_key($1)`, [t])).rows;
  const [{ s: saved }] = (await admin.query(`select to_jsonb(x) as s from private.account_signal_settings x`)).rows;
  const failuresBefore = (await admin.query('select count(*)::int n from private.device_signal_failures')).rows[0].n;
  try {
    await admin.query(`update private.account_signal_settings set shared_device_min_accounts = 3, shared_device_suspended_enabled = true where id`);
    const adminId = await person('admin');
    await admin.query(`update profiles set is_admin = true where id = $1`, [adminId]);

    console.log('1. six accounts register the same token at once');
    const t1 = token();
    const six = [];
    for (let i = 0; i < 6; i += 1) six.push(await person(`six${i}`));
    const photoCase = async (users) => {
      const { rows: [r] } = await admin.query(`insert into private.account_review_cases (signal, sha256, reason)
        values ('identical_photo', encode(extensions.gen_random_bytes(32), 'hex'), 'many_accounts') returning id`);
      caseIds.push(r.id);
      for (const u of users) await admin.query('insert into private.account_review_case_members (case_id, user_id) values ($1, $2)', [r.id, u]);
      return r.id;
    };
    await photoCase([six[0], six[1]]);
    let run = await together(six.map((u) => ({ sub: u, role: 'authenticated', sql: REGISTER, args: [t1] })));
    let c = await caseFor(t1);
    c.forEach((x) => caseIds.push(x.id));
    check(run.results.every((x) => x.ok), `all six sessions committed (${errors(run)})`);
    check(c.length === 1 && c[0].members === 6 && c[0].reason === 'many_accounts', `ONE case, six accounts (${c.length}, ${c[0]?.members}, ${c[0]?.reason})`);

    console.log('2. the case is closed; four new accounts arrive at once');
    await admin.query(`update private.account_review_cases set status = 'closed', closed_at = now(), outcome = 'no_action', note = 'family' where id = $1`, [c[0].id]);
    const four = [];
    for (let i = 0; i < 4; i += 1) four.push(await person(`four${i}`));
    run = await together(four.map((u) => ({ sub: u, role: 'authenticated', sql: REGISTER, args: [t1] })));
    c = await caseFor(t1);
    check(run.results.every((x) => x.ok), `all four sessions committed (${errors(run)})`);
    check(c.length === 1 && c[0].status === 'closed' && c[0].members === 10 && c[0].new_evidence && c[0].evidence_events === 4,
      `still ONE case, still closed, 10 accounts, four "new evidence" (${c.length}, ${c[0]?.status}, ${c[0]?.members}, ${c[0]?.evidence_events})`);

    console.log('3. a new account registers while an admin suspends the other account on that token (both orders)');
    for (const firstSuspend of [true, false]) {
      const t3 = token();
      const old = await person(firstSuspend ? 'oldA' : 'oldB');
      const fresh = await person(firstSuspend ? 'newA' : 'newB');
      run = await together([{ sub: old, role: 'authenticated', sql: REGISTER, args: [t3], hold: 0 }]);
      const steps = [
        { sub: adminId, role: 'authenticated', sql: `select public.admin_suspend_user($1, 'Repeated harassment after warnings') x`, args: [old], hold: firstSuspend ? HOLD_MS : HOLD_MS * 2 },
        { sub: fresh, role: 'authenticated', sql: REGISTER, args: [t3], hold: firstSuspend ? HOLD_MS * 2 : HOLD_MS },
      ];
      run = await together(steps);
      c = await caseFor(t3);
      c.forEach((x) => caseIds.push(x.id));
      check(run.results.every((x) => x.ok), `both committed (${errors(run)})`);
      check(c.length === 1 && c[0].reason === 'suspended_device' && c[0].members === 2,
        `ONE suspended-device case with both accounts (${c.length}, ${c[0]?.reason}, ${c[0]?.members})`);
    }

    console.log('4. one account registers the same token from three sessions at once');
    const t4 = token();
    const one = await person('one');
    run = await together([0, 1, 2].map(() => ({ sub: one, role: 'authenticated', sql: REGISTER, args: [t4] })));
    const n4 = (await admin.query(`select count(*)::int n from private.device_sightings where user_id = $1`, [one])).rows[0].n;
    check(run.results.every((x) => x.ok), `all three committed (${errors(run)})`);
    check(n4 === 1, `one sighting (${n4})`);

    console.log('5. the corroborating photo case and the last account\'s registration at the same moment (both orders)');
    for (const caseFirst of [true, false]) {
      const t5 = token();
      const [u1, u2, u3] = [await person('c1'), await person('c2'), await person('c3')];
      await together([u1, u2].map((u) => ({ sub: u, role: 'authenticated', sql: REGISTER, args: [t5], hold: 0 })));
      const steps = [
        { sub: u3, role: 'authenticated', sql: REGISTER, args: [t5], hold: caseFirst ? HOLD_MS * 2 : HOLD_MS },
        { sub: u1, role: 'postgres', sql: `with c as (insert into private.account_review_cases (signal, sha256, reason)
              values ('identical_photo', encode(extensions.gen_random_bytes(32), 'hex'), 'many_accounts') returning id)
            insert into private.account_review_case_members (case_id, user_id) select c.id, u from c, unnest($1::uuid[]) u returning case_id`,
          args: [[u1, u2]], hold: caseFirst ? HOLD_MS : HOLD_MS * 2 },
      ];
      run = await together(steps);
      const photo = run.results[1].row?.case_id;
      if (photo) caseIds.push(photo);
      c = await caseFor(t5);
      c.forEach((x) => caseIds.push(x.id));
      check(run.results.every((x) => x.ok), `both committed (${errors(run)})`);
      check(c.length === 1 && c[0].reason === 'many_accounts' && c[0].members === 3,
        `${caseFirst ? 'case first' : 'registration first'}: ONE many-accounts case with the three accounts (${c.length}, ${c[0]?.reason}, ${c[0]?.members})`);
    }

    const f = (await admin.query('select count(*)::int n from private.device_signal_failures')).rows[0].n;
    check(f === failuresBefore, `no failure rows (${f - failuresBefore} new)`);
    const stuck = (await admin.query(`select count(*)::int n from profiles where id = any($1::uuid[]) and (profile_hidden or suspended_at is not null)
      and id not in (select user_id from account_moderation_actions where action = 'suspend')`, [ids])).rows[0].n;
    check(stuck === 0, `no account restricted or hidden except the two an admin suspended (${stuck})`);
  } finally {
    await admin.query(`update private.account_signal_settings set shared_device_min_accounts = $1, shared_device_suspended_enabled = $2 where id`,
      [saved.shared_device_min_accounts, saved.shared_device_suspended_enabled]);
    if (caseIds.length) await admin.query(`delete from private.account_review_cases where id = any($1::uuid[])`, [caseIds]);
    await admin.query(`delete from push_outbox where recipient_id = any($1::uuid[])`, [ids]);
    await admin.query(`delete from auth.users where id = any($1::uuid[])`, [ids]);
    // deleting the suspended test accounts made 20270374 + 20270376 keep their records: removed (test data only)
    await admin.query(`delete from private.suspended_device_keys where former_account_id = any($1::uuid[])`, [ids]);
    if ((await admin.query(`select to_regclass('private.suspended_account_records') is not null as x`)).rows[0].x) {
      await admin.query('begin');
      await admin.query('set local session_replication_role = replica');
      await admin.query(`delete from private.suspended_account_records where former_account_id = any($1::uuid[])`, [ids]);
      await admin.query('commit');
      await admin.query(`delete from private.phone_match_queue where user_id = any($1::uuid[])`, [ids]);
    }
    const left = (await admin.query(`select (select count(*)::int from auth.users where id = any($1::uuid[])) users,
      (select count(*)::int from private.account_review_cases where id = any($2::uuid[])) cases,
      (select count(*)::int from private.device_sightings where user_id = any($1::uuid[])) sightings,
      (select count(*)::int from private.suspended_device_keys where former_account_id = any($1::uuid[])) kept`, [ids, caseIds])).rows[0];
    check(left.users === 0 && left.cases === 0 && left.sightings === 0 && left.kept === 0,
      `cleaned up (users ${left.users}, cases ${left.cases}, sightings ${left.sightings}, kept keys ${left.kept})`);
    await admin.end();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
