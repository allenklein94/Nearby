#!/usr/bin/env node
// Migrations 20270394 (a gated perk no longer blocks deleting its gathering) + 20270395 (legal holds) under real concurrency, on the
// LOCAL replay database only. A journey is one transaction and can't race, so here separate sessions really overlap, each holding
// its transaction open before committing, in both orders.
//   1. the host cancels vs an attendee claiming the gated perk: the cancel always works; a claim either got in first (its code
//      stays) or is refused; the perk ends off + marked; no deadlock.
//   2. the host cancels vs an admin removing the same gathering: it goes once, the perk ends off + marked, no deadlock.
//   3. a legal hold vs the report purge: a hold that is placed keeps its report; a purge that wins first leaves no active hold on a
//      report that's gone (the hold call says not found).
//   4. a legal hold vs "No action needed" on a reported photo: the photo always ends held.
//   5. a legal hold on a removal record vs the snapshot purge: a placed hold keeps the snapshot.
// Every row it creates is deleted afterwards (holds included: their no-delete trigger is paused for the cleanup only).
//   NEARBY_LOCAL_DB_URL=postgres://... NEARBY_PG_MODULE=/path/to/pg node scripts/replay/gated-perk-legal-hold-concurrency.js
const url = process.env.NEARBY_LOCAL_DB_URL;
if (!url || !/@(localhost|127\.|172\.|10\.|192\.168\.)/.test(url)) {
  console.error('NEARBY_LOCAL_DB_URL must point at the local replay database.');
  process.exit(2);
}
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const crypto = require('crypto');

const HOLD_MS = 120;
const ROUNDS = 8;
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };
async function connect() { const c = new Client({ connectionString: url }); await c.connect(); return c; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadlock = (res) => res.some((r) => /deadlock/i.test(r.error || ''));

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

const WHY = 'Preservation request from counsel';

(async () => {
  const db = await connect();
  const people = [0, 1, 2, 3, 4].map(() => crypto.randomUUID());
  const [A1, A2, H, R, R2] = people;
  const partner = crypto.randomUUID();
  const paths = [];
  for (const [i, u] of people.entries()) {
    await db.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
      values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`,
    [u, `gp${i}-${u.slice(0, 8)}@concurrency.invalid`, `1558${String(i).padStart(7, '0')}${Date.now() % 100}`.slice(0, 13)]);
    await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden, is_admin)
      values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false, $3)`, [u, `Race ${i}`, i < 2]);
  }
  await db.query(`insert into brand_partners (id, name, active) values ($1, 'Race perk cafe', true)`, [partner]);
  const { rows: caps } = await db.query(`delete from private.rate_limit_rules returning *`);
  const gathering = async (when = `now() + interval '2 days'`) => {
    const id = crypto.randomUUID();
    await db.query(`insert into gatherings (id, host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
      values ($1, $2, 'P0', 'D0', ${when}, 26.7, -80.0, 'Coffee', 'abc', 'everyone', true)`, [id, H]);
    await db.query(`insert into gathering_interest (gathering_id, user_id, status) values ($1, $2, 'approved'), ($1, $3, 'approved')`, [id, R, R2]);
    return id;
  };
  const perk = async (g) => (await db.query(`insert into brand_offers (partner_id, title, reward_type, active, gathering_id, unlock_scope, unlock_min_members)
      values ($1, 'Race perk', 'discount', true, $2, 'gathering', 1) returning id`, [partner, g])).rows[0].id;
  const perkState = async (p) => (await db.query(`select active, unlock_scope, gate_removed_at is not null as marked, gathering_id from brand_offers where id = $1`, [p])).rows[0];
  const perkStopped = (s) => s && s.active === false && s.marked && s.unlock_scope === 'gathering' && s.gathering_id === null;
  const report = async (type, id, who = R) => (await run({ sub: who, sql: `insert into reports (reporter_id, reason, content_type, content_id) values ($1, 'other', '${type}', $2) returning id`, args: [who, id] })).rows[0].id;
  const exists = async (table, id) => (await db.query(`select 1 from ${table} where id = $1`, [id])).rows.length > 0;
  const activeHold = async (type, id) => (await db.query(`select 1 from private.legal_holds where target_type = $1 and target_id = $2 and released_at is null`, [type, id])).rows.length > 0;
  const hold = (type, id, wait = 0) => ({ sub: A1, wait, sql: `select public.admin_place_legal_hold('${type}', $1, '${WHY}', null) as h`, args: [id] });
  const purge = (fn, wait = 0) => ({ wait, sql: `select private.${fn}()` });

  try {
    console.log('1. the host cancels vs an attendee claiming the gated perk, both orders');
    for (let i = 0; i < ROUNDS; i += 1) {
      const g = await gathering();
      const p = await perk(g);
      const res = await Promise.all([
        run({ sub: H, wait: i % 2 ? 40 : 0, sql: `select public.cancel_gathering($1)`, args: [g] }),
        run({ sub: R, wait: i % 2 ? 0 : 40, sql: `insert into offer_redemptions (offer_id, user_id) values ($1, $2) returning confirmation_code`, args: [p, R] }),
      ]);
      const codes = (await db.query(`select count(*)::int as n from offer_redemptions where offer_id = $1`, [p])).rows[0].n;
      const ok = res[0].ok && !deadlock(res) && !(await exists('gatherings', g)) && perkStopped(await perkState(p)) && codes === (res[1].ok ? 1 : 0);
      check(ok, `round ${i}: cancelled, perk off + marked, claim ${res[1].ok ? 'got in first (code kept)' : 'refused'}${ok ? '' : ` ${JSON.stringify(res)}`}`);
    }

    console.log('2. the host cancels vs an admin removing the same gathering, both orders');
    for (let i = 0; i < ROUNDS; i += 1) {
      const g = await gathering();
      const p = await perk(g);
      const r1 = await report('gathering', g);
      const res = await Promise.all([
        run({ sub: H, wait: i % 2 ? 40 : 0, sql: `select public.cancel_gathering($1)`, args: [g] }),
        run({ sub: A1, wait: i % 2 ? 0 : 40, sql: `select public.admin_remove_reported_content($1, 'Reported and confirmed as fraud') as r`, args: [r1] }),
      ]);
      const acted = (res[0].ok ? 1 : 0) + (res[1].ok && res[1].rows[0].r.removed > 0 ? 1 : 0);
      const ok = acted === 1 && !deadlock(res) && !(await exists('gatherings', g)) && perkStopped(await perkState(p));
      check(ok, `round ${i}: gone once (${res[0].ok ? 'cancel' : 'removal'}), perk off + marked${ok ? '' : ` ${JSON.stringify(res)}`}`);
    }

    const oldResolvedReport = async () => {
      const g = await gathering();
      const r1 = await report('gathering', g);
      await run({ sub: A2, sql: `select public.admin_resolve_report($1, 'no_action')`, args: [r1] });
      await db.query(`update report_actions set created_at = now() - interval '13 months' where report_id = $1`, [r1]);
      return r1;
    };

    console.log('3. a legal hold vs the report purge, both orders');
    for (let i = 0; i < ROUNDS; i += 1) {
      const r1 = await oldResolvedReport();
      const res = await Promise.all([run(hold('report', r1, i % 2 ? 40 : 0)), run(purge('purge_expired_reports', i % 2 ? 0 : 40))]);
      const kept = await exists('reports', r1);
      const held = await activeHold('report', r1);
      const ok = !deadlock(res) && res[1].ok && ((res[0].ok && kept && held) || (!res[0].ok && res[0].hint === 'legal_hold_not_found' && !kept && !held));
      check(ok, `round ${i}: ${res[0].ok ? 'held, report kept' : 'purge first, hold says not found, no hold left'}${ok ? '' : ` ${JSON.stringify(res)} kept=${kept} held=${held}`}`);
    }

    console.log('4. a legal hold vs "No action needed" on a reported photo, both orders');
    const past = await gathering(`now() - interval '3 hours'`);
    for (let i = 0; i < ROUNDS; i += 1) {
      const path = `${R}/race-${i}-${crypto.randomUUID().slice(0, 6)}.jpg`;
      paths.push(path);
      await db.query(`insert into storage.objects (bucket_id, name) values ('stories', $1)`, [path]);
      const story = (await run({ sub: R, sql: `insert into stories (user_id, media_path, gathering_id) values ($1, $2, $3) returning id`, args: [R, path, past] })).rows[0].id;
      const r1 = await run({ sub: R2, sql: `insert into reports (reporter_id, reason, content_type, content_id) values ($1, 'Inappropriate photo', 'story', $2) returning id`, args: [R2, story] });
      const rep = r1.rows[0].id;
      const res = await Promise.all([run(hold('report', rep, i % 2 ? 40 : 0)),
        run({ sub: A2, wait: i % 2 ? 0 : 40, sql: `select public.admin_resolve_report($1, 'no_action')`, args: [rep] })]);
      const stillHeld = (await db.query(`select released_at is null as h from private.report_media_evidence where report_id = $1`, [rep])).rows[0]?.h;
      const ok = res.every((x) => x.ok) && stillHeld === true;
      check(ok, `round ${i}: hold and resolve both done, photo held${ok ? '' : ` ${JSON.stringify(res)} held=${stillHeld}`}`);
    }

    console.log('5. a legal hold on a removal record vs the snapshot purge, both orders');
    for (let i = 0; i < ROUNDS; i += 1) {
      const g = await gathering();
      const r1 = await report('gathering', g);
      await run({ sub: A2, sql: `select public.admin_remove_reported_content($1, 'Reported and confirmed as fraud')`, args: [r1] });
      const removal = (await db.query(`select id from private.content_removals where content_id = $1`, [g])).rows[0].id;
      await db.query(`update private.content_removals set removed_at = now() - interval '13 months' where id = $1`, [removal]);
      const res = await Promise.all([run(hold('content_removal', removal, i % 2 ? 40 : 0)), run(purge('purge_content_removal_snapshots', i % 2 ? 0 : 40))]);
      const snap = (await db.query(`select snapshot is not null as s from private.content_removals where id = $1`, [removal])).rows[0].s;
      // the snapshot purge only nulls the snapshot (the record stays), so a hold always lands; it keeps the snapshot only if it came first
      const holdFirst = res[0].ok && snap;
      const purgeFirst = res[0].ok && !snap;
      const ok = !deadlock(res) && res[1].ok && (holdFirst || purgeFirst) && (await activeHold('content_removal', removal));
      check(ok, `round ${i}: ${holdFirst ? 'held first, snapshot kept' : 'purge first, snapshot already gone, hold on the record'}${ok ? '' : ` ${JSON.stringify(res)}`}`);
    }
  } finally {
    await db.query('alter table private.legal_holds disable trigger legal_hold_immutable');
    await db.query(`delete from private.legal_holds where placed_by = any($1)`, [people]);
    await db.query('alter table private.legal_holds enable trigger legal_hold_immutable');
    await db.query(`delete from offer_redemptions where user_id = any($1)`, [people]);
    await db.query(`delete from brand_partners where id = $1`, [partner]);
    await db.query(`delete from reports where reporter_id = any($1) or reported_id = any($1)`, [people]);
    await db.query(`delete from stories where user_id = any($1)`, [people]);
    await db.query(`delete from gatherings where host_id = $1`, [H]);
    await db.query(`delete from private.content_removals where owner_id = $1`, [H]);
    await db.query(`delete from private.story_media_removals where poster_id = any($1)`, [people]);
    await db.query(`delete from private.story_file_cleanup where media_path = any($1)`, [paths]);
    await db.query(`delete from storage.objects where bucket_id = 'stories' and name = any($1)`, [paths]);
    await db.query(`delete from push_outbox where recipient_id = any($1)`, [people]);
    await db.query(`delete from auth.users where id = any($1)`, [people]);
    for (const c of caps) {
      const keys = Object.keys(c);
      await db.query(`insert into private.rate_limit_rules (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`, keys.map((k) => c[k]));
    }
    const left = (await db.query(`select (select count(*)::int from auth.users where id = any($1)) users,
      (select count(*)::int from private.legal_holds where placed_by = any($1)) holds,
      (select count(*)::int from brand_offers where partner_id = $2) perks,
      (select count(*)::int from storage.objects where bucket_id = 'stories' and name = any($3)) files,
      (select count(*)::int from private.story_file_cleanup where media_path = any($3)) queued,
      (select count(*)::int from private.rate_limit_rules) rules`, [people, partner, paths])).rows[0];
    check(left.users + left.holds + left.perks + left.files + left.queued === 0 && left.rules === caps.length,
      `cleaned up (${JSON.stringify(left)}, ${caps.length} rate-limit rules restored)`);
    await db.end();
  }
  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
