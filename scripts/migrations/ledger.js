// Migration deployment safeguards (owner approved 2026-10-24, after 20270344 was applied by a session that was cut off before
// recording it). ONE production apply path: scripts/migrations/deploy.js. It sends the migration AND its row in
// private.migration_ledger (20270345) as one transaction, so a migration is live with its record or not at all.
// Read-only status: scripts/migrations/status.js. Pure checks live here so Jest can prove every refusal without a database.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const LEDGER_MIGRATION = '20270345'; // creates the ledger; the only version deployable before the ledger exists
const BASELINE_MAX = '20270343'; // the 'pre-ledger' baseline row stands for every version up to and including this one
const MIGRATIONS_DIR = 'supabase/migrations';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

function git(repoRoot, args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'buffer', stdio: ['ignore', 'pipe', 'pipe'] });
}

// The file's identity: version from its name, exact bytes on disk, and what git holds for it at HEAD.
function migrationFacts(file, repoRoot) {
  const abs = path.resolve(repoRoot, file);
  const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
  const m = /^supabase\/migrations\/(\d{8})_[A-Za-z0-9_]+\.sql$/.exec(rel);
  const content = fs.existsSync(abs) ? fs.readFileSync(abs) : null;
  const facts = { rel, version: m ? m[1] : null, inMigrationsDir: !!m, exists: !!content, content: content && content.toString('utf8'),
    sha256: content ? sha256(content) : null, tracked: false, clean: false, headSha256: null, commit: null };
  if (!content) return facts;
  try { git(repoRoot, ['ls-files', '--error-unmatch', '--', rel]); facts.tracked = true; } catch { return facts; }
  facts.clean = git(repoRoot, ['status', '--porcelain', '--', rel]).toString().trim() === '';
  try { facts.headSha256 = sha256(git(repoRoot, ['show', `HEAD:${rel}`])); } catch { facts.headSha256 = null; }
  const c = git(repoRoot, ['log', '-1', '--format=%H', '--', rel]).toString().trim();
  facts.commit = /^[0-9a-f]{40}$/.test(c) ? c : null;
  facts.gateFailures = predeployGateFailures(facts.version, repoRoot);
  return facts;
}

// Owner-required checks a migration must have passed BEFORE it may be deployed (not after). Each is evidence committed in
// the repo, so the refusal is the same one Jest proves. A version not listed has no extra gate.
//   20270414 (owner, 2026-11-12): the business-comparison disclosure published in docs/privacy.html (marker), and a committed
//   evidence file recording a passing `deno check` of screen-business-content and a passing real two-business identical-
//   image upload (that needs 0414 + the edge function on a NON-production project first: no staging project exists yet).
const PREDEPLOY_GATES = {
  20270414: {
    marker: { file: 'docs/privacy.html', text: 'business-disclosure:duplicate-check' },
    evidence: { file: 'PRODUCT_AUDIT/evidence/20270414_predeploy.md', checks: ['deno-check', 'real-upload-test'] },
  },
};
function predeployGateFailures(version, repoRoot) {
  const g = PREDEPLOY_GATES[version];
  if (!g) return [];
  // Evidence counts only as COMMITTED at HEAD: an uncommitted or edited copy on disk never passes (and says so).
  const read = (f) => { try { return git(repoRoot, ['show', `HEAD:${f}`]).toString('utf8'); } catch { return null; } };
  const dirty = (f) => { try { return git(repoRoot, ['status', '--porcelain', '--', f]).toString().trim() !== ''; } catch { return true; } };
  const r = [];
  [g.marker.file, g.evidence.file].forEach((f) => { if (dirty(f)) r.push(`pre-deploy gate: ${f} has uncommitted changes; only the committed copy counts`); });
  const page = read(g.marker.file);
  if (!page || !page.includes(g.marker.text)) r.push(`pre-deploy gate: ${g.marker.file} does not carry the approved disclosure (marker ${g.marker.text})`);
  const ev = read(g.evidence.file);
  // Fail closed: only a line "<check>: PASS <where/when>" passes. A recorded FAIL, a missing line, two answers for one check,
  // or anything malformed refuses, each with its own reason.
  g.evidence.checks.forEach((c) => {
    const lines = (ev || '').split(/\r?\n/).filter((l) => l.trim().toLowerCase().startsWith(`${c}:`));
    const want = `${g.evidence.file}: "${c}: PASS <where/when>"`;
    if (!ev) r.push(`pre-deploy gate: no evidence file (${want} required)`);
    else if (!lines.length) r.push(`pre-deploy gate: ${c} has no result recorded (${want} required)`);
    else if (lines.length > 1) r.push(`pre-deploy gate: ${c} is recorded ${lines.length} times; keep exactly one result`);
    else if (/^\S+:\s*FAIL\b/i.test(lines[0].trim())) r.push(`pre-deploy gate: ${c} is recorded as FAILED: "${lines[0].trim().slice(0, 120)}"`);
    else if (!new RegExp(`^${c}: PASS \\S+`).test(lines[0].trim())) r.push(`pre-deploy gate: ${c} result is malformed: "${lines[0].trim().slice(0, 120)}" (${want} required)`);
  });
  return r;
}

// Statements that would break the single-transaction guarantee (or can't run inside one). plpgsql `end;` is fine; a
// plpgsql block's `begin` never ends in a semicolon.
const FORBIDDEN = [
  [/^\s*(begin|start\s+transaction)\s*(transaction|work)?\s*;/im, 'own transaction control (BEGIN)'],
  [/^\s*commit\s*(transaction|work)?\s*;/im, 'own transaction control (COMMIT)'],
  [/^\s*rollback\b[^;]*;/im, 'own transaction control (ROLLBACK)'],
  [/\bconcurrently\b/i, 'CONCURRENTLY (cannot run inside a transaction)'],
  [/^\s*vacuum\b/im, 'VACUUM (cannot run inside a transaction)'],
  [/^\s*alter\s+system\b/im, 'ALTER SYSTEM (cannot run inside a transaction)'],
];
function forbiddenStatements(sql) {
  // strip comments first so a mention in a comment never trips (or hides) a check
  const code = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return FORBIDDEN.filter(([re]) => re.test(code)).map(([, why]) => why);
}

// The approval must name THIS version and THIS exact file hash: `<version>:<sha256>`. Nothing generic ("true", "yes") passes.
const approvalToken = (facts) => `${facts.version}:${facts.sha256}`;

// Every reason to refuse, before anything is sent. `ledger` = { exists, rows: [{ version, ... }] } read by status SQL.
// target: the pre-deploy gates guard PRODUCTION only (their evidence comes from non-production runs); anything but an
// explicit 'local' counts as production, so a missing target fails closed.
function preflight({ facts, env, ledger, target }) {
  const r = [];
  if (!facts.exists) return [`file not found: ${facts.rel}`];
  if (!facts.inMigrationsDir) r.push(`not a migration file under ${MIGRATIONS_DIR}/ named <8 digits>_<name>.sql: ${facts.rel}`);
  if (!facts.tracked) r.push('file is not committed (untracked)');
  else {
    if (!facts.clean) r.push('file has uncommitted changes');
    if (facts.headSha256 !== facts.sha256) r.push(`file hash ${facts.sha256} differs from the committed one ${facts.headSha256}`);
    if (!facts.commit) r.push('no commit found for the file');
  }
  forbiddenStatements(facts.content).forEach((w) => r.push(`migration contains ${w}`));
  if (target !== 'local') (facts.gateFailures || []).forEach((w) => r.push(w));
  const approval = (env.NEARBY_PROD_APPROVAL || '').trim();
  if (!approval) r.push(`missing approval: set NEARBY_PROD_APPROVAL=${approvalToken(facts)} (the owner's approval of this version + hash)`);
  else if (approval !== approvalToken(facts)) r.push(`approval "${approval}" does not match this migration (${approvalToken(facts)})`);
  if (!(env.NEARBY_APPROVAL_REF || '').trim()) r.push('missing NEARBY_APPROVAL_REF (where/when the owner approved it)');
  if (!(env.NEARBY_SESSION_ID || '').trim()) r.push('missing NEARBY_SESSION_ID (the deploying session)');
  if (facts.version) {
    if (!ledger.exists) {
      if (facts.version !== LEDGER_MIGRATION) r.push(`the ledger does not exist yet: deploy ${LEDGER_MIGRATION} first`);
    } else {
      const have = ledger.rows.find((x) => x.version === facts.version);
      if (have) r.push(`already recorded (${have.record_kind}, applied ${have.applied_at || 'n/a'}): never re-applied`);
      if (facts.version <= BASELINE_MAX) r.push(`version ${facts.version} is covered by the pre-ledger baseline (<= ${BASELINE_MAX})`);
      const later = ledger.rows.filter((x) => /^\d{8}$/.test(x.version) && x.version > facts.version).map((x) => x.version);
      if (later.length) r.push(`out of order: later version(s) already recorded: ${later.join(', ')}`);
    }
  }
  return r;
}

function ledgerInsertSql(facts, env) {
  return `insert into private.migration_ledger (version, record_kind, file_sha256, git_commit, applied_at, approval_ref, session_id)
values (${lit(facts.version)}, 'deployed', ${lit(facts.sha256)}, ${lit(facts.commit)}, now(), ${lit(env.NEARBY_APPROVAL_REF.trim())}, ${lit(env.NEARBY_SESSION_ID.trim())});`;
}

// The ONE apply: migration + ledger row inside one explicit transaction. The row goes last, so a duplicate (primary key)
// or any error anywhere aborts the whole thing, DDL included; an interruption before COMMIT leaves nothing.
function deploySql(facts, env) {
  return `begin;\n${facts.content}\n;\n${ledgerInsertSql(facts, env)}\ncommit;\n`;
}

// Verification mode: the same statements, always rolled back (raise at the end, like the journeys), never committed.
const DRY_RUN_MARK = 'NEARBY_DRY_RUN_OK';
function dryRunSql(facts, env) {
  return `begin;\n${facts.content}\n;\n${ledgerInsertSql(facts, env)}\ndo $nearby_dry$ begin raise exception '${DRY_RUN_MARK}'; end $nearby_dry$;\n`;
}

// Status reads: each one single SELECT, nothing else (status.js sends only these).
const LEDGER_EXISTS_SQL = `select to_regclass('private.migration_ledger') is not null as exists`;
const LEDGER_ROWS_SQL = `select coalesce(json_agg(json_build_object('version', version, 'record_kind', record_kind,
  'file_sha256', file_sha256, 'git_commit', git_commit, 'applied_at', applied_at, 'approval_ref', approval_ref,
  'session_id', session_id) order by version), '[]'::json) as rows from private.migration_ledger`;

// Repo files vs the ledger, per version.
function statusReport(repoFiles, ledger) {
  const byVersion = new Map((ledger.rows || []).map((x) => [x.version, x]));
  return repoFiles.map(({ version, rel, sha256: fileSha }) => {
    if (!ledger.exists) return { version, rel, state: version <= BASELINE_MAX ? 'pre-ledger (no ledger yet)' : 'unknown (no ledger yet)' };
    const row = byVersion.get(version);
    if (row) return { version, rel, state: row.file_sha256 === fileSha ? `recorded (${row.record_kind})` : `HASH MISMATCH (ledger ${row.file_sha256}, file ${fileSha})`, applied_at: row.applied_at };
    if (version <= BASELINE_MAX && byVersion.has('pre-ledger')) return { version, rel, state: 'pre-ledger (baseline)' };
    return { version, rel, state: 'NOT RECORDED' };
  });
}

function repoMigrations(repoRoot) {
  const dir = path.join(repoRoot, MIGRATIONS_DIR);
  return fs.readdirSync(dir).filter((f) => /^\d{8}_.*\.sql$/.test(f)).sort().map((f) => ({
    version: f.slice(0, 8), rel: `${MIGRATIONS_DIR}/${f}`, sha256: sha256(fs.readFileSync(path.join(dir, f))),
  }));
}

// Targets. 'prod' = the Management API (scripts/live-verify/lib/db.js); 'local' = a disposable database by URL, refused if it
// looks like a hosted Supabase address. Every query goes over one connection per call, like the Management API.
function runner(target) {
  if (target === 'prod') {
    const url = process.env.NEARBY_LOCAL_DB_URL;
    if (url) throw new Error('NEARBY_LOCAL_DB_URL is set: refusing --target=prod (unset it to make the target unambiguous)');
    const { runSql } = require('../live-verify/lib/db');
    return { name: 'production (Management API)', run: (sql) => runSql(sql) };
  }
  if (target === 'local') {
    const url = process.env.NEARBY_LOCAL_DB_URL;
    if (!url) throw new Error('--target=local needs NEARBY_LOCAL_DB_URL (a disposable database)');
    if (/supabase\.(co|com)/i.test(url)) throw new Error('NEARBY_LOCAL_DB_URL points at a hosted Supabase address: refused');
    const { Client } = require(process.env.NEARBY_PG_MODULE || 'pg');
    return {
      name: `local (${url.replace(/\/\/[^@]*@/, '//')})`,
      run: async (sql) => {
        const client = new Client({ connectionString: url });
        await client.connect();
        try {
          const res = await client.query(sql);
          const list = Array.isArray(res) ? res : [res];
          return list[list.length - 1].rows || [];
        } finally { await client.end(); }
      },
    };
  }
  throw new Error('--target=prod or --target=local is required');
}

async function readLedger(run) {
  const [{ exists }] = await run(LEDGER_EXISTS_SQL);
  if (!exists) return { exists: false, rows: [] };
  const [{ rows }] = await run(LEDGER_ROWS_SQL);
  return { exists: true, rows: typeof rows === 'string' ? JSON.parse(rows) : rows };
}

module.exports = {
  PREDEPLOY_GATES, predeployGateFailures,
  LEDGER_MIGRATION, BASELINE_MAX, DRY_RUN_MARK, LEDGER_EXISTS_SQL, LEDGER_ROWS_SQL,
  migrationFacts, forbiddenStatements, approvalToken, preflight, deploySql, dryRunSql, statusReport, repoMigrations, runner, readLedger,
};
