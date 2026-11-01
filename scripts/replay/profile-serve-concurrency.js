#!/usr/bin/env node
// Migration 20270382 (people anti-scraping: page limit + distinct-new-people-per-day limit) under real concurrency, on the
// LOCAL replay database only (NEARBY_LOCAL_DB_URL; refuses anything else). A journey is one transaction and cannot race,
// so here separate sessions really overlap, each holding its transaction open before committing. Every call is the app's
// own read under the real `authenticated` role.
//   1. one person runs 6 Dating Browse pages in parallel (offsets 0/10/20 twice, 10 a page, 20 new people a day, 30 people
//      in the area): exactly 20 distinct people served in total, no call returns more than a page, no error or deadlock.
//   2. a second person runs 4 friend-discovery calls (asking 100000 each) + 2 Browse pages in parallel: at most 20 distinct
//      people served, every call at most a page, no error or deadlock.
//   3. with the limit signal on, a third person runs 6 Browse pages in parallel past the limit: one discovery_limit signal
//      row, no error or deadlock, the account untouched.
//   4. two different people browsing at the same time never wait on each other's limit (both get a full page).
// Settings are put back and every row it creates is deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/profile-serve-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const crypto = require('crypto');

const HOLD_MS = 300;
const BUCKET = '27.9,-81.3';
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BROWSE = (offset) => ({ sql: `select id from browse_dating_candidates(array['${BUCKET}'], $1, 10)`, args: [offset] });
const FRIENDS = { sql: 'select id from get_friend_discovery_candidates(100000)', args: [] };

async function together(who, calls) {
  return Promise.all(calls.map(async ({ sql, args }) => {
    const c = await connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: who, role: 'authenticated' })]);
      await c.query('set local role authenticated');
      const r = await c.query(sql, args);
      await sleep(HOLD_MS);
      await c.query('commit');
      return { ok: true, n: r.rowCount };
    } catch (e) {
      await c.query('rollback').catch(() => {});
      return { ok: false, code: e.code, error: e.message };
    } finally {
      await c.end();
    }
  }));
}
const errors = (rs) => rs.filter((r) => !r.ok).map((r) => `${r.code} ${r.error}`);

(async () => {
  const admin = await connect();
  const ids = [];
  let n = 0;
  const person = async ({ dating = true } = {}) => {
    const id = crypto.randomUUID();
    ids.push(id);
    n += 1;
    await admin.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '2 days', $3, now())`,
      [id, `${id}@profile-serve.invalid`, `1555088${String(n).padStart(4, '0')}`]);
    await admin.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified,
        profile_hidden, onboarding_motivations, wide_area, open_to_friend_discovery)
      values ($1, 'Serve test', date '1994-05-01', now() - interval '2 days', now(), 'America/New_York', true, false, $2, $3, true)`,
      [id, dating ? ['Go on dates'] : [], BUCKET]);
    return id;
  };
  const served = async (id) => Number((await admin.query(
    'select count(*) from private.profile_served where viewer_id = $1', [id])).rows[0].count);
  const before = (await admin.query('select * from private.profile_read_limits where id')).rows[0];
  try {
    await admin.query('update private.profile_read_limits set page_max = 10, daily_new_profiles = 20 where id');
    for (let i = 0; i < 30; i += 1) await person();
    const a = await person();
    const b = await person();
    const c = await person();
    const d = await person();
    const e = await person();

    console.log('1. 6 parallel Browse pages from one person');
    let rs = await together(a, [0, 10, 20, 0, 10, 20].map(BROWSE));
    check(errors(rs).length === 0, `no error or deadlock (${JSON.stringify(errors(rs))})`);
    check(rs.every((r) => r.n <= 10), `every call at most a page (${rs.map((r) => r.n)})`);
    check(await served(a) === 20, `exactly 20 distinct people served (got ${await served(a)})`);

    console.log('2. 4 friend-discovery calls + 2 Browse pages in parallel');
    rs = await together(b, [FRIENDS, FRIENDS, FRIENDS, FRIENDS, BROWSE(0), BROWSE(10)]);
    check(errors(rs).length === 0, `no error or deadlock (${JSON.stringify(errors(rs))})`);
    check(rs.every((r) => r.n <= 10), `every call at most a page (${rs.map((r) => r.n)})`);
    const sb = await served(b);
    check(sb <= 20 && sb >= 10, `at most 20 distinct people served (got ${sb})`);

    console.log('3. limit signal on, 6 parallel Browse pages past the limit');
    await admin.query('update private.profile_read_limits set limit_signal_window_days = 7, limit_signal_min_days = 3 where id');
    rs = await together(c, [0, 10, 20, 0, 10, 20].map(BROWSE));
    check(errors(rs).length === 0, `no error or deadlock (${JSON.stringify(errors(rs))})`);
    const sig = (await admin.query(`select kind, count(*)::int n from private.behavior_signals where user_id = $1 group by kind`, [c])).rows;
    check(sig.length === 1 && sig[0].kind === 'discovery_limit' && sig[0].n === 1, `one discovery_limit signal row (got ${JSON.stringify(sig)})`);
    const acct = (await admin.query('select profile_hidden, suspended_at from profiles where id = $1', [c])).rows[0];
    check(acct.profile_hidden === false && acct.suspended_at === null, 'account untouched');

    console.log('4. two different people at the same time');
    const [rd, re] = await Promise.all([together(d, [BROWSE(0)]), together(e, [BROWSE(0)])]);
    check(rd[0].ok && re[0].ok && rd[0].n === 10 && re[0].n === 10, `both get a full page (${rd[0].n}, ${re[0].n})`);
  } finally {
    await admin.query(`update private.profile_read_limits set page_max = $1, daily_new_profiles = $2, limit_signal_window_days = $3,
      limit_signal_min_days = $4 where id`, [before.page_max, before.daily_new_profiles, before.limit_signal_window_days, before.limit_signal_min_days]);
    await admin.query('delete from private.account_review_cases where subject_user = any($1)', [ids]);
    await admin.query('delete from profiles where id = any($1)', [ids]);
    await admin.query('delete from auth.users where id = any($1)', [ids]);
    const left = Number((await admin.query(`select (select count(*) from auth.users where id = any($1))
      + (select count(*) from private.profile_served where viewer_id = any($1) or target_id = any($1))
      + (select count(*) from private.behavior_signals where user_id = any($1)) as n`, [ids])).rows[0].n);
    check(left === 0, `cleanup: ${left} rows left`);
    await admin.end();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
