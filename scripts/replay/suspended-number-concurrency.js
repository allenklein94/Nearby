#!/usr/bin/env node
// Migration 20270374 (suspended-number retention) under real concurrency, on the LOCAL replay database only
// (NEARBY_LOCAL_DB_URL; refuses anything else). A journey is one transaction and cannot race, so here separate sessions
// really overlap, each holding its transaction open before committing.
//   1. five suspended accounts are deleted from five parallel sessions: five records, each kept once, no deadlock.
//   2. five new accounts sign up with those numbers; FOUR matcher runs (cron overlapping itself) start together: exactly ONE
//      case per account, every queue row taken once, the queue empty afterwards.
//   3. one account queued twice (it confirms one matched number, then another) with two runs at once: still ONE case for it,
//      the second record = one new-evidence event (never a second case, never twice).
//   4. an admin closes a case while a run adds new evidence to it: the case ends closed with the evidence recorded once;
//      evidence that landed after the close is flagged "new evidence since closed" (never lost, never reopened).
//   5. sign-ups never wait on the matcher: a sign-up committed while a run holds the queue is queued and matched next run.
// Every row it creates is deleted afterwards (records via session_replication_role, on the replay database only).
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/suspended-number-concurrency.js
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

// each step = { sub, role, sql, args, hold }: its own session (as that role, or the database owner = cron when no role),
// holds, then commits
async function together(steps) {
  const t0 = Date.now();
  const results = await Promise.all(steps.map(async (step) => {
    const c = await connect();
    try {
      await c.query('begin');
      if (step.role) {
        await c.query(claims(step.sub, step.role));
        await c.query(`set local role ${step.role}`);
      }
      if (step.delay) await sleep(step.delay);
      const r = await c.query(step.sql, step.args);
      await sleep(step.hold ?? HOLD_MS);
      await c.query('commit');
      return { ok: true, row: r.rows[0], at: Date.now() - t0 };
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
  const db = await connect();
  const ids = [];
  const formerIds = [];
  const phone = (i) => `1557${String(Date.now() % 1000000).padStart(6, '0')}${String(i).padStart(2, '0')}`;
  const base = phone(0).slice(0, 10);
  const num = (i) => `${base}${String(i).padStart(2, '0')}`;
  const person = async (label, ph, { profile = true } = {}) => {
    const id = crypto.randomUUID();
    ids.push(id);
    await db.query(`insert into auth.users (id, aud, role, email, created_at, phone) values ($1, 'authenticated', 'authenticated', $2, now(), $3)`,
      [id, `${label}-${id.slice(0, 8)}@concurrency.invalid`, ph]);
    await db.query(`update auth.users set phone_confirmed_at = now() where id = $1`, [id]);
    if (profile) {
      await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
        values ($1, $2, date '1994-05-01', now(), now(), 'America/New_York', true, false)`, [id, `Race ${label}`]);
    }
    return id;
  };
  const caseOf = async (u) => (await db.query(`select id, status, new_evidence_at from private.account_review_cases
    where signal = 'prior_suspension' and subject_user = $1`, [u])).rows;
  const keyOf = async (ph) => (await db.query(`select private.phone_number_key($1) k`, [ph])).rows[0].k;

  try {
    const adminA = await person('admin', num(99));
    await db.query(`select set_config('app.trusted_update', 'on', false)`);
    await db.query(`update profiles set is_admin = true where id = $1`, [adminA]);
    await db.query(`delete from private.phone_match_queue`);

    console.log('1. five suspended accounts deleted from five parallel sessions');
    const gone = [];
    for (let i = 1; i <= 5; i += 1) {
      const u = await person(`gone${i}`, num(i));
      gone.push(u);
      formerIds.push(u);
      const r = await together([{ sub: adminA, role: 'authenticated', sql: `select public.admin_suspend_user($1, 'Race test suspension') x`, args: [u], hold: 0 }]);
      if (!r.results[0].ok) check(false, `suspend ${errors(r)}`);
    }
    let run = await together(gone.map((u) => ({ sql: 'delete from auth.users where id = $1 returning id', args: [u] })));
    const recs = (await db.query(`select former_account_id, count(*)::int n from private.suspended_account_records
      where former_account_id = any($1::uuid[]) group by 1`, [gone])).rows;
    check(run.results.every((r) => r.ok), `every deletion committed (${errors(run)}), ${run.ms} ms`);
    check(recs.length === 5 && recs.every((r) => r.n === 1), `five records, each once (${recs.length})`);

    console.log('2. five sign-ups with those numbers; four matcher runs at once');
    const fresh = [];
    for (let i = 1; i <= 5; i += 1) fresh.push(await person(`fresh${i}`, num(i)));
    run = await together([0, 1, 2, 3].map(() => ({ sql: 'select private.match_suspended_numbers() opened' })));
    const opened = run.results.reduce((a, r) => a + (r.ok ? r.row.opened : 0), 0);
    const perAccount = await Promise.all(fresh.map(caseOf));
    const queueLeft = (await db.query(`select count(*)::int n from private.phone_match_queue where user_id = any($1::uuid[])`, [fresh])).rows[0].n;
    check(run.results.every((r) => r.ok), `every run committed (${errors(run)}), ${run.ms} ms`);
    check(opened === 5 && perAccount.every((c) => c.length === 1), `one case per account, five opened in total (${opened}; ${perAccount.map((c) => c.length)})`);
    check(queueLeft === 0, `queue empty (${queueLeft})`);

    console.log('3. one account queued twice (two matched numbers), two runs at once');
    const second = await person('second-gone', num(6));
    formerIds.push(second);
    await together([{ sub: adminA, role: 'authenticated', sql: `select public.admin_suspend_user($1, 'Race test suspension') x`, args: [second], hold: 0 }]);
    await db.query(`delete from auth.users where id = $1`, [second]);
    const twice = await person('twice', num(7));
    const goneSeven = await person('gone7', num(8));
    formerIds.push(goneSeven);
    await together([{ sub: adminA, role: 'authenticated', sql: `select public.admin_suspend_user($1, 'Race test suspension') x`, args: [goneSeven], hold: 0 }]);
    await db.query(`delete from auth.users where id = $1`, [goneSeven]);
    // two queue rows for the same account, one per matched record (as two confirmations would leave)
    await db.query(`insert into private.phone_match_queue (user_id, phone_key) values ($1, $2), ($1, $3)`,
      [twice, await keyOf(num(6)), await keyOf(num(8))]);
    run = await together([0, 1].map(() => ({ sql: 'select private.match_suspended_numbers() opened' })));
    const tw = await caseOf(twice);
    const ev = tw[0] ? (await db.query(`select count(*)::int n from private.account_review_case_events where case_id = $1 and kind = 'new_evidence'`, [tw[0].id])).rows[0].n : -1;
    check(run.results.every((r) => r.ok), `both runs committed (${errors(run)})`);
    check(tw.length === 1 && ev === 1, `one case, the second record = one new-evidence event (${tw.length}, ${ev})`);

    console.log('4. an admin closes a case while a run adds new evidence to it');
    const target = fresh[0];
    const [tc] = await caseOf(target);
    const third = await person('third-gone', num(9));
    formerIds.push(third);
    await together([{ sub: adminA, role: 'authenticated', sql: `select public.admin_suspend_user($1, 'Race test suspension') x`, args: [third], hold: 0 }]);
    await db.query(`delete from auth.users where id = $1`, [third]);
    await db.query(`insert into private.phone_match_queue (user_id, phone_key) values ($1, $2)`, [target, await keyOf(num(9))]);
    run = await together([
      { sub: adminA, role: 'authenticated', sql: `select public.admin_close_account_review_case($1, 'no_action', 'Reassigned number') x`, args: [tc.id] },
      { sql: 'select private.match_suspended_numbers() opened' },
    ]);
    const [after] = await caseOf(target);
    const ev4 = (await db.query(`select count(*)::int n from private.account_review_case_events where case_id = $1 and kind = 'new_evidence'`, [tc.id])).rows[0].n;
    const ev4d = (await db.query(`select (detail ->> 'while_closed')::boolean c from private.account_review_case_events
      where case_id = $1 and kind = 'new_evidence'`, [tc.id])).rows[0]?.c;
    check(run.results.every((r) => r.ok), `both committed (${errors(run)})`);
    check(after.status === 'closed' && ev4 === 1, `closed, evidence recorded once (${after.status}, ${ev4})`);
    check(ev4d === (after.new_evidence_at !== null), `evidence that landed after the close is flagged, before it is not (landed while closed ${ev4d}, flagged ${after.new_evidence_at !== null})`);

    console.log('5. a sign-up while a run holds the queue: never waits, matched next run');
    const lateGone = await person('late-gone', num(10));
    formerIds.push(lateGone);
    await together([{ sub: adminA, role: 'authenticated', sql: `select public.admin_suspend_user($1, 'Race test suspension') x`, args: [lateGone], hold: 0 }]);
    await db.query(`delete from auth.users where id = $1`, [lateGone]);
    const late = crypto.randomUUID();
    ids.push(late);
    run = await together([
      { sql: 'select private.match_suspended_numbers() opened', hold: 1500 },
      { sql: `with u as (insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
                values ($1, 'authenticated', 'authenticated', $2, now(), $3, now()) returning id) select clock_timestamp() t from u`,
        args: [late, `late-${late.slice(0, 8)}@concurrency.invalid`, num(10)], delay: 200, hold: 0 },
    ]);
    const signupMs = run.results[1].at;
    check(run.results.every((r) => r.ok), `both committed (${errors(run)})`);
    check(signupMs < 1200, `the sign-up committed while the run still held its transaction (${signupMs} ms < 1500)`);
    const before = await caseOf(late);
    await db.query('select private.match_suspended_numbers()');
    const afterLate = await caseOf(late);
    check(before.length === 0 && afterLate.length === 1, `matched on the next run (${before.length} -> ${afterLate.length})`);
  } finally {
    await db.query(`delete from auth.users where id = any($1::uuid[])`, [ids]);
    await db.query(`set session_replication_role = replica`);
    await db.query(`delete from private.suspended_account_records where former_account_id = any($1::uuid[])`, [formerIds]);
    await db.query(`set session_replication_role = origin`);
    const left = (await db.query(`select (select count(*)::int from auth.users where id = any($1::uuid[])) users,
      (select count(*)::int from private.suspended_account_records where former_account_id = any($2::uuid[])) records,
      (select count(*)::int from private.account_review_cases where subject_user = any($1::uuid[])) cases,
      (select count(*)::int from private.phone_match_queue where user_id = any($1::uuid[])) queue`, [ids, formerIds])).rows[0];
    check(left.users === 0 && left.records === 0 && left.cases === 0 && left.queue === 0, `cleaned up (${JSON.stringify(left)})`);
    await db.end();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
