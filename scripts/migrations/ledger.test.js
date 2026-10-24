// Migration deployment safeguards (owner, 2026-10-24): every refusal, proven on a throwaway git repo, no database.
// The database half (atomic apply, interrupted / failed / duplicate deploys, read-only status) is
// scripts/migrations/disposable-db-test.js against a disposable Postgres.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('./ledger');

function tempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nearby-ledger-'));
  const g = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
  g('init', '-q'); g('config', 'user.email', 't@t.invalid'); g('config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true });
  const write = (name, sql) => fs.writeFileSync(path.join(dir, 'supabase/migrations', name), sql);
  const commit = () => { g('add', '-A'); g('commit', '-qm', 'x'); };
  return { dir, write, commit };
}

const FILE = 'supabase/migrations/20270346_example.sql';
const okLedger = { exists: true, rows: [{ version: 'pre-ledger', record_kind: 'baseline' }, { version: '20270345', record_kind: 'deployed' }] };
const envFor = (facts, extra = {}) => ({ NEARBY_PROD_APPROVAL: L.approvalToken(facts), NEARBY_APPROVAL_REF: 'owner, test', NEARBY_SESSION_ID: 's1', ...extra });

describe('deploy preflight', () => {
  let repo;
  beforeEach(() => { repo = tempRepo(); repo.write('20270346_example.sql', 'create table public.t1 (id int);\n'); repo.commit(); });

  test('a committed, approved, unrecorded migration passes', () => {
    const facts = L.migrationFacts(FILE, repo.dir);
    expect(facts).toMatchObject({ version: '20270346', tracked: true, clean: true });
    expect(facts.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(L.preflight({ facts, env: envFor(facts), ledger: okLedger })).toEqual([]);
  });

  test('missing approval, generic approval, other version, other hash: all refused', () => {
    const facts = L.migrationFacts(FILE, repo.dir);
    const refuse = (approval) => L.preflight({ facts, env: envFor(facts, { NEARBY_PROD_APPROVAL: approval }), ledger: okLedger });
    expect(refuse('').join()).toMatch(/missing approval/);
    for (const generic of ['true', 'yes', '1', '20270346']) expect(refuse(generic).join()).toMatch(/does not match/);
    expect(refuse(`20270347:${facts.sha256}`).join()).toMatch(/does not match/);
    expect(refuse(`20270346:${'0'.repeat(64)}`).join()).toMatch(/does not match/);
    expect(L.preflight({ facts, env: envFor(facts, { NEARBY_APPROVAL_REF: ' ' }), ledger: okLedger }).join()).toMatch(/NEARBY_APPROVAL_REF/);
    expect(L.preflight({ facts, env: envFor(facts, { NEARBY_SESSION_ID: '' }), ledger: okLedger }).join()).toMatch(/NEARBY_SESSION_ID/);
  });

  test('an uncommitted edit is refused, and the approval for the committed hash no longer matches', () => {
    const committed = L.migrationFacts(FILE, repo.dir);
    repo.write('20270346_example.sql', 'create table public.t1 (id int, extra int);\n');
    const facts = L.migrationFacts(FILE, repo.dir);
    const r = L.preflight({ facts, env: envFor(committed), ledger: okLedger }).join('\n');
    expect(r).toMatch(/uncommitted changes/);
    expect(r).toMatch(/differs from the committed one/);
    expect(r).toMatch(/does not match/);
  });

  test('an untracked file is refused', () => {
    repo.write('20270347_new.sql', 'select 1;\n');
    const facts = L.migrationFacts('supabase/migrations/20270347_new.sql', repo.dir);
    expect(L.preflight({ facts, env: envFor(facts), ledger: okLedger }).join()).toMatch(/not committed/);
  });

  test('already recorded (deployed or historical), baseline-covered, out of order, no ledger: refused', () => {
    const facts = L.migrationFacts(FILE, repo.dir);
    const env = envFor(facts);
    const withRow = (row) => ({ exists: true, rows: [...okLedger.rows, row] });
    expect(L.preflight({ facts, env, ledger: withRow({ version: '20270346', record_kind: 'deployed' }) }).join()).toMatch(/already recorded/);
    expect(L.preflight({ facts, env, ledger: withRow({ version: '20270346', record_kind: 'historical' }) }).join()).toMatch(/already recorded \(historical/);
    expect(L.preflight({ facts, env, ledger: withRow({ version: '20270350', record_kind: 'deployed' }) }).join()).toMatch(/out of order.*20270350/);
    expect(L.preflight({ facts, env, ledger: { exists: false, rows: [] } }).join()).toMatch(/deploy 20270345 first/);
    repo.write('20270340_old.sql', 'select 1;\n'); repo.commit();
    const old = L.migrationFacts('supabase/migrations/20270340_old.sql', repo.dir);
    expect(L.preflight({ facts: old, env: envFor(old), ledger: okLedger }).join()).toMatch(/pre-ledger baseline/);
  });

  test('the ledger migration itself is the one version deployable before the ledger exists', () => {
    repo.write('20270345_migration_ledger.sql', 'create table private.migration_ledger (version text);\n'); repo.commit();
    const facts = L.migrationFacts('supabase/migrations/20270345_migration_ledger.sql', repo.dir);
    expect(L.preflight({ facts, env: envFor(facts), ledger: { exists: false, rows: [] } })).toEqual([]);
  });

  test('a file outside supabase/migrations or misnamed is refused', () => {
    fs.writeFileSync(path.join(repo.dir, 'x.sql'), 'select 1;\n'); repo.commit();
    const facts = L.migrationFacts('x.sql', repo.dir);
    expect(L.preflight({ facts, env: envFor(facts), ledger: okLedger }).join()).toMatch(/not a migration file/);
  });
});

describe('single-transaction guarantee', () => {
  test('own transaction control and non-transactional statements are refused; plpgsql begin/end and comments are fine', () => {
    expect(L.forbiddenStatements('begin;\ncreate table a();\ncommit;')).toEqual(expect.arrayContaining(['own transaction control (BEGIN)', 'own transaction control (COMMIT)']));
    expect(L.forbiddenStatements('rollback;')).toEqual(['own transaction control (ROLLBACK)']);
    expect(L.forbiddenStatements('create index concurrently i on t (a);').join()).toMatch(/CONCURRENTLY/);
    expect(L.forbiddenStatements('vacuum t;').join()).toMatch(/VACUUM/);
    const plpgsql = `create function f() returns void language plpgsql as $$\nbegin\n  perform 1;\nend;\n$$;\n-- begin;\n/* commit; */`;
    expect(L.forbiddenStatements(plpgsql)).toEqual([]);
  });

  test('every committed migration from the ledger on passes the check', () => {
    const repoRoot = path.resolve(__dirname, '../..');
    for (const m of L.repoMigrations(repoRoot).filter((x) => x.version >= L.LEDGER_MIGRATION)) {
      expect([m.rel, L.forbiddenStatements(fs.readFileSync(path.join(repoRoot, m.rel), 'utf8'))]).toEqual([m.rel, []]);
    }
  });

  test('deploy = one explicit transaction, migration first, ledger row last, then COMMIT; dry run never commits', () => {
    const facts = { version: '20270346', sha256: 'a'.repeat(64), commit: 'b'.repeat(40), content: 'create table public.t1 (id int);' };
    const env = { NEARBY_APPROVAL_REF: "owner's ok", NEARBY_SESSION_ID: 's1' };
    const sql = L.deploySql(facts, env);
    expect(sql.startsWith('begin;\n')).toBe(true);
    expect(sql.trimEnd().endsWith('commit;')).toBe(true);
    expect(sql.indexOf('create table public.t1')).toBeLessThan(sql.indexOf('insert into private.migration_ledger'));
    expect(sql).toContain("'owner''s ok'");
    const dry = L.dryRunSql(facts, env);
    expect(dry).not.toMatch(/\bcommit;/);
    expect(dry.trimEnd()).toMatch(new RegExp(`raise exception '${L.DRY_RUN_MARK}'; end \\$nearby_dry\\$;$`));
  });
});

describe('status is read-only', () => {
  test('status sends only two single SELECT statements', () => {
    for (const q of [L.LEDGER_EXISTS_SQL, L.LEDGER_ROWS_SQL]) {
      expect(q.trim()).toMatch(/^select\b/i);
      expect(q).not.toMatch(/;/);
      expect(q).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/i);
    }
    const src = fs.readFileSync(path.join(__dirname, 'status.js'), 'utf8');
    expect(src).not.toMatch(/deploySql|dryRunSql|run\(\s*['`]/);
  });

  test('report: recorded, hash mismatch, baseline, not recorded, no ledger', () => {
    const files = [
      { version: '20270343', rel: 'a', sha256: 'x' }, { version: '20270344', rel: 'b', sha256: 'h44' },
      { version: '20270345', rel: 'c', sha256: 'h45' }, { version: '20270346', rel: 'd', sha256: 'h46' },
    ];
    const ledger = { exists: true, rows: [{ version: 'pre-ledger', record_kind: 'baseline' },
      { version: '20270344', record_kind: 'historical', file_sha256: 'h44' }, { version: '20270345', record_kind: 'deployed', file_sha256: 'other' }] };
    expect(L.statusReport(files, ledger).map((r) => r.state)).toEqual(['pre-ledger (baseline)', 'recorded (historical)', 'HASH MISMATCH (ledger other, file h45)', 'NOT RECORDED']);
    expect(L.statusReport(files, { exists: false, rows: [] }).map((r) => r.state)[3]).toBe('unknown (no ledger yet)');
  });
});

describe('targets', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  test('no target, a hosted URL as local, or prod with a local URL set: refused', () => {
    expect(() => L.runner(undefined)).toThrow(/--target=prod or --target=local/);
    process.env.NEARBY_LOCAL_DB_URL = 'postgres://u:p@db.enmosvippabmuqslzrox.supabase.co:5432/postgres';
    expect(() => L.runner('local')).toThrow(/hosted Supabase/);
    expect(() => L.runner('prod')).toThrow(/refusing --target=prod/);
  });
});

describe('20270345 ledger migration', () => {
  const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/migrations/20270345_migration_ledger.sql'), 'utf8');
  test('no client grant, append-only, backfills 20270344 as HISTORICAL with its committed hash and commit', () => {
    expect(sql).toMatch(/revoke all on table private\.migration_ledger from public, anon, authenticated;/);
    expect(sql.replace(/--[^\n]*/g, '')).not.toMatch(/\bgrant\b/i);
    expect(sql).toMatch(/before update or delete on private\.migration_ledger/);
    expect(sql).toMatch(/before truncate on private\.migration_ledger/);
    const m = /'20270344', 'historical',\s*'([0-9a-f]{64})',\s*'([0-9a-f]{40})'/.exec(sql);
    expect(m).not.toBeNull();
    const repoRoot = path.resolve(__dirname, '../..');
    const f = L.migrationFacts('supabase/migrations/20270344_request_deadlines_follow_gathering.sql', repoRoot);
    expect(m[1]).toBe(f.sha256);
    expect(m[2]).toBe('bf0cbb3e28ee0fc61e2f87a6e8a64885eb80f16c');
    expect(sql).toMatch(/HISTORICAL RECORD, not applied by deploy\.js/);
    expect(sql).not.toMatch(/'20270345'/); // its own row is written by deploy.js, never by the file
  });
});
