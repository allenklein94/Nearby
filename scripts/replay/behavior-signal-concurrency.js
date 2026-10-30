#!/usr/bin/env node
// Migration 20270363 (behaviour review signals) under real concurrency, on the LOCAL replay database only
// (NEARBY_LOCAL_DB_URL; refuses anything else). A journey is one transaction and cannot race, so here separate sessions
// really overlap, each holding its transaction open before committing.
//   1. one person sends the same message into 8 conversations from 8 parallel sessions: every message is delivered, they
//      are counted TOGETHER (one signal, conversations = 8, one open case), no deadlock.
//   2. six people each send their 5th identical message at the same moment while the queue has room for 3 more cases:
//      exactly 3 new cases, 6 signals noted (flood protection holds under a race).
//   3. one person joins 15 gatherings from 15 parallel sessions: every join approved (never capped), one join_burst
//      signal counting all 15.
// Uses the PROPOSED numbers (owner approval pending) on the replay database only; settings, rules and every row it
// creates are restored / deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/behavior-signal-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const crypto = require('crypto');

const HOLD_MS = 300;
const SPAM = 'Check out my new deal at the shop downtown today';
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
  const person = async (label) => {
    const id = crypto.randomUUID();
    ids.push(id);
    await admin.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`,
    [id, `${label}-${id.slice(0, 8)}@concurrency.invalid`, `1555${String(ids.length).padStart(8, '0')}`]);
    await admin.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
      values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false)`, [id, `Race ${label}`]);
    return id;
  };
  const match = async (a, b) => (await admin.query(
    `insert into matches (user_a, user_b) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid)) returning id`, [a, b])).rows[0].id;
  const dm = (sender, matchId, body = SPAM) => ({ sub: sender, sql: 'insert into messages (match_id, sender_id, body) values ($1, $2, $3)', args: [matchId, sender, body] });

  const [{ s: savedSettings }] = (await admin.query(`select to_jsonb(x) as s from private.behavior_signal_settings x`)).rows;
  const savedRules = (await admin.query(`select * from private.rate_limit_rules`)).rows;
  let gatherings = [];
  try {
    // only the limits this script would otherwise hit as a side effect (restored afterwards)
    await admin.query(`delete from private.rate_limit_rules where action in ('direct_message', 'gathering_create')`);
    await admin.query(`update private.behavior_signal_settings set
      repeat_msg_min_conversations = 5, repeat_msg_window_minutes = 60, repeat_msg_min_chars = 20, repeat_msg_min_similarity = 0.8,
      join_burst_min_gatherings = 15, join_burst_window_minutes = 60, location_min_cells = 3, location_window_minutes = 60,
      limit_burst_min_actions = 3, limit_burst_window_minutes = 60, review_cases_enabled = true, case_min_signal_kinds = 2,
      case_window_hours = 24, case_alone_kinds = array['repeated_messages', 'limit_burst'], max_new_cases_per_day = 1000 where id`);

    const recipients = [];
    for (let i = 0; i < 8; i += 1) recipients.push(await person(`r${i}`));

    console.log('1. one person, 8 conversations, 8 parallel sessions');
    const s = await person('spammer');
    const sMatches = [];
    for (const r of recipients) sMatches.push(await match(s, r));
    let run = await together(sMatches.map((m) => dm(s, m)));
    const delivered = (await admin.query(`select count(*)::int n from messages where sender_id = $1`, [s])).rows[0].n;
    const sig = (await admin.query(`select count(*)::int n, max((evidence ->> 'conversations')::int) conv from private.behavior_signals where user_id = $1`, [s])).rows[0];
    const sCases = (await admin.query(`select count(*)::int n from private.account_review_cases where signal = 'behavior' and subject_user = $1 and status = 'open'`, [s])).rows[0].n;
    check(run.results.every((r) => r.ok), `every session committed (${run.results.filter((r) => !r.ok).map((r) => r.error).join('; ') || 'no errors'}), ${run.ms} ms`);
    check(delivered === 8, `all 8 messages delivered (${delivered})`);
    check(sig.n === 1 && sig.conv === 8, `one signal row counting all 8 conversations together (rows ${sig.n}, conversations ${sig.conv})`);
    check(sCases === 1, `one open case (${sCases})`);

    console.log('2. six people send their 5th identical message at the same moment; queue has room for 3');
    const qs = [];
    const fifth = [];
    for (let i = 0; i < 6; i += 1) {
      const q = await person(`q${i}`);
      qs.push(q);
      for (let k = 0; k < 4; k += 1) { // 4 conversations each, committed one by one: below the threshold
        const m = await match(q, recipients[k]);
        const c = await connect();
        await c.query('begin'); await c.query(claims(q)); await c.query('set local role authenticated');
        await c.query('insert into messages (match_id, sender_id, body) values ($1, $2, $3)', [m, q, SPAM]);
        await c.query('commit'); await c.end();
      }
      fifth.push(dm(q, await match(q, recipients[4])));
    }
    const before = (await admin.query(`select count(*)::int n from private.behavior_signals where user_id = any($1::uuid[])`, [qs])).rows[0].n;
    const [{ n: openedToday }] = (await admin.query(`select count(*)::int n from private.account_review_cases where signal = 'behavior' and opened_at > now() - interval '24 hours'`)).rows;
    await admin.query(`update private.behavior_signal_settings set max_new_cases_per_day = $1 where id`, [openedToday + 3]);
    run = await together(fifth);
    const qSignals = (await admin.query(`select count(*)::int n from private.behavior_signals where user_id = any($1::uuid[]) and kind = 'repeated_messages'`, [qs])).rows[0].n;
    const qCases = (await admin.query(`select count(*)::int n from private.account_review_cases where signal = 'behavior' and subject_user = any($1::uuid[])`, [qs])).rows[0].n;
    check(before === 0, `no signal below the threshold (${before})`);
    check(run.results.every((r) => r.ok), `every 5th message delivered (${run.results.filter((r) => !r.ok).map((r) => r.error).join('; ') || 'no errors'})`);
    check(qSignals === 6, `6 signals noted (${qSignals})`);
    check(qCases === 3, `exactly 3 new cases at the daily cap (${qCases})`);
    await admin.query(`update private.behavior_signal_settings set max_new_cases_per_day = 1000 where id`);

    console.log('3. one person joins 15 gatherings from 15 parallel sessions');
    const host = await person('host');
    const j = await person('joiner');
    for (let i = 0; i < 15; i += 1) {
      gatherings.push((await admin.query(`insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
        values ($1, $2, now() + interval '2 days', 10.02, -10.03, 'Pickleball', 'race', 'everyone', true) returning id`, [host, `Race ${i}`])).rows[0].id);
    }
    run = await together(gatherings.map((g) => ({ sub: j, sql: 'select join_gathering($1)', args: [g] })));
    const approved = (await admin.query(`select count(*)::int n from gathering_interest where user_id = $1 and status = 'approved'`, [j])).rows[0].n;
    const jSig = (await admin.query(`select count(*)::int n, max((evidence ->> 'gatherings')::int) g from private.behavior_signals where user_id = $1 and kind = 'join_burst'`, [j])).rows[0];
    const jCases = (await admin.query(`select count(*)::int n from private.account_review_cases where signal = 'behavior' and subject_user = $1`, [j])).rows[0].n;
    check(run.results.every((r) => r.ok), `every join committed (${run.results.filter((r) => !r.ok).map((r) => r.error).join('; ') || 'no errors'}), ${run.ms} ms`);
    check(approved === 15, `all 15 joins approved, never capped (${approved})`);
    check(jSig.n === 1 && jSig.g === 15, `one join_burst signal counting all 15 (rows ${jSig.n}, gatherings ${jSig.g})`);
    check(jCases === 0, `join burst alone opens no case (${jCases})`);

    const suspended = (await admin.query(`select count(*)::int n from profiles where id = any($1::uuid[]) and suspended_at is not null`, [ids])).rows[0].n;
    check(suspended === 0, `nobody suspended or restricted (${suspended})`);
  } finally {
    await admin.query(`delete from private.account_review_cases where signal = 'behavior' and subject_user = any($1::uuid[])`, [ids]);
    await admin.query(`delete from gathering_interest where gathering_id = any($1::uuid[])`, [gatherings]);
    await admin.query(`delete from gatherings where id = any($1::uuid[])`, [gatherings]);
    await admin.query(`delete from messages where sender_id = any($1::uuid[])`, [ids]);
    await admin.query(`delete from matches where user_a = any($1::uuid[]) or user_b = any($1::uuid[])`, [ids]);
    await admin.query(`delete from profiles where id = any($1::uuid[])`, [ids]);
    await admin.query(`delete from auth.users where id = any($1::uuid[])`, [ids]);
    await admin.query(`delete from private.rate_limit_rules`);
    for (const r of savedRules) {
      const cols = Object.keys(r);
      await admin.query(`insert into private.rate_limit_rules (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((k) => r[k]));
    }
    await admin.query(`update private.behavior_signal_settings x set (${Object.keys(savedSettings).filter((k) => k !== 'id').join(', ')}) =
      (select ${Object.keys(savedSettings).filter((k) => k !== 'id').join(', ')} from jsonb_populate_record(null::private.behavior_signal_settings, $1::jsonb)) where id`, [savedSettings]);
    const left = (await admin.query(`select (select count(*) from auth.users where id = any($1::uuid[])) + (select count(*) from private.behavior_signals where user_id = any($1::uuid[]))
      + (select count(*) from private.behavior_events where user_id = any($1::uuid[])) as n`, [ids])).rows[0].n;
    check(Number(left) === 0, `cleanup: nothing left (${left})`);
    await admin.end();
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nbehavior-signal-concurrency: all checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
