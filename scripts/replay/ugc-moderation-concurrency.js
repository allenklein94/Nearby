#!/usr/bin/env node
// Migration 20270373 (user-content screening) under real concurrency, on the LOCAL replay database only (NEARBY_LOCAL_DB_URL;
// refuses anything else). A journey is one transaction and cannot race, so here separate sessions really overlap, each
// holding its transaction open before committing. 10 rounds each:
//   1. two admins decide the same held item at the same moment (approve vs reject): exactly one decision, the other is told
//      it was already decided; the content matches the winner.
//   2. an admin approves an older held bio while its author publishes a newer, screened bio: no deadlock, and the newer bio
//      is what's shown in every round (an older approval never overwrites a newer published text).
//   3. the same person sends two held edits of one field from two sessions: at most ONE pending edit is left, and the shown
//      text is unchanged.
//   4. two workers claim the group-chat queue at once: disjoint batches that together cover every queued message.
//   5. concurrent submissions, one screened and one not: the screened one is written, the other refused (screening_required).
// The calibration it needs (English + names) is set and restored; every row it creates is deleted afterwards.
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/ugc-moderation-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const crypto = require('crypto');

const HOLD_MS = 250;
const ROUNDS = 10;
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = (sub, role) => `select set_config('request.jwt.claims', $$${JSON.stringify({ sub, role })}$$, true)`;

async function together(steps) {
  return Promise.all(steps.map(async (step) => {
    const c = await connect();
    try {
      await c.query('begin');
      if (step.role) {
        await c.query(claims(step.sub, step.role));
        await c.query(`set local role ${step.role}`);
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
  }));
}

(async () => {
  const admin = await connect();
  const ids = [];
  const person = async (label) => {
    const id = crypto.randomUUID();
    ids.push(id);
    await admin.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`,
    [id, `${label}-${id.slice(0, 8)}@concurrency.invalid`, `1557${String(ids.length).padStart(8, '0')}`]);
    await admin.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden, bio)
      values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false, 'Start')`, [id, `Race ${label}`]);
    return id;
  };
  const screen = (u, text, langs = ['en'], risk = 'low') => admin.query(
    `select public.record_ugc_screening($1, private.ugc_text_sha($2), 'bio', false, $3, '{}', $4::text[], 'race', 'race')`,
    [u, text, risk, langs]);
  const bio = async (u) => (await admin.query('select bio from profiles where id = $1', [u])).rows[0].bio;
  const pending = async (u) => (await admin.query(`select count(*)::int n from private.ugc_held_items
    where target_table = 'profiles' and target_id = $1 and field = 'bio' and status = 'pending'`, [u])).rows[0].n;
  const holdBio = async (u, text) => {
    await screen(u, text, ['ht']);
    const c = await connect();
    await c.query('begin');
    await c.query(claims(u, 'authenticated'));
    await c.query('set local role authenticated');
    await c.query('update profiles set bio = $1 where id = $2', [text, u]);
    await c.query('commit');
    await c.end();
    return (await admin.query(`select id from private.ugc_held_items where target_id = $1 and status = 'pending' order by created_at desc limit 1`, [u])).rows[0].id;
  };

  const saved = (await admin.query(`select language, status, calibrated_at, evidence from private.ugc_language_calibration`)).rows;
  const messageIds = [];
  let community = null;
  // section 4 sends 60 group messages: the group_message rate limit (20270356) is lifted for the run, then restored
  const savedLimits = (await admin.query(`select * from private.rate_limit_rules where action = 'group_message'`)).rows;
  try {
    await admin.query(`delete from private.rate_limit_rules where action = 'group_message'`);
    await admin.query(`update private.ugc_language_calibration set status = 'calibrated', calibrated_at = now(), evidence = 'race'
      where language in ('en', 'names')`);
    const adminA = await person('adminA');
    const adminB = await person('adminB');
    await admin.query(`update profiles set is_admin = true where id = any($1::uuid[])`, [[adminA, adminB]]);
    const author = await person('author');

    console.log('1. two admins decide the same held item');
    let ok1 = true;
    for (let i = 0; i < ROUNDS; i += 1) {
      const item = await holdBio(author, `Pann ${i}`);
      const run = await together([
        { sub: adminA, role: 'authenticated', sql: 'select public.admin_decide_held_user_content($1, true, null) x', args: [item] },
        { sub: adminB, role: 'authenticated', sql: 'select public.admin_decide_held_user_content($1, false, null) x', args: [item] },
      ]);
      const wins = run.filter((r) => r.ok);
      const status = (await admin.query('select status from private.ugc_held_items where id = $1', [item])).rows[0].status;
      const shown = await bio(author);
      const winnerApproved = wins.length === 1 && wins[0].rows[0].x === 'approved';
      const good = wins.length === 1 && run.some((r) => !r.ok && r.hint === 'already_decided')
        && status === (winnerApproved ? 'approved' : 'rejected') && (winnerApproved ? shown === `Pann ${i}` : shown !== `Pann ${i}`);
      if (!good) { ok1 = false; console.log('   round', i, JSON.stringify(run), status, shown); }
    }
    check(ok1, `${ROUNDS} rounds: one decision each, the other already_decided, content matches the winner`);

    console.log('2. an older approval races a newer published bio');
    let ok2 = true;
    for (let i = 0; i < ROUNDS; i += 1) {
      const item = await holdBio(author, `Ansyen ${i}`);
      await screen(author, `Newer ${i}`);
      const run = await together([
        { sub: adminA, role: 'authenticated', sql: 'select public.admin_decide_held_user_content($1, true, null) x', args: [item] },
        { sub: author, role: 'authenticated', sql: 'update profiles set bio = $1 where id = $2 returning bio', args: [`Newer ${i}`, author] },
      ]);
      const shown = await bio(author);
      const deadlock = run.some((r) => !r.ok && /deadlock/.test(r.error || ''));
      const authorOk = run[1].ok;
      const adminOk = run[0].ok || run[0].hint === 'already_decided';
      if (deadlock || !authorOk || !adminOk || shown !== `Newer ${i}` || (await pending(author)) !== 0) {
        ok2 = false; console.log('   round', i, JSON.stringify(run), shown);
      }
    }
    check(ok2, `${ROUNDS} rounds: no deadlock, the newer bio is shown every time, nothing left pending`);

    console.log('3. two held edits of one field at once');
    let ok3 = true;
    for (let i = 0; i < ROUNDS; i += 1) {
      const before = await bio(author);
      await screen(author, `Premye ${i}`, ['ht']);
      await screen(author, `Dezyèm ${i}`, ['ht']);
      const run = await together([
        { sub: author, role: 'authenticated', sql: 'update profiles set bio = $1 where id = $2', args: [`Premye ${i}`, author] },
        { sub: author, role: 'authenticated', sql: 'update profiles set bio = $1 where id = $2', args: [`Dezyèm ${i}`, author] },
      ]);
      const n = await pending(author);
      if (!run.every((r) => r.ok) || n !== 1 || (await bio(author)) !== before) { ok3 = false; console.log('   round', i, JSON.stringify(run), n); }
      await admin.query(`update private.ugc_held_items set status = 'superseded' where target_id = $1 and status = 'pending'`, [author]);
    }
    check(ok3, `${ROUNDS} rounds: exactly one pending edit left, shown text unchanged`);

    console.log('4. two workers claim the group-chat queue at once');
    await screen(author, 'Race chat club', ['en']);
    await admin.query(`select public.record_ugc_screening($1, private.ugc_text_sha('Race chat club'), 'community_name', true, 'low', '{}', array['en'], 'race', 'race')`, [author]);
    community = (await admin.query(`insert into communities (creator_id, name) values ($1, 'Race chat club') returning id`, [author])).rows[0].id;
    await admin.query(`insert into community_members (community_id, user_id, role) values ($1, $2, 'creator') on conflict do nothing`, [community, author]);
    let ok4 = true;
    for (let i = 0; i < ROUNDS; i += 1) {
      const mine = [];
      for (let k = 0; k < 6; k += 1) {
        const c = await connect();
        await c.query('begin');
        await c.query(claims(author, 'authenticated'));
        await c.query('set local role authenticated');
        const r = await c.query('insert into community_messages (community_id, sender_id, body) values ($1, $2, $3) returning id', [community, author, `m ${i}.${k}`]);
        await c.query('commit');
        await c.end();
        mine.push(r.rows[0].id);
        messageIds.push(r.rows[0].id);
      }
      const run = await together([
        { sql: 'select message_id from public.claim_ugc_chat_batch(4)' },
        { sql: 'select message_id from public.claim_ugc_chat_batch(4)' },
      ]);
      const a = run[0].rows.map((r) => r.message_id);
      const b = run[1].rows.map((r) => r.message_id);
      const overlap = a.filter((x) => b.includes(x));
      const covered = new Set([...a, ...b].filter((x) => mine.includes(x)));
      if (!run.every((r) => r.ok) || overlap.length || covered.size !== mine.length) { ok4 = false; console.log('   round', i, a, b); }
      await admin.query(`update private.ugc_chat_queue set status = 'done' where message_id = any($1::uuid[])`, [mine]);
    }
    check(ok4, `${ROUNDS} rounds: disjoint batches covering every queued message`);

    console.log('5. concurrent submissions, one screened, one not');
    let ok5 = true;
    for (let i = 0; i < ROUNDS; i += 1) {
      await screen(author, `Screened ${i}`);
      const run = await together([
        { sub: author, role: 'authenticated', sql: 'update profiles set bio = $1 where id = $2', args: [`Screened ${i}`, author] },
        { sub: adminA, role: 'authenticated', sql: 'update profiles set bio = $1 where id = $2', args: [`Unscreened ${i}`, adminA] },
      ]);
      if (!run[0].ok || run[1].ok || run[1].hint !== 'screening_required' || (await bio(author)) !== `Screened ${i}`) {
        ok5 = false; console.log('   round', i, JSON.stringify(run));
      }
    }
    check(ok5, `${ROUNDS} rounds: the screened write lands, the unscreened one is refused`);
  } finally {
    for (const r of savedLimits) {
      const cols = Object.keys(r);
      await admin.query(`insert into private.rate_limit_rules (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
        on conflict do nothing`, cols.map((c) => r[c]));
    }
    for (const s of saved) {
      await admin.query(`update private.ugc_language_calibration set status = $2, calibrated_at = $3, evidence = $4 where language = $1`,
        [s.language, s.status, s.calibrated_at, s.evidence]);
    }
    await admin.query(`delete from private.ugc_chat_queue where message_id = any($1::uuid[])`, [messageIds]);
    if (community) await admin.query('delete from communities where id = $1', [community]);
    await admin.query(`delete from private.ugc_held_items where author_id = any($1::uuid[]) or target_id = any($1::uuid[])
      or target_id = any($2::uuid[])`, [ids, messageIds]);
    await admin.query(`delete from auth.users where id = any($1::uuid[])`, [ids]);
    const left = (await admin.query(`select (select count(*)::int from auth.users where id = any($1::uuid[])) users,
      (select count(*)::int from private.ugc_held_items where author_id = any($1::uuid[])) held,
      (select count(*)::int from private.ugc_language_calibration where status <> 'pending') calibrated,
      (select count(*)::int from private.rate_limit_rules where action = 'group_message') limits`, [ids])).rows[0];
    check(left.users === 0 && left.held === 0 && left.limits === savedLimits.length,
      `cleaned up (users ${left.users}, held ${left.held}, calibrated rows ${left.calibrated} as before, group_message limits ${left.limits}/${savedLimits.length} restored)`);
    await admin.end();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
