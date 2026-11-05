#!/usr/bin/env node
// Migration 20270391 under real concurrency, on the LOCAL replay database only. A journey is one transaction and can't race, so
// here separate sessions really overlap, each holding its transaction open before committing. In every round, whichever order
// the two land in, the invariant is the same: a filed report on a photo never ends with that file queued for deletion.
//   1. report vs the expiry job on an expired-soon Story.
//   2. report vs the poster removing it.
//   3. report vs the host removing it.
//   4. two people report the same photo at once: both filed, one held file, resolving one keeps it.
//   5. the job run twice at once: each file gets one DELETE, nothing fails.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/media-report-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const crypto = require('crypto');

const HOLD_MS = 120;
const ROUNDS = 10;
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(step) {
  if (step.wait) await sleep(step.wait);
  const c = await connect();
  try {
    await c.query('begin');
    if (step.sub) {
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: step.sub, role: 'authenticated' })]);
      await c.query('set local role authenticated');
    }
    const r = await c.query(step.sql, step.args);
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

(async () => {
  const db = await connect();
  const [P, R, R2, F, H] = [0, 1, 2, 3, 4].map(() => crypto.randomUUID());
  const people = [P, R, R2, F, H];
  const G = crypto.randomUUID();
  for (const [i, u] of people.entries()) {
    await db.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`, [u, `c${i}-${u.slice(0, 8)}@concurrency.invalid`, `1559${String(i).padStart(8, '0')}`]);
    await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
      values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false)`, [u, `Race ${i}`]);
  }
  await db.query(`insert into friendships (user_a, user_b, status, requested_by) values ($1, $2, 'accepted', $3)`, [P < F ? P : F, P < F ? F : P, P]);
  await db.query(`insert into gatherings (id, host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values ($1, $2, 'Race memories', now() - interval '2 days', 26.4, -80.1, 'Volleyball', 'x', 'everyone')`, [G, H]);
  await db.query(`insert into gathering_interest (gathering_id, user_id, status) values ($1, $2, 'approved'), ($1, $3, 'approved'), ($1, $4, 'approved')`, [G, P, R, R2]);
  const rules = (await db.query('select * from private.rate_limit_rules')).rows;
  const settings = (await db.query('select friends_stories_enabled f from private.story_media_settings')).rows[0].f;
  await db.query('delete from private.rate_limit_rules');
  await db.query('update private.story_media_settings set friends_stories_enabled = true');

  let n = 0;
  const post = async (gathering) => {
    n += 1;
    const path = `${P}/race-${n}-${crypto.randomUUID().slice(0, 6)}.jpg`;
    // fixture only: more posts than the daily limit, so insert triggers are off for this one statement
    await db.query('begin');
    await db.query('set local session_replication_role = replica');
    const r = await db.query(`insert into stories (user_id, media_path, gathering_id, media_type, expires_at)
      values ($1, $2, $3, 'image', now() + interval '1 day') returning id`, [P, path, gathering]);
    await db.query('commit');
    return { id: r.rows[0].id, path };
  };
  const reportSql = `insert into reports (reporter_id, reason, content_type, content_id) values ($1, 'Other', 'story', $2) returning id`;
  const queued = async (path) => (await db.query(`select count(*)::int n from net.http_request_queue where url like $1`, [`%${path}`])).rows[0].n;
  const flush = async () => { await db.query('delete from net.http_request_queue'); await db.query('select delete_expired_stories()'); };

  async function race(title, setup, otherStep, reporter) {
    console.log(title);
    let firstReport = 0; let firstOther = 0; let safe = true;
    for (let i = 0; i < ROUNDS * 2; i += 1) {
      const photo = await post(setup.gathering);
      if (setup.expire) await db.query(`update stories set expires_at = now() + interval '40 milliseconds' where id = $1`, [photo.id]);
      if (setup.expire) await sleep(60);
      const reportFirst = i % 2 === 0;
      // the report reads as the reporter, so an already expired Story is refused: the expiry race needs it readable by the admin path
      const reportStep = { sub: reporter, sql: reportSql, args: [reporter, photo.id], wait: reportFirst ? 0 : 40 };
      const other = { ...otherStep(photo), wait: reportFirst ? 40 : 0 };
      const [rep] = await Promise.all([run(reportStep), run(other)]);
      await flush();
      if (rep.ok) {
        firstReport += 1;
        if (await queued(photo.path) !== 0) safe = false;
        const held = (await db.query(`select count(*)::int n from private.report_media_evidence where media_path = $1 and released_at is null`, [photo.path])).rows[0].n;
        if (held !== 1) safe = false;
      } else {
        firstOther += 1;
        if (rep.hint !== 'report_content_mismatch') { safe = false; console.log('   unexpected', rep.error); }
      }
    }
    check(safe, `a filed report never lost its file, in ${ROUNDS * 2} rounds (${firstReport} filed, ${firstOther} refused as gone)`);
    check(firstReport > 0 && firstOther > 0, 'both orders really happened');
  }

  try {
    await race('1. Report vs the expiry job', { gathering: null, expire: false },
      (p) => ({ sql: `update stories set expires_at = now() - interval '1 second' where id = $1 returning (select delete_expired_stories())`, args: [p.id] }), F);
    await race('2. Report vs the poster removing it', { gathering: G }, (p) => ({ sub: P, sql: 'delete from stories where id = $1', args: [p.id] }), R);
    await race('3. Report vs the host removing it', { gathering: G }, (p) => ({ sub: H, sql: 'select remove_gathering_memory($1)', args: [p.id] }), R);

    console.log('4. Two reports on one photo');
    let ok = true;
    for (let i = 0; i < ROUNDS; i += 1) {
      const photo = await post(G);
      const [a, b] = await Promise.all([run({ sub: R, sql: reportSql, args: [R, photo.id] }), run({ sub: R2, sql: reportSql, args: [R2, photo.id] })]);
      if (!a.ok || !b.ok) { ok = false; console.log('   ', a.error, b.error); continue; }
      await db.query('delete from stories where id = $1', [photo.id]);
      await db.query(`select set_config('app.report_action_logged', 'false', false)`);
      await db.query(`insert into report_actions (report_id, action) values ($1, 'resolved_no_action')`, [a.rows[0].id]);
      await flush();
      if (await queued(photo.path) !== 0) ok = false;
      await db.query(`insert into report_actions (report_id, action) values ($1, 'resolved_no_action')`, [b.rows[0].id]);
      await flush();
      if (await queued(photo.path) !== 1) ok = false;
    }
    check(ok, `both filed, and the file stays until the second is released (${ROUNDS} rounds)`);

    console.log('5. The job twice at once');
    await db.query('delete from net.http_request_queue');
    const paths = [];
    for (let i = 0; i < 30; i += 1) { const p = await post(null); paths.push(p.path); }
    await db.query(`update stories set expires_at = now() - interval '1 second' where media_path = any($1)`, [paths]);
    const both = await Promise.all([run({ sql: 'select delete_expired_stories()' }), run({ sql: 'select delete_expired_stories()' })]);
    check(both.every((r) => r.ok), `no failure or deadlock (${both.map((r) => r.error || 'ok').join(', ')})`);
    const counts = await Promise.all(paths.map(queued));
    check(counts.every((c) => c === 1), `each of the ${paths.length} files got exactly one DELETE (${Math.min(...counts)}-${Math.max(...counts)})`);
  } finally {
    await db.query('delete from net.http_request_queue');
    await db.query('delete from reports where reporter_id = any($1)', [people]);
    await db.query('delete from stories where user_id = any($1)', [people]);
    await db.query(`delete from private.story_media_removals where gathering_id = $1`, [G]);
    await db.query(`delete from private.story_file_cleanup where media_path like $1`, [`${P}/%`]);
    await db.query('delete from gatherings where id = $1', [G]);
    await db.query('delete from friendships where user_a = any($1)', [people]);
    await db.query('delete from profiles where id = any($1)', [people]);
    await db.query('delete from auth.users where id = any($1)', [people]);
    for (const r of rules) {
      const cols = Object.keys(r);
      await db.query(`insert into private.rate_limit_rules (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`, cols.map((c) => r[c]));
    }
    await db.query('update private.story_media_settings set friends_stories_enabled = $1', [settings]);
    await db.end();
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
