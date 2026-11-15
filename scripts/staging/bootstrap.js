#!/usr/bin/env node
// One-time setup of a NEW, EMPTY staging Supabase project (owner, 2026-11-15; PRODUCT_AUDIT/STAGING_PROJECT_PLAN_2026-11-15.md
// approval C). Never production: the runner is --target=staging only (scripts/migrations/ledger.js stagingRunner refuses the
// production ref, a missing/shared token) and this script refuses again on its own.
//
//   node scripts/staging/bootstrap.js plan  [--through=20270347]   read-only: checks the project is empty, lists what apply sends,
//                                                                 prints the approval code for exactly that list + ref
//   NEARBY_STAGING_BOOTSTRAP_APPROVAL=<code> NEARBY_SESSION_ID=<id> node scripts/staging/bootstrap.js apply [--through=...]
// Env: NEARBY_STAGING_REF, NEARBY_STAGING_ACCESS_TOKEN (never SUPABASE_ACCESS_TOKEN).
//
// What apply does, in order (everything besides running the migration files is listed here):
//  1. refuses unless the public schema is empty (a fresh project) and the code matches;
//  2. every migration file up to and including --through (default 20270347 = what production runs today), in filename order,
//     each in ONE transaction (as production applies them); files after the ledger migration (20270345) are recorded in
//     private.migration_ledger as 'deployed' with approval_ref "staging bootstrap <code>" (the ledger migration itself writes
//     the same baseline/historical rows it wrote on production; their text describes production);
//  3. production's operational step around 20270294 (scripts/replay/from-scratch-replay.sh): the category code-inventory sync
//     before it (f62ff7e9^1) and after it (f62ff7e9);
//  4. RE-POINT: every public/private function and cron job whose body still names the production project (edge-function URLs
//     such as send-push, screen-business-content) is re-created with the staging ref, then checked: 0 left, else it fails.
// NOT done here (owner steps, see the plan): the vault secret 'service_role_key' (staging's own service key), Auth settings
// (test OTP numbers), edge functions, secrets, seed data. Later staged migrations go one at a time through
// `npm run migration:deploy -- <file> --target=staging` (the rehearsal).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('../migrations/ledger');

const REPO = path.resolve(__dirname, '../..');
const PRODUCTION_REF = 'enmosvippabmuqslzrox';
const LEDGER_VERSION = '20270345';
const INVENTORY_MIGRATION = '20270294_v1_category_pass.sql';
const DEFAULT_THROUGH = '20270347';

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

function migrationList(through, repoRoot = REPO) {
  return L.repoMigrations(repoRoot).filter((m) => m.version <= through);
}

function approvalCode(ref, list) {
  return sha256(JSON.stringify({ ref, files: list.map((m) => [m.rel, m.sha256]) })).slice(0, 12);
}

function inventorySql(rev, repoRoot = REPO) {
  const json = execFileSync('git', ['-C', repoRoot, 'show', `${rev}:scripts/taxonomy/code-dependencies.json`], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (json.includes('$inv$')) throw new Error('inventory contains the quoting marker');
  return `select sync_category_code_dependencies($inv$${json}$inv$::jsonb, ${lit(`staging-bootstrap:${rev}`)})::text as synced;`;
}

// Re-creates every function / cron job naming the production project with the staging ref (definitions keep their grants:
// CREATE OR REPLACE keeps the ACL). Refuses if handed the production ref.
function repointSql(stagingRef) {
  if (!/^[a-z0-9]{20}$/.test(stagingRef) || stagingRef === PRODUCTION_REF) throw new Error('repoint: not a staging ref');
  return `do $repoint$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private') and p.prokind = 'f' and p.prosrc like '%${PRODUCTION_REF}%' loop
    execute replace(pg_get_functiondef(r.oid), '${PRODUCTION_REF}', '${stagingRef}');
  end loop;
  if to_regclass('cron.job') is not null then
    update cron.job set command = replace(command, '${PRODUCTION_REF}', '${stagingRef}') where command like '%${PRODUCTION_REF}%';
  end if;
end $repoint$;`;
}

const LEFTOVER_SQL = `select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and p.prosrc like '%${PRODUCTION_REF}%')::int as functions,
  (case when to_regclass('cron.job') is null then 0 else (select count(*) from cron.job where command like '%${PRODUCTION_REF}%') end)::int as cron_jobs`;
const PUBLIC_EMPTY_SQL = `select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace`;

async function plan({ run, ref, through }) {
  const list = migrationList(through);
  const [{ n }] = await run(PUBLIC_EMPTY_SQL);
  const code = approvalCode(ref, list);
  return { ref, through, files: list.length, first: list[0]?.rel, last: list[list.length - 1]?.rel, publicObjects: n, empty: n === 0, code };
}

async function apply({ run, ref, through, env, log = console.log }) {
  const p = await plan({ run, ref, through });
  if (!p.empty) throw new Error(`staging public schema is not empty (${p.publicObjects} objects): bootstrap is for a fresh project only`);
  if ((env.NEARBY_STAGING_BOOTSTRAP_APPROVAL || '').trim() !== p.code) throw new Error(`approval missing or wrong: NEARBY_STAGING_BOOTSTRAP_APPROVAL must be ${p.code} (from plan)`);
  const session = (env.NEARBY_SESSION_ID || '').trim();
  if (!session) throw new Error('missing NEARBY_SESSION_ID');
  const commit = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  for (const m of migrationList(through)) {
    const base = path.basename(m.rel);
    if (base === INVENTORY_MIGRATION) await run(inventorySql('f62ff7e9^1'));
    const sql = fs.readFileSync(path.join(REPO, m.rel), 'utf8');
    const record = m.version > LEDGER_VERSION
      ? `\ninsert into private.migration_ledger (version, record_kind, file_sha256, git_commit, applied_at, approval_ref, session_id, notes)
values (${lit(m.version)}, 'deployed', ${lit(m.sha256)}, ${lit(commit)}, now(), ${lit(`staging bootstrap ${p.code}`)}, ${lit(session)}, 'STAGING project bootstrap (scripts/staging/bootstrap.js)');`
      : '';
    try { await run(`begin;\n${sql}\n;${record}\ncommit;`); } catch (e) {
      throw new Error(`FAILED at ${base} (that file rolled back; earlier ones are applied): ${e.message.slice(0, 400)}`);
    }
    log(`ok ${base}`);
    if (base === INVENTORY_MIGRATION) await run(inventorySql('f62ff7e9'));
  }
  await run(repointSql(ref));
  const [left] = await run(LEFTOVER_SQL);
  if (left.functions || left.cron_jobs) throw new Error(`re-point incomplete: ${JSON.stringify(left)} still name production`);
  log(`re-pointed: 0 functions / cron jobs name production`);
  return { ...p, applied: p.files };
}

async function main(argv, env = process.env) {
  const mode = argv[0];
  const through = ((argv.find((a) => a.startsWith('--through=')) || '').split('=')[1]) || DEFAULT_THROUGH;
  if (!/^\d{8}$/.test(through)) throw new Error('--through must be an 8-digit version');
  const r = L.stagingRunner(env);
  if (mode === 'plan') { console.log(JSON.stringify(await plan({ run: r.run, ref: r.ref, through }), null, 2)); return 0; }
  if (mode === 'apply') { console.log(JSON.stringify(await apply({ run: r.run, ref: r.ref, through, env }), null, 2)); return 0; }
  throw new Error('usage: bootstrap.js plan|apply [--through=YYYYMMDD]');
}

if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
module.exports = { plan, apply, repointSql, approvalCode, migrationList, LEFTOVER_SQL, PRODUCTION_REF };
