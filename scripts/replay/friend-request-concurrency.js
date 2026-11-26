#!/usr/bin/env node
// Migration 20270377 (friend-request burst limit: 5 per rolling 10 minutes) under real concurrency, on the LOCAL replay
// database only (NEARBY_LOCAL_DB_URL; refuses anything else). A journey is one transaction and cannot race, so here
// separate sessions really overlap, each holding its transaction open before committing. Every request is the app's own
// write (services/friends.js): a signed-in client inserting a pending friendships row under the real `authenticated` role.
//   1. one person sends 8 requests to 8 different people from 8 parallel sessions: exactly 5 succeed, 3 are refused with
//      hint friend_request_limit, 5 log rows, daily counter 5, no deadlock, no other error.
//   2. the same person, window still full, sends 3 more in parallel: all 3 refused, nothing new logged.
//   3. a second person sends 4 in parallel with 2 parallel duplicates of one of them: 4 succeed, the duplicates fail
//      23505 and cost nothing (4 log rows).
//   4. a third person with 14 already today sends 3 in parallel: 1 succeeds (the 15th), 2 get the daily refusal, 1 log row.
//   5. a fourth person with 14 today (one pair already sent) sends, in parallel, 3 "on conflict do nothing" repeats of that
//      pair + 1 new request: the new one succeeds (the skips used no daily slot), daily counter 15, 2 log rows.
// Uses test numbers on the replay database only; every row it creates is deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/friend-request-concurrency.js
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

const REQUEST = `insert into friendships (user_a, user_b, status, requested_by)
  values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid), 'pending', $1::uuid)`;

async function together(from, targets, suffixes = []) {
  return Promise.all(targets.map(async (to, i) => {
    const c = await connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: from, role: 'authenticated' })]);
      await c.query('set local role authenticated');
      await c.query(REQUEST + (suffixes[i] || ''), [from, to]);
      await sleep(HOLD_MS);
      await c.query('commit');
      return { ok: true };
    } catch (e) {
      await c.query('rollback').catch(() => {});
      return { ok: false, code: e.code, hint: e.hint, error: e.message };
    } finally {
      await c.end();
    }
  }));
}
const tally = (rs) => ({
  ok: rs.filter((r) => r.ok).length,
  burst: rs.filter((r) => r.hint === 'friend_request_limit').length,
  duplicate: rs.filter((r) => r.code === '23505').length,
  daily: rs.filter((r) => !r.ok && /15 friend requests per day/.test(r.error)).length,
  other: rs.filter((r) => !r.ok && r.hint !== 'friend_request_limit' && r.code !== '23505' && !/15 friend requests per day/.test(r.error)).map((r) => `${r.code} ${r.error}`),
});

(async () => {
  const admin = await connect();
  const ids = [];
  let n = 0;
  const person = async () => {
    const id = crypto.randomUUID();
    ids.push(id);
    n += 1;
    await admin.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '2 days', $3, now())`,
      [id, `${id}@friend-burst.invalid`, `1555077${String(n).padStart(4, '0')}`]);
    await admin.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
      values ($1, 'Burst test', date '1994-05-01', now() - interval '2 days', now(), 'America/New_York', true, false)`, [id]);
    return id;
  };
  const logged = async (id) => Number((await admin.query(
    `select count(*) from private.limited_action_log where user_id = $1 and field = 'friend_request'`, [id])).rows[0].count);
  const dailyCount = async (id) => (await admin.query('select friend_requests_sent_today from profiles where id = $1', [id])).rows[0].friend_requests_sent_today;
  try {
    const a = await person();
    const targets = [];
    for (let i = 0; i < 11; i += 1) targets.push(await person());

    console.log('1. 8 parallel requests from one person');
    let t = tally(await together(a, targets.slice(0, 8)));
    check(t.ok === 5 && t.burst === 3 && t.other.length === 0, `5 succeed, 3 refused by the burst limit (got ${JSON.stringify(t)})`);
    check(await logged(a) === 5, `5 log rows (got ${await logged(a)})`);
    check(await dailyCount(a) === 5, `daily counter 5 (got ${await dailyCount(a)})`);

    console.log('2. 3 more in parallel while the window is full');
    t = tally(await together(a, targets.slice(8, 11)));
    check(t.ok === 0 && t.burst === 3 && t.other.length === 0, `all 3 refused (got ${JSON.stringify(t)})`);
    check(await logged(a) === 5, `still 5 log rows (got ${await logged(a)})`);

    console.log('3. 4 parallel requests + 2 parallel duplicates of one');
    const b = await person();
    t = tally(await together(b, [targets[0], targets[1], targets[2], targets[3], targets[0], targets[0]]));
    check(t.ok === 4 && t.duplicate === 2 && t.other.length === 0, `4 succeed, 2 duplicates refused 23505 (got ${JSON.stringify(t)})`);
    check(await logged(b) === 4, `4 log rows (got ${await logged(b)})`);

    console.log('4. 3 parallel requests with 14 already sent today');
    const c = await person();
    await admin.query(`update profiles set friend_requests_sent_today = 14,
      friend_requests_sent_date = (now() at time zone 'America/New_York')::date where id = $1`, [c]);
    t = tally(await together(c, targets.slice(4, 7)));
    check(t.ok === 1 && t.daily === 2 && t.other.length === 0, `1 succeeds (15th), 2 refused by the daily limit (got ${JSON.stringify(t)})`);
    check(await logged(c) === 1, `1 log row (got ${await logged(c)})`);

    console.log('5. 3 parallel "on conflict do nothing" repeats + 1 new request at 14 today');
    const e = await person();
    await admin.query(`update profiles set friend_requests_sent_today = 13,
      friend_requests_sent_date = (now() at time zone 'America/New_York')::date where id = $1`, [e]);
    t = tally(await together(e, [targets[8]]));
    check(t.ok === 1 && await dailyCount(e) === 14, `first pair sent, daily 14 (got ${JSON.stringify(t)}, daily ${await dailyCount(e)})`);
    const skip = ' on conflict (user_a, user_b) do nothing';
    t = tally(await together(e, [targets[8], targets[8], targets[8], targets[9]], [skip, skip, skip, '']));
    // A skip that waits on the row lock until after the new request committed (daily now 15) is refused by the daily check,
    // which runs before Postgres sees the conflict: it would have created nothing either way and uses no slot (existing
    // behaviour, unchanged). So: no unexpected error, every non-ok is a daily refusal, and the new request was created.
    check(t.ok + t.daily === 4 && t.ok >= 1 && t.other.length === 0 && t.burst === 0 && t.duplicate === 0,
      `3 skips + the new request: no unexpected error, refusals only from the daily check (got ${JSON.stringify(t)})`);
    const pairs = Number((await admin.query('select count(*) from friendships where requested_by = $1', [e])).rows[0].count);
    check(pairs === 2, `2 friendships exist (got ${pairs})`);
    const created = Number((await admin.query(`select count(*) from friendships where requested_by = $1
      and least($1::uuid, $2::uuid) = user_a and greatest($1::uuid, $2::uuid) = user_b`, [e, targets[9]])).rows[0].count);
    check(created === 1, `the new request was created (got ${created})`);
    check(await dailyCount(e) === 15, `daily counter 15: the skips used no slot (got ${await dailyCount(e)})`);
    check(await logged(e) === 2, `2 log rows (got ${await logged(e)})`);
  } finally {
    await admin.query('delete from friendships where requested_by = any($1) or user_a = any($1) or user_b = any($1)', [ids]);
    await admin.query(`delete from private.limited_action_log where user_id = any($1)`, [ids]);
    await admin.query('delete from profiles where id = any($1)', [ids]);
    await admin.query('delete from auth.users where id = any($1)', [ids]);
    const left = Number((await admin.query('select count(*) from auth.users where id = any($1)', [ids])).rows[0].count);
    check(left === 0, `cleanup: ${left} test accounts left`);
    await admin.end();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
