#!/usr/bin/env node
// Migration deployment safeguards against a DISPOSABLE Postgres (owner, 2026-10-24). Never production: refuses a hosted
// Supabase URL and any database that already holds the app's schema (public.gatherings) unless it is empty of ledger work.
//   docker network create --internal nearby-ledger-net
//   docker run -d --name nearby-ledger-test --network nearby-ledger-net -e POSTGRES_PASSWORD=postgres supabase/postgres:15.1.0.147
//   NEARBY_LOCAL_DB_URL=postgres://postgres:postgres@<ip>:5432/postgres NEARBY_PG_MODULE=/path/to/pg node scripts/migrations/disposable-db-test.js
// Fixture migrations live in a throwaway git repo; the real 20270345 file is copied in and deployed through deploy.js itself.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./ledger');
const deploy = require('./deploy');
const status = require('./status');

const REAL = path.resolve(__dirname, '../..');
const url = process.env.NEARBY_LOCAL_DB_URL;
const { run } = L.runner('local'); // throws for a missing or hosted URL

let pass = 0; let fail = 0;
const check = (name, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); };
const one = async (sql) => (await run(sql))[0];
const quiet = async (fn) => { const o = console.log; const e = console.error; const out = []; console.log = (...a) => out.push(a.join(' ')); console.error = console.log;
  try { return { code: await fn(), out: out.join('\n') }; } finally { console.log = o; console.error = e; } };

const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'nearby-ledger-db-'));
const g = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' }).toString();
g('init', '-q'); g('config', 'user.email', 't@t.invalid'); g('config', 'user.name', 't');
fs.mkdirSync(path.join(repo, 'supabase/migrations'), { recursive: true });
const write = (name, sql) => fs.writeFileSync(path.join(repo, 'supabase/migrations', name), sql);
const commit = () => { g('add', '-A'); g('commit', '-qm', 'fixture'); };
const rel = (name) => `supabase/migrations/${name}`;
const envFor = (name, extra = {}) => {
  const f = L.migrationFacts(rel(name), repo);
  return { NEARBY_PROD_APPROVAL: L.approvalToken(f), NEARBY_APPROVAL_REF: 'disposable test', NEARBY_SESSION_ID: 'disposable-test', ...extra };
};
const dep = (name, env, extra = []) => quiet(() => deploy.main([rel(name), '--target=local', ...extra], env, repo));
const ledgerRows = async () => { const l = await L.readLedger(run); return l.exists ? l.rows : null; };
const tableExists = async (t) => (await one(`select to_regclass('${t}') is not null as e`)).e;
const fingerprint = async () => JSON.stringify([await ledgerRows(),
  (await one(`select coalesce(string_agg(c.oid::regclass::text, ',' order by 1), '') t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname in ('public','private') and c.relkind = 'r'`)).t]);

(async () => {
  if (await tableExists('public.gatherings')) throw new Error('this database holds the app schema: use a fresh disposable database');
  if (await tableExists('private.migration_ledger')) throw new Error('ledger already present: use a fresh disposable database');

  fs.copyFileSync(path.join(REAL, rel('20270345_migration_ledger.sql')), path.join(repo, rel('20270345_migration_ledger.sql')));
  commit();

  // 1 missing / generic approval: refused before anything is sent
  let r = await dep('20270345_migration_ledger.sql', { ...envFor('20270345_migration_ledger.sql'), NEARBY_PROD_APPROVAL: '' });
  check('missing approval refused (exit 2)', r.code === 2 && /missing approval/.test(r.out), r.out);
  r = await dep('20270345_migration_ledger.sql', { ...envFor('20270345_migration_ledger.sql'), NEARBY_PROD_APPROVAL: 'true' });
  check('generic approval "true" refused', r.code === 2 && /does not match/.test(r.out), r.out);
  check('nothing created by the refusals', !(await tableExists('private.migration_ledger')));

  // 2 a migration other than the ledger's can't go first
  write('20270346_fail.sql', 'create table public.ltest_a (id int);\nselect 1/0;\n'); commit();
  r = await dep('20270346_fail.sql', envFor('20270346_fail.sql'));
  check('non-ledger migration refused before the ledger exists', r.code === 2 && /deploy 20270345 first/.test(r.out), r.out);

  // 3 verification mode: rolled back, nothing committed
  const before = await fingerprint();
  r = await dep('20270345_migration_ledger.sql', envFor('20270345_migration_ledger.sql'), ['--check']);
  check('--check passes', r.code === 0 && /CHECK OK/.test(r.out), r.out);
  check('--check left the database unchanged', (await fingerprint()) === before);

  // 4 bootstrap: the ledger migration deploys and records itself, atomically with its backfill
  r = await dep('20270345_migration_ledger.sql', envFor('20270345_migration_ledger.sql'));
  check('20270345 deployed + recorded', r.code === 0 && /DEPLOYED \+ RECORDED/.test(r.out), r.out);
  let rows = await ledgerRows();
  const by = Object.fromEntries((rows || []).map((x) => [x.version, x]));
  check('ledger = baseline + 20270344 historical + 20270345 deployed', JSON.stringify((rows || []).map((x) => `${x.version}:${x.record_kind}`)) === JSON.stringify(['20270344:historical', '20270345:deployed', 'pre-ledger:baseline']), JSON.stringify(rows));
  const f45 = L.migrationFacts(rel('20270345_migration_ledger.sql'), repo);
  check('20270345 row carries hash, commit, time, approval ref, session', by['20270345'] && by['20270345'].file_sha256 === f45.sha256 && by['20270345'].git_commit === f45.commit
    && !!by['20270345'].applied_at && by['20270345'].approval_ref === 'disposable test' && by['20270345'].session_id === 'disposable-test', JSON.stringify(by['20270345']));
  check('20270344 historical row = its committed hash + commit, dated 12:56:09 UTC', by['20270344'] && by['20270344'].file_sha256 === L.migrationFacts(rel('20270344_request_deadlines_follow_gathering.sql'), REAL).sha256
    && by['20270344'].git_commit === 'bf0cbb3e28ee0fc61e2f87a6e8a64885eb80f16c' && String(by['20270344'].applied_at).startsWith('2026-10-24T12:56:09.501'), JSON.stringify(by['20270344']));
  const priv = await one(`select has_table_privilege('anon', 'private.migration_ledger', 'select') a, has_table_privilege('authenticated', 'private.migration_ledger', 'select,insert') b`);
  check('no anon / authenticated privilege on the ledger', priv.a === false && priv.b === false, JSON.stringify(priv));
  for (const [op, sql] of [['update', `update private.migration_ledger set notes = 'x' where version = '20270345'`], ['delete', `delete from private.migration_ledger where version = '20270345'`], ['truncate', 'truncate private.migration_ledger']]) {
    let refused = false; try { await run(sql); } catch (e) { refused = /append-only/.test(e.message); }
    check(`ledger ${op} refused (append-only)`, refused);
  }

  // 5 duplicate deploy: refused, never re-applied
  r = await dep('20270345_migration_ledger.sql', envFor('20270345_migration_ledger.sql'));
  check('duplicate deploy refused', r.code === 2 && /already recorded/.test(r.out), r.out);

  // 6 mismatched hash: an approval for the committed file doesn't cover an edited one (uncommitted or newly committed)
  const okEnv46 = envFor('20270346_fail.sql');
  write('20270346_fail.sql', 'create table public.ltest_a (id int);\nselect 1/0;\n-- edited\n');
  r = await dep('20270346_fail.sql', okEnv46);
  check('uncommitted edit refused', r.code === 2 && /uncommitted changes/.test(r.out) && /does not match/.test(r.out), r.out);
  commit();
  r = await dep('20270346_fail.sql', okEnv46);
  check('approval for the previous hash refused after a new commit', r.code === 2 && /does not match/.test(r.out) && !/uncommitted/.test(r.out), r.out);

  // 7 a migration that fails halfway: nothing of it, no record
  r = await dep('20270346_fail.sql', envFor('20270346_fail.sql'));
  check('failing migration reports DEPLOY FAILED', r.code === 1 && /DEPLOY FAILED/.test(r.out), r.out);
  check('failing migration left no table and no record', !(await tableExists('public.ltest_a')) && !(await ledgerRows()).some((x) => x.version === '20270346'));

  // 8 interrupted deploy: connection killed mid-transaction, after its DDL ran
  write('20270347_slow.sql', 'create table public.ltest_b (id int);\nselect pg_sleep(30);\n'); commit();
  const pending = dep('20270347_slow.sql', envFor('20270347_slow.sql'));
  let killed = false;
  for (let i = 0; i < 100 && !killed; i++) {
    await new Promise((res) => setTimeout(res, 100));
    const k = await one(`select count(pg_terminate_backend(pid)) n from pg_stat_activity where query like '%ltest_b%' and query like '%pg_sleep%' and pid <> pg_backend_pid()`);
    killed = Number(k.n) > 0;
  }
  r = await pending;
  check('interrupted deploy: connection killed mid-transaction', killed && r.code === 1, r.out);
  check('interrupted deploy left no table and no record', !(await tableExists('public.ltest_b')) && !(await ledgerRows()).some((x) => x.version === '20270347'));

  // 9 two deploys of the same file at once: both pass preflight; the ledger key lets exactly one commit, the other rolls back
  await run('create table public.ltest_counter (n int)');
  write('20270348_count.sql', 'insert into public.ltest_counter values (1);\nselect pg_sleep(1);\n'); commit();
  // (not through quiet(): two captures at once would swap the global console under each other; the race prints its own lines)
  const raceOne = () => deploy.main([rel('20270348_count.sql'), '--target=local'], envFor('20270348_count.sql'), repo).then((code) => ({ code, out: '' }));
  const race = await Promise.all([raceOne(), raceOne()]);
  const counted = Number((await one('select count(*) n from public.ltest_counter')).n);
  check('concurrent duplicate: one deploys, one fails', race.map((x) => x.code).sort().join() === '0,1', race.map((x) => x.out).join('\n---\n'));
  check('concurrent duplicate: the migration took effect exactly once, one record', counted === 1 && (await ledgerRows()).filter((x) => x.version === '20270348').length === 1, `counter=${counted}`);

  // 10 a normal successful migration
  write('20270349_ok.sql', 'create table public.ltest_ok (id int primary key);\n'); commit();
  r = await dep('20270349_ok.sql', envFor('20270349_ok.sql'));
  rows = await ledgerRows();
  check('successful deploy: table + record committed together', r.code === 0 && (await tableExists('public.ltest_ok')) && rows.some((x) => x.version === '20270349' && x.record_kind === 'deployed'), r.out);

  // 11 out of order: a lower, never-recorded version can't go after a higher one
  write('20270347_slow.sql', 'create table public.ltest_b (id int);\n'); commit();
  r = await dep('20270347_slow.sql', envFor('20270347_slow.sql'));
  check('out-of-order deploy refused', r.code === 2 && /out of order/.test(r.out), r.out);

  // 12 status on a READ-ONLY connection (it could not write if it tried), and the report it gives
  const roUrl = `${url}${url.includes('?') ? '&' : '?'}options=${encodeURIComponent('-c default_transaction_read_only=on')}`;
  process.env.NEARBY_LOCAL_DB_URL = roUrl;
  const beforeStatus = await fingerprint();
  const s = await quiet(() => status.main(['--target=local'], repo));
  process.env.NEARBY_LOCAL_DB_URL = url;
  check('status runs on a read-only connection', s.code === 0, s.out);
  check('status reports recorded / NOT RECORDED correctly', /20270345\s+recorded \(deployed\)/.test(s.out) && /20270346\s+NOT RECORDED/.test(s.out) && /20270349\s+recorded \(deployed\)/.test(s.out), s.out);
  check('status changed nothing', (await fingerprint()) === beforeStatus);
  // verification mode on a new migration: passes, and the database is exactly as before
  write('20270350_check.sql', 'create table public.ltest_check (id int);\n'); commit();
  const beforeCheck = await fingerprint();
  r = await dep('20270350_check.sql', envFor('20270350_check.sql'), ['--check']);
  check('--check on a new migration passes and leaves nothing', r.code === 0 && (await fingerprint()) === beforeCheck, r.out);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
