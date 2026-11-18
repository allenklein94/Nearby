#!/usr/bin/env node
// One-time setup of a NEW, EMPTY staging Supabase project (owner, 2026-11-15; PRODUCT_AUDIT/STAGING_PROJECT_PLAN_2026-11-15.md
// approval C). Never production: the runner is --target=staging only (scripts/migrations/ledger.js stagingRunner refuses the
// production ref, a missing/shared token) and this script refuses again on its own.
// Run by a session or the owner only after approval C (applying migrations to staging); writing this file approves nothing.
//
//   node scripts/staging/bootstrap.js plan  [--through=20270347]   read-only: checks the project is empty, lists what apply sends,
//                                                                 prints the approval code for exactly that list + ref
//   NEARBY_STAGING_BOOTSTRAP_APPROVAL=<code> NEARBY_SESSION_ID=<id> node scripts/staging/bootstrap.js apply [--through=...]
// Env: NEARBY_STAGING_ACCESS_TOKEN (never SUPABASE_ACCESS_TOKEN); ref from NEARBY_STAGING_REF or .claude/staging.json.
//
// What apply does, in order (everything besides running the migration files is listed here):
//  1. refuses unless the public schema is empty (a fresh project) and the code matches;
//  2. every migration file up to and including --through (default 20270347 = what production runs today), in filename order,
//     each in ONE transaction (as production applies them); files after the ledger migration (20270345) are recorded in
//     private.migration_ledger as 'deployed' with approval_ref "staging bootstrap <code>" (the ledger migration itself writes
//     the same baseline/historical rows it wrote on production; their text describes production);
//  3. production's operational step around 20270294 (scripts/replay/from-scratch-replay.sh): the category code-inventory sync
//     before it (f62ff7e9^1) and after it (f62ff7e9);
//  4. RE-POINT, inside EVERY migration's own transaction (before its COMMIT): every public/private function and cron job whose
//     body names the production project (edge-function URLs such as send-push, screen-business-content) is re-created with
//     the staging ref, so no committed state of the staging database ever calls production (132 files name its URL);
//     after the last file: checked, 0 left, else it fails.
//  5. AUDIT, also inside every migration's transaction and once more at the end (scripts/staging/outboundAudit.js): reads the
//     database itself, independently of the re-point (functions, triggers + webhook arguments, views, defaults, policies,
//     constraints, cron jobs, queued pg_net requests, foreign servers, settings, vault, every text/json column). Any
//     production reference or unexpected outbound host raises, so that migration's transaction never commits.
// NOT done here (owner steps, see the plan): the vault secret 'service_role_key' (staging's own service key), Auth settings
// (test OTP numbers), edge functions, secrets, seed data. Later staged migrations go one at a time through
// `npm run migration:deploy -- <file> --target=staging` (the rehearsal).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('../migrations/ledger');
const { auditSql, runAudit } = require('./outboundAudit');

const REPO = path.resolve(__dirname, '../..');
const { PRODUCTION_REF } = require('../lib/stagingTarget');
const LEDGER_VERSION = '20270345';
const INVENTORY_MIGRATION = '20270294_v1_category_pass.sql';
const DEFAULT_THROUGH = '20270347';

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// Every .sql file in filename order, like scripts/replay/from-scratch-replay.sh: the 14-digit baseline
// (00000000000000_baseline.sql) first, then the 8-digit versions up to --through. (The ledger's own list holds only 8-digit
// versions; the baseline predates it.)
function migrationList(through, repoRoot = REPO) {
  const dir = path.join(repoRoot, 'supabase/migrations');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => ({
    version: f.slice(0, 8), rel: `supabase/migrations/${f}`, sha256: sha256(fs.readFileSync(path.join(dir, f))),
  })).filter((m) => m.version <= through);
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
  -- cron.job is owned by the extension: change jobs through pg_cron's own cron.alter_job (a direct UPDATE is refused).
  if to_regclass('cron.job') is not null then
    for r in select jobid, command from cron.job where command like '%${PRODUCTION_REF}%' loop
      perform cron.alter_job(r.jobid, command := replace(r.command, '${PRODUCTION_REF}', '${stagingRef}'));
    end loop;
  end if;
  -- Column defaults naming production (20270391: private.story_media_settings.storage_url defaults to production's
  -- Storage API, where its cleanup job sends DELETE requests).
  for r in select n.nspname, c.relname, a.attname, pg_get_expr(d.adbin, d.adrelid) as expr
             from pg_attrdef d join pg_class c on c.oid = d.adrelid join pg_namespace n on n.oid = c.relnamespace
             join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
            where n.nspname in ('public', 'private') and pg_get_expr(d.adbin, d.adrelid) like '%${PRODUCTION_REF}%' loop
    execute format('alter table %I.%I alter column %I set default %s', r.nspname, r.relname, r.attname,
                   replace(r.expr, '${PRODUCTION_REF}', '${stagingRef}'));
  end loop;
  -- Stored values naming production, ONLY in private configuration tables (private.*_settings: single rows written by
  -- migrations, never by people). A production reference anywhere else is left for the audit to refuse.
  for r in select n.nspname, c.relname, a.attname
             from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'private' and c.relkind = 'r' and c.relname like '%\\_settings' and a.attnum > 0
              and not a.attisdropped and a.atttypid in ('text'::regtype, 'varchar'::regtype) loop
    execute format('update %I.%I set %I = replace(%I, %L, %L) where %I like %L', r.nspname, r.relname, r.attname, r.attname,
                   '${PRODUCTION_REF}', '${stagingRef}', r.attname, '%${PRODUCTION_REF}%');
  end loop;
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
    try { await run(`begin;\n${sql}\n;\n${repointSql(ref)}\n${auditSql(ref)}${record}\ncommit;`); } catch (e) {
      throw new Error(`FAILED at ${base} (that file rolled back; earlier ones are applied): ${e.message.slice(0, 400)}`);
    }
    log(`ok ${base}`);
    if (base === INVENTORY_MIGRATION) await run(inventorySql('f62ff7e9'));
  }
  await run(repointSql(ref));
  const [left] = await run(LEFTOVER_SQL);
  if (left.functions || left.cron_jobs) throw new Error(`re-point incomplete: ${JSON.stringify(left)} still name production`);
  log(`re-pointed: 0 functions / cron jobs name production`);
  const audit = await runAudit(run, ref); // independent of the re-point: the finished database, read on its own
  if (!audit.ok) throw new Error(`outbound audit FAILED after bootstrap:\n- ${audit.findings.join('\n- ')}`);
  log('outbound audit: no production reference, no unexpected outbound host, anywhere in the database');
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
