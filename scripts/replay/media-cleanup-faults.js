#!/usr/bin/env node
// Story file deletion under real failures (owner, 2026-11-05; migration 20270391), on the LOCAL replay stack only. Nothing here is
// mocked at the database: delete_expired_stories runs, REAL pg_net sends each DELETE through fault-proxy.js to the REAL Storage API,
// real responses land in net._http_response, and the next run reads them. Only the proxy injects, per file. Time is simulated by
// moving a row's next_attempt_at / sent_at, nothing else.
// The rule under test: a file leaves the queue only when a success or not-found response AND no object row agree. Any other answer
// keeps it, with bounded retries, a logged failure and admin visibility. A held file is never sent. A file name can't aim the
// service-role DELETE at another file. Two runs at once never lose or double a delete.
//   NEARBY_LOCAL_DB_URL=... NEARBY_LOCAL_STORAGE_URL=... NEARBY_LOCAL_STORAGE_KEYS=... [NEARBY_PG_MODULE=...] [OUT=...]
//   node scripts/replay/media-cleanup-faults.js
const dbUrl = process.env.NEARBY_LOCAL_DB_URL;
const api = process.env.NEARBY_LOCAL_STORAGE_URL;
const local = /^(postgres:\/\/[^@]+@|http:\/\/)(localhost|127\.|172\.|10\.|192\.168\.)/;
if (!dbUrl || !api || !local.test(dbUrl) || !local.test(api)) {
  console.error('NEARBY_LOCAL_DB_URL and NEARBY_LOCAL_STORAGE_URL must point at the local replay stack.');
  process.exit(2);
}
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
const keys = JSON.parse(fs.readFileSync(process.env.NEARBY_LOCAL_STORAGE_KEYS, 'utf8'));
const OUT = process.env.OUT || '/tmp/nearby-replay';
const PROXY = 'nearby-fault-proxy';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, msg) => { if (!ok) failures += 1; console.log(`  ${ok ? '✓' : '✗ FAIL:'} ${msg}`); };

const [P, R, ADMIN] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const G = crypto.randomUUID();
const people = [P, R, ADMIN];
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

function jwt(sub) {
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub, role: 'authenticated', aud: 'authenticated', iat: now, exp: now + 3600 })}`;
  return `${body}.${crypto.createHmac('sha256', keys.secret).update(body).digest('base64url')}`;
}
const encodeName = (name) => name.split('/').map(encodeURIComponent).join('/');
const storage = (who, method, name, opts = {}) => fetch(`${api}/object/${opts.route || ''}stories/${encodeName(name)}`, {
  method, headers: { apikey: keys.anon, Authorization: `Bearer ${who}`, ...(opts.body ? { 'Content-Type': 'image/jpeg' } : {}) }, body: opts.body });
const exists = async (name) => (await storage(keys.service, 'GET', name, { route: 'authenticated/' })).ok;
// the bytes themselves, read inside the Storage container (its files are root's; an emptied folder stays behind, so files only)
function onDisk(name) {
  const base = name.split('/')[1];
  const out = execFileSync('docker', ['exec', 'nearby-storage', 'find', '/var/lib/storage', '-type', 'f', '-path', `*${base}*`]).toString().trim();
  return out.length > 0;
}

(async () => {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  const ip = execFileSync('docker', ['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', 'nearby-storage']).toString().trim();
  execFileSync('docker', ['rm', '-f', PROXY], { stdio: 'ignore' });
  execFileSync('docker', ['run', '-d', '--name', PROXY, '--network', 'nearby-replay-internal', '-e', `TARGET=http://${ip}:5000`,
    '-v', `${path.resolve(__dirname, 'fault-proxy.js')}:/proxy.js:ro`, 'node:20-alpine', 'node', '/proxy.js'], { stdio: 'ignore' });
  const proxyIp = execFileSync('docker', ['inspect', '-f', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', PROXY]).toString().trim();
  const control = (p, body) => fetch(`http://${proxyIp}:8080${p}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
  for (let i = 0; i < 40; i += 1) { try { await control('/__clear'); break; } catch { await sleep(250); } }
  const proxyLog = async () => (await fetch(`http://${proxyIp}:8080/__log`)).json();

  const originalUrl = (await db.query('select storage_url u from private.story_media_settings')).rows[0].u;
  const originalKey = (await db.query(`select decrypted_secret s, id from vault.decrypted_secrets where name = 'service_role_key'`)).rows[0];
  const rules = (await db.query('select * from private.rate_limit_rules')).rows;
  const worker = (await db.query(`select count(*)::int n from pg_stat_activity where backend_type ilike '%pg_net%' or application_name ilike '%pg_net%'`)).rows[0].n;
  console.log(`pg_net ${(await db.query(`select extversion v from pg_extension where extname = 'pg_net'`)).rows[0].v}, worker running: ${worker}`);
  await db.query('update private.story_media_settings set storage_url = $1', [`http://${proxyIp}:8080`]);
  await db.query('delete from private.rate_limit_rules');
  const setKey = (k) => db.query('select vault.update_secret($1, $2)', [originalKey.id, k]);

  const row = async (name) => (await db.query('select * from private.story_file_cleanup where media_path = $1', [name])).rows[0];
  const failLog = async (name) => (await db.query('select * from private.story_file_cleanup_log where media_path = $1 order by id', [name])).rows;
  async function settle() {
    for (let i = 0; i < 120; i += 1) {
      const open = (await db.query(`select count(*)::int n from private.story_file_cleanup q
        where q.request_id is not null and not exists (select 1 from net._http_response h where h.id = q.request_id)`)).rows[0].n;
      if (!open) return;
      await sleep(250);
    }
    throw new Error('pg_net never answered');
  }
  const run = async () => { await db.query('select delete_expired_stories()'); await settle(); };
  const nextHour = () => db.query(`update private.story_file_cleanup set next_attempt_at = now() - interval '1 second' where request_id is null and gave_up_at is null`);
  // one full cycle: send, the response lands, the next run reads it
  const cycle = async () => { await nextHour(); await run(); await db.query('select delete_expired_stories()'); await settle(); };

  async function post(name) {
    const full = `${P}/${name}`;
    const up = await storage(jwt(P), 'POST', full, { body: JPEG });
    if (!up.ok) throw new Error(`upload ${name}: ${up.status} ${await up.text()}`);
    await db.query('begin');
    await db.query('set local session_replication_role = replica');
    const r = await db.query(`insert into stories (user_id, media_path, gathering_id, media_type, expires_at) values ($1, $2, $3, 'image', now() + interval '1 day') returning id`, [P, full, G]);
    await db.query('commit');
    return { full, id: r.rows[0].id };
  }
  const queueIt = async (name) => { const s = await post(name); await db.query('delete from stories where id = $1', [s.id]); return s.full; };

  try {
    for (const [i, u] of people.entries()) {
      await db.query(`insert into auth.users (id, aud, role, email, created_at, phone, phone_confirmed_at)
        values ($1, 'authenticated', 'authenticated', $2, now() - interval '20 days', $3, now())`, [u, `f${i}-${u.slice(0, 8)}@faults.invalid`, `1557${String(i).padStart(8, '0')}`]);
      await db.query(`insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden, is_admin)
        values ($1, $2, date '1994-05-01', now() - interval '20 days', now(), 'America/New_York', true, false, $3)`, [u, `Fault ${i}`, u === ADMIN]);
    }
    await db.query(`insert into gatherings (id, host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
      values ($1, $2, 'Faults', now() - interval '2 days', 26.4, -80.1, 'Volleyball', 'x', 'everyone')`, [G, R]);
    await db.query(`insert into gathering_interest (gathering_id, user_id, status) values ($1, $2, 'approved')`, [G, P]);

    console.log('A real refused key: the real Storage API, nothing injected');
    let f = await queueIt('realkey.jpg');
    await setKey('not-a-real-key');
    await run();
    await db.query('select delete_expired_stories()');
    const a = await row(f);
    const realRefused = (await db.query(`select status_code s, left(content, 120) c from net._http_response order by created desc limit 1`)).rows[0];
    console.log(`    real Storage answered ${realRefused.s}: ${realRefused.c}`);
    check(!!a && a.attempts === 1 && a.request_id === null, 'the file stays queued, one failed attempt counted');
    check(await exists(f), 'the file is really still there');
    check((await failLog(f)).length === 1, 'the failure is logged');
    await setKey(keys.service);

    console.log('Plain success');
    await cycle();
    check(!(await row(f)), `200 and no object: the row leaves the queue`);
    check(!(await exists(f)), 'the API no longer has it');
    check(onDisk(f) === false, 'the bytes are gone from the local disk');

    console.log('Every injected failure keeps the file, the retry then really deletes it');
    const cases = [['401', 'refused'], ['403', 'refused'], ['429', 'rate_limited'], ['500', 'server'], ['502', 'server'], ['503', 'server'], ['504', 'server'],
      ['reset', 'network'], ['hang', 'timeout'], ['ok_untouched', 'still_present'], ['404', 'still_present'], ['not_found_400', 'still_present'], ['418', 'other']];
    for (const [mode, kind] of cases) {
      f = await queueIt(`m-${mode}.jpg`);
      await control('/__script', { path: f, modes: [mode] });
      await cycle();
      const r = await row(f);
      const log = await failLog(f);
      check(!!r && r.attempts === 1 && r.gave_up_at === null && r.next_attempt_at > new Date() && await exists(f), `${mode}: kept, one attempt, backed off, file still there`);
      check(log.length === 1 && log[0].kind === kind, `${mode}: logged as ${log[0]?.kind} (expected ${kind})`);
      await cycle();
      check(!(await row(f)) && !(await exists(f)), `${mode}: the retry really deleted it`);
    }

    console.log('Not found, when the object really is gone');
    const stale = await queueIt('already-gone.jpg');
    const direct = await storage(keys.service, 'DELETE', stale);
    check(direct.ok, 'removed out of band first');
    await run();
    await db.query('select delete_expired_stories()');
    const nf = (await db.query(`select status_code s, left(content, 120) c from net._http_response order by created desc limit 1`)).rows[0];
    console.log(`    real Storage answered ${nf.s}: ${nf.c}`);
    check(!(await row(stale)) && !(await failLog(stale)).length, 'real not-found + no object = complete, not a failure');
    const old = await queueIt('old-style.jpg');
    await storage(keys.service, 'DELETE', old);
    await control('/__script', { path: old, modes: ['not_found_400'] });
    await cycle();
    check(!(await row(old)), "Storage's older 400 + statusCode 404 body, object absent = complete");
    const gone5 = await queueIt('gone-500.jpg');
    await storage(keys.service, 'DELETE', gone5);
    await control('/__script', { path: gone5, modes: ['500'] });
    await cycle();
    check((await row(gone5))?.attempts === 1, 'a 500 never completes a file, even with the object already absent');
    await cycle();
    check(!(await row(gone5)), 'the retry then gets not-found and completes it');

    console.log('A file name can\'t aim the DELETE at another file');
    const held = await post('held.jpg');
    const rep = await db.query(`insert into reports (reporter_id, reason, content_type, content_id) values ($1, 'Other', 'story', $2) returning id`, [R, held.id]);
    check((await db.query('select count(*)::int n from private.report_media_evidence where report_id = $1', [rep.rows[0].id])).rows[0].n === 1, 'held.jpg is held evidence');
    const names = ['held.jpg?x', 'held.jpg?', 'h e l d.jpg', 'a+b&c=d.jpg', "it's(1)@$;:,.jpg"]; // every character Storage accepts that a URL treats specially; % # and non-ASCII are refused at upload
    const queued = [];
    for (const n of names) queued.push(await queueIt(n));
    await cycle();
    check(await exists(held.full), 'held.jpg survives every look-alike name');
    for (const q of queued) check(!(await row(q)) && !(await exists(q)), `"${q.split('/')[1]}" itself is what got deleted`);
    const unsafe = '../../other/x.jpg';
    await db.query(`insert into storage.objects (bucket_id, name) values ('stories', $1)`, [unsafe]);
    await db.query('insert into private.story_file_cleanup (media_path) values ($1)', [unsafe]);
    await control('/__clear');
    await run();
    await db.query('select delete_expired_stories()');
    const u = await row(unsafe);
    check(!!u && u.gave_up_at !== null && (await proxyLog()).length === 0, 'a path with a dot segment is never sent: given up, kept, visible');
    check(u.last_error === 'unsafe_path', 'and says why');
    await db.query('delete from private.story_file_cleanup where media_path = $1', [unsafe]);
    await db.query(`delete from storage.objects where bucket_id = 'stories' and name = $1`, [unsafe]);
    await db.query('delete from private.story_file_cleanup_log where media_path = $1', [unsafe]);

    console.log('A held file is never sent');
    await db.query('delete from stories where id = $1', [held.id]);
    await control('/__clear');
    await cycle();
    check(!(await proxyLog()).some((l) => l.name === held.full) && await exists(held.full), 'no DELETE for it, file there, row gone');
    check(!!(await row(held.full)), 'still queued for later');
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: ADMIN, role: 'authenticated' })]);
    await db.query(`select admin_resolve_report($1, 'no_action')`, [rep.rows[0].id]);
    await db.query(`select set_config('request.jwt.claims', '', false)`);
    await cycle();
    check(!(await row(held.full)) && !(await exists(held.full)), 'after no_action it really goes');

    console.log('Lost response');
    f = await queueIt('lost.jpg');
    await control('/__script', { path: f, modes: ['ok_untouched'] });
    await run();
    await db.query(`delete from net._http_response where id = (select request_id from private.story_file_cleanup where media_path = $1)`, [f]);
    await db.query('select delete_expired_stories()');
    check((await row(f))?.request_id !== null, 'no response yet: it waits, no second DELETE');
    await db.query(`update private.story_file_cleanup set sent_at = now() - interval '3 hours' where media_path = $1`, [f]);
    await db.query('select delete_expired_stories()');
    const lost = await row(f);
    check(lost?.request_id === null && lost?.attempts === 1 && lost?.last_error === 'no_response', 'response never came: counted, cleared for retry');
    await cycle();
    check(!(await row(f)) && !(await exists(f)), 'and the retry deletes it');

    console.log('Bounded: a file that always fails stops, stays and is shown');
    f = await queueIt('stuck.jpg');
    await control('/__script', { path: f, modes: Array(40).fill('500') });
    let rounds = 0;
    const delays = [];
    while (!(await row(f)).gave_up_at && rounds < 20) {
      await cycle();
      rounds += 1;
      const r = await row(f);
      if (!r.gave_up_at) delays.push(Math.round((r.next_attempt_at - new Date()) / 3600000));
    }
    const stuck = await row(f);
    check(stuck.gave_up_at !== null && stuck.attempts === 10, `gives up after 10 attempts (took ${rounds}), backoff hours ${delays.join(',')}`);
    check(await exists(f), 'the file is still there, the row kept');
    await control('/__clear');
    await cycle(); await cycle();
    check((await proxyLog()).length === 0, 'no further DELETE is sent');
    const push = await db.query(`select count(*)::int n, min(title) t, min(body) b from push_outbox where data->>'kind' = 'story_file_cleanup' and recipient_id = $1`, [ADMIN]);
    check(push.rows[0].n === 1, `the admin got one alert, deduped: "${push.rows[0].t}" / "${push.rows[0].b}"`);
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: ADMIN, role: 'authenticated' })]);
    const st = (await db.query('select admin_story_file_cleanup_status() s')).rows[0].s;
    check(st.gave_up === 1 && st.failing === 1, `status shows it (${JSON.stringify(st)})`);
    const retried = (await db.query('select admin_retry_story_file_cleanup() n')).rows[0].n;
    await db.query(`select set_config('request.jwt.claims', '', false)`);
    check(retried === 1, 'an admin retry re-arms it');
    await cycle();
    check(!(await row(f)) && !(await exists(f)), 'and it is really deleted');

    console.log('Two runs at once, 40 rounds, some failing');
    await control('/__clear');
    const total = [];
    for (let i = 0; i < 40; i += 1) {
      const name = await queueIt(`both-${i}.jpg`);
      total.push(name);
      if (i % 3 === 0) await control('/__script', { path: name, modes: ['503'] });
    }
    const conns = [0, 1].map(() => new Client({ connectionString: dbUrl }));
    await Promise.all(conns.map((c) => c.connect()));
    for (let i = 0; i < 6; i += 1) {
      await nextHour();
      await Promise.all(conns.map((c) => c.query('select delete_expired_stories()')));
      await settle();
      await Promise.all(conns.map((c) => c.query('select delete_expired_stories()')));
      await settle();
    }
    await Promise.all(conns.map((c) => c.end()));
    const log = await proxyLog();
    const perFile = total.map((n, i) => ({ i, sends: log.filter((l) => l.name === n).length }));
    check(perFile.every((p) => p.sends === (p.i % 3 === 0 ? 2 : 1)), 'every file got exactly one DELETE per real attempt (never doubled)');
    const left = (await db.query(`select count(*)::int n from private.story_file_cleanup where media_path = any($1)`, [total])).rows[0].n;
    let there = 0;
    for (const n of total) if (await exists(n)) there += 1;
    check(left === 0 && there === 0, `nothing lost: queue ${left}, files left ${there}`);
  } finally {
    await db.query(`select set_config('request.jwt.claims', '', false)`).catch(() => {});
    await db.query('update private.story_media_settings set storage_url = $1', [originalUrl]).catch(() => {});
    await db.query('select vault.update_secret($1, $2)', [originalKey.id, originalKey.s]).catch(() => {});
    for (const r of rules) {
      const cols = Object.keys(r);
      await db.query(`insert into private.rate_limit_rules (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')}) on conflict do nothing`, cols.map((c) => r[c])).catch(() => {});
    }
    await db.query('delete from reports where reporter_id = any($1)', [people]).catch(() => {});
    await db.query('delete from stories where user_id = any($1)', [people]).catch(() => {});
    await db.query('delete from gatherings where id = $1', [G]).catch(() => {});
    await db.query(`delete from private.story_file_cleanup where media_path like $1`, [`${P}/%`]).catch(() => {});
    await db.query(`delete from private.story_file_cleanup_log where media_path like $1`, [`${P}/%`]).catch(() => {});
    await db.query('delete from push_outbox where recipient_id = any($1)', [people]).catch(() => {});
    await db.query('delete from profiles where id = any($1)', [people]).catch(() => {});
    await db.query('delete from auth.users where id = any($1)', [people]).catch(() => {});
    await db.end();
    try { execFileSync('docker', ['rm', '-f', PROXY], { stdio: 'ignore' }); } catch { /* gone */ }
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
