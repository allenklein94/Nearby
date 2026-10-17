// Item 146 (owner, 2026-10-17): a gathering's precise point is not client-readable. Migration 20270320 replaced the table-wide
// SELECT on gatherings with a column list (every column except precise_lat/lng); the database refuses the rest (journey
// `preciseLocation` proves it per role). This guard keeps the client and future migrations in line with that:
//   1. every client read of gatherings names its columns (no `*`, no bare `.select()`), never the point, and only columns the
//      grant covers (an ungranted column would be refused at run time);
//   2. no embed reads `gatherings(*)`; the point appears in client code only where the host's create writes it;
//   3. FORWARD RULE: column grants never cover columns added later, so a migration adding a gatherings column must grant
//      SELECT on it in the same file (or the app's reads of it fail) - unless it is a private column like the point.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const GRANT_MIGRATION = '20270320_gathering_precise_location_security.sql';
const PRIVATE_COLUMNS = ['precise_lat', 'precise_lng'];

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'journeys') walk(p, out); } else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name)) out.push(p);
  }
  return out;
}
const sources = walk(ROOT).map((f) => ({ f: path.relative(ROOT, f), src: fs.readFileSync(f, 'utf8') }));

function grantedColumns() {
  const sql = fs.readFileSync(path.join(MIGRATIONS, GRANT_MIGRATION), 'utf8');
  const m = /grant select \(([^)]*)\) on public\.gatherings to anon, authenticated;/.exec(sql);
  return m ? m[1].split(',').map((c) => c.trim()).filter(Boolean) : [];
}

// Top-level column names of a PostgREST select string (embeds like `host:profiles!fk(a, b)` are skipped).
function topLevelColumns(select) {
  const out = [];
  let depth = 0; let cur = '';
  for (const ch of select) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((c) => !c.includes('(')).map((c) => c.split(':').pop().trim());
}

// Resolve a select(...) argument to its string: a literal, a template with ${CONST}, or a CONST declared in the file.
function resolve(arg, src) {
  const a = arg.trim();
  if (a === '') return null;
  const lit = /^(['"`])([\s\S]*)\1/.exec(a);
  const body = lit ? lit[2] : (() => {
    const name = /^([A-Z_][A-Z0-9_]*)/.exec(a)?.[1];
    const decl = name && new RegExp(`const ${name} = (['"\`])([\\s\\S]*?)\\1;`).exec(src);
    return decl ? decl[2] : undefined;
  })();
  if (body === undefined) return undefined;
  return body.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, n) => resolve(n, src) ?? '');
}

// Every `.select(...)` chained onto a `.from('gatherings')` (up to the next `.from(` or statement end).
function gatheringSelects() {
  const found = [];
  for (const { f, src } of sources) {
    const re = /\.from\('gatherings'\)/g;
    let m;
    while ((m = re.exec(src))) {
      const rest = src.slice(m.index + m[0].length);
      const end = rest.search(/\.from\(|;\s*\n/);
      const chain = end === -1 ? rest : rest.slice(0, end);
      const at = chain.indexOf('.select(');
      if (at === -1) continue;
      let depth = 0; let i = at + '.select'.length;
      for (; i < chain.length; i += 1) {
        if (chain[i] === '(') depth += 1;
        if (chain[i] === ')') { depth -= 1; if (depth === 0) break; }
      }
      const arg = chain.slice(at + '.select('.length, i).split(/,\s*\{/)[0]; // drop options like { count, head }
      found.push({ f, arg, text: resolve(arg, src) });
    }
  }
  return found;
}

// Columns a migration adds to gatherings, and those it grants SELECT on.
function addedGatheringColumns(sql) {
  const cols = [];
  const stmts = sql.match(/alter table (?:if exists )?(?:only )?(?:public\.)?gatherings\b[^;]*;/gi) ?? [];
  for (const s of stmts) for (const m of s.matchAll(/add column (?:if not exists )?"?(\w+)"?/gi)) cols.push(m[1]);
  return cols;
}
function grantedGatheringColumns(sql) {
  const cols = [];
  for (const m of sql.matchAll(/grant select\s*\(([^)]*)\)\s*on (?:table )?(?:public\.)?gatherings\b/gi)) {
    cols.push(...m[1].split(',').map((c) => c.trim().replace(/"/g, '')));
  }
  return cols;
}
function ungrantedNewColumns(sql) {
  const granted = grantedGatheringColumns(sql);
  return addedGatheringColumns(sql).filter((c) => !PRIVATE_COLUMNS.includes(c) && !granted.includes(c));
}

describe('item 146: precise gathering location is not client-readable', () => {
  const granted = grantedColumns();

  test('the migration grants a column list without the point', () => {
    expect(granted.length).toBeGreaterThan(40);
    for (const c of PRIVATE_COLUMNS) expect(granted).not.toContain(c);
  });

  test('every client read of gatherings names its columns: no `*`, no bare select(), never the point, only granted columns', () => {
    const selects = gatheringSelects();
    expect(selects.length).toBeGreaterThan(20);
    for (const s of selects) {
      expect({ f: s.f, arg: s.arg, resolved: s.text !== undefined && s.text !== null }).toEqual({ f: s.f, arg: s.arg, resolved: true });
      expect({ f: s.f, star: s.text.includes('*') }).toEqual({ f: s.f, star: false });
      expect({ f: s.f, point: /precise_l(at|ng)/.test(s.text) }).toEqual({ f: s.f, point: false });
      for (const c of topLevelColumns(s.text)) expect({ f: s.f, c, granted: granted.includes(c) }).toEqual({ f: s.f, c, granted: true });
    }
  });

  test('createGathering returns named columns, never `*`', () => {
    const src = sources.find((s) => s.f === path.join('services', 'gatherings.js')).src;
    expect(src).toMatch(/\.select\(SAFE_GATHERING_FIELDS\)\s*\n\s*\.single\(\);/);
  });

  test('no embed reads gatherings(*); the point appears in client code only where the host writes it', () => {
    for (const { f, src } of sources) {
      expect({ f, embedStar: /gatherings(![\w]+)?\(\s*\*/.test(src) }).toEqual({ f, embedStar: false });
      const uses = src.split('\n').filter((l) => /precise_l(at|ng)/.test(l) && !/^\s*\/\//.test(l));
      const allowed = (l) => /^\s*precise_lat: lat,$/.test(l) || /^\s*precise_lng: lng,$/.test(l);
      expect({ f, uses: uses.filter((l) => !allowed(l)) }).toEqual({ f, uses: [] });
    }
  });

  test('forward rule: every migration after 20270320 that adds a gatherings column grants SELECT on it', () => {
    const later = fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql') && n > GRANT_MIGRATION).sort();
    for (const n of later) {
      expect({ n, ungranted: ungrantedNewColumns(fs.readFileSync(path.join(MIGRATIONS, n), 'utf8')) }).toEqual({ n, ungranted: [] });
    }
  });

  test('the forward rule catches a missing grant (and accepts a granted or private column)', () => {
    expect(ungrantedNewColumns('alter table public.gatherings add column if not exists vibe text;')).toEqual(['vibe']);
    expect(ungrantedNewColumns('alter table public.gatherings add column vibe text;\ngrant select (vibe) on public.gatherings to anon, authenticated;')).toEqual([]);
    expect(ungrantedNewColumns('alter table gatherings add column a int, add column b int;\ngrant select (a) on gatherings to anon, authenticated;')).toEqual(['b']);
    expect(ungrantedNewColumns('alter table public.gatherings add column precise_lat double precision;')).toEqual([]);
    expect(ungrantedNewColumns('alter table public.gathering_interest add column x int;')).toEqual([]);
  });
});
