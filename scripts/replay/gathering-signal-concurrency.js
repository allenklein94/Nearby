#!/usr/bin/env node
// Migration 20270385 (gathering review signals) under real concurrency, on the LOCAL replay database only
// (NEARBY_LOCAL_DB_URL; refuses anything else). A journey is one transaction and cannot race, so here separate sessions
// really overlap, each holding its transaction open before committing.
//   1. 20 New accounts join one gathering from 20 parallel sessions: every join approved, counted TOGETHER (one
//      attendee_surge_new signal on the host counting all 20, one case).
//   2. 30 established accounts join one public gathering in parallel: every join approved, exactly ONE size mark and one
//      large_public_gathering note (attendance), never two.
//   3. a host cancels 4 joined gatherings from 4 parallel sessions: every cancellation goes through, one create_cancel
//      signal (counting all 4), one case.
//   4. two sessions raise the same public gathering's capacity past 50 at once (set_gathering_capacity, the app's path):
//      one mark, one note.
//   5. two hosts join each other's surging gatherings at the same moment (a possible lock cycle between detectors): both
//      joins always commit (a detector failure is caught, never the join).
//   6. (owner 2026-11-02) a host whose earlier behaviour case was closed months ago raises two public gatherings to
//      capacity 50 from two parallel sessions: exactly ONE new case, the old one stays closed and untouched; a host whose
//      large-gathering case was closed 'no_action' 10 days ago does the same: NO case (size-only stays quiet).
// Uses the APPROVED numbers (20270386) on the replay database only; settings, rules and every row it creates are
// restored / deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/gathering-signal-concurrency.js
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
const claims = (sub) => `select set_config('request.jwt.claims', $$${JSON.stringify({ sub, role: 'authenticated' })}$$, true)`;

// each step = { sub, sql, args }: its own session, as the signed-in client, holds HOLD_MS, then commits
async function together(steps) {
  const t0 = Date.now();
  const results = await Promise.all(steps.map(async (step) => {
    const c = await connect();
    try {
      await c.query('begin');
      await c.query(claims(step.sub));
      await c.query('set local role authenticated');
      await c.query(step.sql, step.args);
      await sleep(HOLD_MS);
      await c.query('commit');
      return { ok: true };
    } catch (e) {
      await c.query('rollback').catch(() => {});
      return { ok: false, error: e.message };
    } finally {
      await c.end();
    }
  }));
  return { results, ms: Date.now() - t0 };
}

(async () => {
  const admin = await connect();
  const ids = [];
  const person = async (label, days = 20) => {
    const id = crypto.randomUUID();
    ids.push(id);
    await admin.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - make_interval(days => $4), $3, now())`,
    [id, `${label}-${id.slice(0, 8)}@concurrency.invalid`, `1556${String(ids.length).padStart(8, '0')}`, days]);
    await admin.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
      values ($1, $2, date '1994-05-01', now() - make_interval(days => $3), now(), 'America/New_York', true, false)`, [id, `Race ${label}`, days]);
    return id;
  };
  const gathering = async (host, { cap = null, title = 'Race' } = {}) => (await admin.query(
    `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public, capacity)
     values ($1, $2, now() + interval '2 days', 10.02, -10.03, 'Pickleball', 'race', 'everyone', true, $3) returning id`, [host, title, cap])).rows[0].id;
  const join = (sub, g) => ({ sub, sql: 'select join_gathering($1)', args: [g] });
  const errors = (run) => run.results.filter((r) => !r.ok).map((r) => r.error).join('; ') || 'no errors';
  const one = async (sql, args) => (await admin.query(sql, args)).rows[0];

  const [{ s: savedBehavior }] = (await admin.query(`select to_jsonb(x) as s from private.behavior_signal_settings x`)).rows;
  const [{ s: savedGathering }] = (await admin.query(`select to_jsonb(x) as s from private.gathering_signal_settings x`)).rows;
  const savedRules = (await admin.query(`select * from private.rate_limit_rules`)).rows;
  const gatherings = [];
  try {
    await admin.query(`delete from private.rate_limit_rules where action in ('gathering_create')`);
    await admin.query(`update private.gathering_signal_settings set surge_min_joiners = 15, surge_window_minutes = 60, surge_new_share = 0.5,
      cancel_min_count = 3, cancel_window_days = 7, cancel_max_age_hours = 48,
      large_min_capacity = 50, large_min_attendees = 25, large_repeat_quiet_days = 90 where id`);
    await admin.query(`update private.behavior_signal_settings set review_cases_enabled = true, case_min_signal_kinds = 2,
      case_window_hours = 24, max_new_cases_per_day = 1000,
      case_alone_kinds = array['repeated_messages', 'limit_burst', 'attendee_surge_new', 'create_cancel', 'large_public_gathering'] where id`);

    console.log('1. 20 New accounts join one gathering from 20 parallel sessions');
    const h1 = await person('host1');
    const fresh = [];
    for (let i = 0; i < 20; i += 1) fresh.push(await person(`new${i}`, 1));
    const g1 = await gathering(h1); gatherings.push(g1);
    let run = await together(fresh.map((p) => join(p, g1)));
    let a = await one(`select count(*)::int n from gathering_interest where gathering_id = $1 and status = 'approved'`, [g1]);
    let sg = await one(`select count(*)::int n, max((evidence ->> 'joiners')::int) j, array_agg(distinct kind) k from private.behavior_signals where user_id = $1`, [h1]);
    let cs = await one(`select count(*)::int n from private.account_review_cases where signal = 'behavior' and subject_user = $1`, [h1]);
    check(run.results.every((r) => r.ok), `every join committed (${errors(run)}), ${run.ms} ms`);
    check(a.n === 20, `all 20 approved (${a.n})`);
    check(sg.n === 1 && sg.j === 20 && sg.k.join() === 'attendee_surge_new', `one attendee_surge_new row counting all 20 (rows ${sg.n}, joiners ${sg.j}, kinds ${sg.k})`);
    check(cs.n === 1, `one case (${cs.n})`);

    console.log('2. 30 established accounts join one public gathering in parallel');
    const h2 = await person('host2');
    const est = [];
    for (let i = 0; i < 30; i += 1) est.push(await person(`est${i}`));
    const g2 = await gathering(h2); gatherings.push(g2);
    run = await together(est.map((p) => join(p, g2)));
    a = await one(`select count(*)::int n from gathering_interest where gathering_id = $1 and status = 'approved'`, [g2]);
    const marks = await one(`select count(*)::int n from private.gathering_size_marks where series_ref = $1`, [g2]);
    sg = await one(`select count(*)::int n, max(hits) hits, max(evidence ->> 'attendees') att from private.behavior_signals where user_id = $1 and kind = 'large_public_gathering'`, [h2]);
    check(run.results.every((r) => r.ok), `every join committed (${errors(run)}), ${run.ms} ms`);
    check(a.n === 30, `all 30 approved (${a.n})`);
    check(marks.n === 1 && sg.n === 1 && sg.hits === 1 && sg.att === '25', `exactly one mark and one note at 25 (marks ${marks.n}, rows ${sg.n}, hits ${sg.hits}, attendees ${sg.att})`);

    console.log('3. a host cancels 4 joined gatherings from 4 parallel sessions');
    const h3 = await person('host3');
    const g3 = [];
    for (let i = 0; i < 4; i += 1) {
      const g = await gathering(h3); g3.push(g); gatherings.push(g);
      await admin.query(`insert into gathering_interest (gathering_id, user_id, status) values ($1, $2, 'approved')`, [g, est[i]]);
    }
    run = await together(g3.map((g) => ({ sub: h3, sql: 'select cancel_gathering($1)', args: [g] })));
    const left3 = await one(`select count(*)::int n from gatherings where id = any($1::uuid[])`, [g3]);
    sg = await one(`select count(*)::int n, max((evidence ->> 'cancellations')::int) c from private.behavior_signals where user_id = $1 and kind = 'create_cancel'`, [h3]);
    cs = await one(`select count(*)::int n from private.account_review_cases where signal = 'behavior' and subject_user = $1`, [h3]);
    check(run.results.every((r) => r.ok), `every cancellation committed (${errors(run)}), ${run.ms} ms`);
    check(left3.n === 0, `all 4 cancelled (${left3.n} left)`);
    check(sg.n === 1 && sg.c === 4, `one create_cancel row counting all 4 (rows ${sg.n}, cancellations ${sg.c})`);
    check(cs.n === 1, `one case (${cs.n})`);

    console.log('4. two sessions raise one public gathering past capacity 50 at once');
    const h4 = await person('host4');
    const g4 = await gathering(h4, { cap: 20 }); gatherings.push(g4);
    run = await together([60, 70].map((cap) => ({ sub: h4, sql: 'select set_gathering_capacity($2, $1)', args: [cap, g4] })));
    const m4 = await one(`select count(*)::int n from private.gathering_size_marks where series_ref = $1`, [g4]);
    sg = await one(`select count(*)::int n, max(hits) hits from private.behavior_signals where user_id = $1 and kind = 'large_public_gathering'`, [h4]);
    check(run.results.every((r) => r.ok), `both edits committed (${errors(run)})`);
    check(m4.n === 1 && sg.n === 1 && sg.hits === 1, `one mark, one note (marks ${m4.n}, rows ${sg.n}, hits ${sg.hits})`);

    console.log('5. two hosts join each other\'s surging gatherings at the same moment');
    const ha = await person('hostA', 1);
    const hb = await person('hostB', 1);
    const ga = await gathering(ha); const gb = await gathering(hb); gatherings.push(ga, gb);
    for (const p of fresh.slice(0, 14)) {
      await admin.query(`insert into gathering_interest (gathering_id, user_id, status) values ($1, $2, 'approved'), ($3, $2, 'approved')`, [ga, p, gb]);
      await admin.query(`insert into private.behavior_events (user_id, kind, ref) values ($1, 'attendee_join', $2), ($1, 'attendee_join', $3)`, [p, ga, gb]);
    }
    run = await together([join(hb, ga), join(ha, gb)]);
    const both = await one(`select count(*)::int n from gathering_interest where (gathering_id = $1 and user_id = $2) or (gathering_id = $3 and user_id = $4)`, [ga, hb, gb, ha]);
    check(run.results.every((r) => r.ok), `both joins committed (${errors(run)}), ${run.ms} ms`);
    check(both.n === 2, `both joined (${both.n})`);

    console.log('6. fresh qualifying signals after a closed case, from two parallel sessions');
    // two of the host's own public gatherings raised to capacity 50 at once (set_gathering_capacity, the app's path)
    const raiseBoth = async (host) => {
      const gs = [await gathering(host, { cap: 20 }), await gathering(host, { cap: 20 })];
      gatherings.push(...gs);
      return together(gs.map((g) => ({ sub: host, sql: 'select set_gathering_capacity($2, $1)', args: [50, g] })));
    };
    const closedCase = async (host, outcome, daysAgo, kind) => (await admin.query(`insert into private.account_review_cases
      (signal, reason, subject_user, evidence, status, closed_at, outcome) values ('behavior', 'behavior_pattern', $1,
      jsonb_build_object('signals', jsonb_build_array(jsonb_build_object('kind', $4::text))), 'closed', now() - make_interval(days => $3), $2)
      returning id, to_jsonb(account_review_cases) - 'updated_at' as row`, [host, outcome, daysAgo, kind])).rows[0];
    const h6 = await person('host6');
    const old6 = await closedCase(h6, 'action_taken', 180, 'create_cancel');
    run = await raiseBoth(h6);
    const c6 = await one(`select count(*) filter (where status = 'open')::int open, count(*)::int total,
      max((evidence ->> 'previous_case_id')) prev from private.account_review_cases where signal = 'behavior' and subject_user = $1`, [h6]);
    const o6 = await one(`select to_jsonb(c) - 'updated_at' as row, (select count(*)::int from private.account_review_case_events where case_id = c.id and kind in ('new_evidence', 'reopened')) ev
      from private.account_review_cases c where id = $1`, [old6.id]);
    check(run.results.every((r) => r.ok), `both capacity edits committed (${errors(run)})`);
    check(c6.open === 1 && c6.total === 2 && c6.prev === old6.id, `exactly one new case, pointing to the old one (open ${c6.open}, total ${c6.total})`);
    check(JSON.stringify(o6.row) === JSON.stringify(old6.row) && o6.ev === 0, `the closed case is unchanged, no event on it (events ${o6.ev})`);
    const h7 = await person('host7');
    await closedCase(h7, 'no_action', 10, 'large_public_gathering');
    run = await raiseBoth(h7);
    const c7 = await one(`select count(*) filter (where status = 'open')::int open from private.account_review_cases where signal = 'behavior' and subject_user = $1`, [h7]);
    const s7 = await one(`select count(*)::int n from private.behavior_signals where user_id = $1 and kind = 'large_public_gathering'`, [h7]);
    check(run.results.every((r) => r.ok), `both capacity edits committed (${errors(run)})`);
    check(c7.open === 0 && s7.n === 1, `size-only after a recent 'No action needed' large case: no case, signal recorded (open ${c7.open}, signals ${s7.n})`);

    const suspended = await one(`select count(*)::int n from profiles where id = any($1::uuid[]) and suspended_at is not null`, [ids]);
    check(suspended.n === 0, `nobody suspended or restricted (${suspended.n})`);
  } finally {
    await admin.query(`delete from private.account_review_cases where signal = 'behavior' and subject_user = any($1::uuid[])`, [ids]);
    await admin.query(`delete from gathering_interest where gathering_id = any($1::uuid[])`, [gatherings]);
    await admin.query(`delete from gatherings where id = any($1::uuid[])`, [gatherings]);
    await admin.query(`delete from private.gathering_size_marks where series_ref = any($1::uuid[])`, [gatherings]);
    await admin.query(`delete from private.behavior_events where ref = any($1::text[])`, [gatherings]);
    await admin.query(`delete from profiles where id = any($1::uuid[])`, [ids]);
    await admin.query(`delete from auth.users where id = any($1::uuid[])`, [ids]);
    await admin.query(`delete from private.rate_limit_rules`);
    for (const r of savedRules) {
      const cols = Object.keys(r);
      await admin.query(`insert into private.rate_limit_rules (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((k) => r[k]));
    }
    for (const [table, saved] of [['behavior_signal_settings', savedBehavior], ['gathering_signal_settings', savedGathering]]) {
      const cols = Object.keys(saved).filter((k) => k !== 'id');
      await admin.query(`update private.${table} x set (${cols.join(', ')}) =
        (select ${cols.join(', ')} from jsonb_populate_record(null::private.${table}, $1::jsonb)) where id`, [saved]);
    }
    const left = await one(`select (select count(*) from auth.users where id = any($1::uuid[])) + (select count(*) from private.behavior_signals where user_id = any($1::uuid[]))
      + (select count(*) from private.behavior_events where user_id = any($1::uuid[])) + (select count(*) from private.gathering_cancel_log where host_id = any($1::uuid[])) as n`, [ids]);
    check(Number(left.n) === 0, `cleanup: nothing left (${left.n})`);
    await admin.end();
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\ngathering-signal-concurrency: all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
