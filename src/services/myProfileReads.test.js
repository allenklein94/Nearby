// Trust & safety N6 (owner, 2026-10-28): the app reads profiles directly ONLY for public columns (the column grant in
// 20270348); its own private columns come through readMyProfile (get_my_profile), other people's profile details through
// people_visible_to_me / dating_candidates_visible_to_me. A direct profiles read naming a private column, select('*'), or a
// column list the guard can't see would fail for every signed-in user once 20270348 is live.
const fs = require('fs');
const path = require('path');
const { PUBLIC_PROFILE_COLUMNS, LATER_PUBLIC_PROFILE_COLUMNS } = require('../constants/publicProfileColumns');

const SRC = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['journeys', 'qa', 'i18n']);
// The one place allowed a variable column list on profiles: readMyProfile's fallback while 20270348 is not live.
const ALLOWED_VARIABLE = new Set(['services/myProfile.js']);
// Old-path reads that run ONLY when the server says the N6 function is missing (20270348 not live): after it they never run.
const LEGACY_FALLBACK = new Set(['services/preferencePolls.js']);

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return SKIP_DIRS.has(e.name) || e.name === 'node_modules' ? [] : files(p);
    return /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : [];
  });
}

// "a, b, rel:profiles!fk(c, d)" -> top-level column names only (embeds are checked separately).
function topLevelColumns(list) {
  let depth = 0; let cur = ''; const out = [];
  for (const ch of list) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim()).filter(Boolean).filter((c) => !c.includes('(')).map((c) => c.split(':').pop().trim());
}

const lineOf = (text, i) => text.slice(0, i).split('\n').length;
const isPublic = (c) => PUBLIC_PROFILE_COLUMNS.includes(c) || c in LATER_PUBLIC_PROFILE_COLUMNS;

function violations() {
  const out = [];
  for (const file of files(SRC)) {
    const rel = path.relative(SRC, file).split(path.sep).join('/');
    const text = fs.readFileSync(file, 'utf8');
    // 1. direct reads: from('profiles') ... .select(<arg>) before the statement ends
    for (const m of text.matchAll(/from\(\s*['"]profiles['"]\s*\)/g)) {
      const rest = text.slice(m.index, m.index + 600);
      const stmt = rest.split(/;\s*\n/)[0];
      const sel = /\.select\(\s*(['"`])([^'"`]*)\1\s*[,)]/.exec(stmt);
      const anySelect = /\.select\(/.exec(stmt);
      if (!anySelect) continue; // update / insert / delete without a read
      if (!sel) {
        if (!ALLOWED_VARIABLE.has(rel)) out.push(`${rel}:${lineOf(text, m.index)} profiles read with a column list the guard can't check`);
        continue;
      }
      if (sel[1] === '`' && sel[2].includes('${')) {
        out.push(`${rel}:${lineOf(text, m.index)} profiles read with a computed column list`);
        continue;
      }
      const cols = topLevelColumns(sel[2]);
      if (LEGACY_FALLBACK.has(rel) && /isMissingFunction\(/.test(text.slice(Math.max(0, m.index - 300), m.index))) continue;
      for (const c of cols) if (c === '*' || !isPublic(c)) out.push(`${rel}:${lineOf(text, m.index)} profiles read names private column "${c}"`);
    }
    // 2. embedded profiles in any select: profiles(...), alias:profiles!fk(...)
    for (const m of text.matchAll(/profiles(?:![a-z_]+)?\(([^()]*)\)/g)) {
      for (const c of topLevelColumns(m[1])) if (c === '*' || !isPublic(c)) out.push(`${rel}:${lineOf(text, m.index)} embedded profiles names private column "${c}"`);
    }
  }
  return out;
}

describe('N6: profile reads name only public columns', () => {
  test('no direct or embedded profiles read names a private column', () => {
    expect(violations()).toEqual([]);
  });

  test('the guard really catches a private read (self-check)', () => {
    expect(topLevelColumns('id, birthdate, host:profiles!x(display_name)')).toEqual(['id', 'birthdate']);
    expect(isPublic('birthdate')).toBe(false);
    expect(isPublic('display_name')).toBe(true);
  });

  test('the public list matches the migration grant exactly', () => {
    const sql = fs.readFileSync(path.join(SRC, '..', 'supabase', 'migrations', '20270348_profile_column_privacy.sql'), 'utf8');
    const grant = /grant select \(([^)]*)\)\s*on public\.profiles to authenticated/.exec(sql);
    expect(grant).not.toBeNull();
    const granted = grant[1].split(',').map((c) => c.trim()).sort();
    expect(granted).toEqual([...PUBLIC_PROFILE_COLUMNS].sort());
  });

  test('each later public column is granted by the migration that adds it', () => {
    for (const [col, file] of Object.entries(LATER_PUBLIC_PROFILE_COLUMNS)) {
      const sql = fs.readFileSync(path.join(SRC, '..', 'supabase', 'migrations', file), 'utf8');
      expect([col, new RegExp(`grant select \\(${col}\\) on public\\.profiles to authenticated`).test(sql)]).toEqual([col, true]);
    }
  });

  // An upsert (INSERT ... ON CONFLICT DO UPDATE) needs SELECT on every column it sets: refused after 20270348 for private
  // columns (the sign-up write broke this way). Own-row first writes go through saveMyNewProfile (insert, then update).
  test('no upsert on profiles anywhere in the app', () => {
    const hits = files(SRC).flatMap((f) => {
      const text = fs.readFileSync(f, 'utf8');
      const re = /from\(\s*['"`]profiles['"`]\s*\)\s*\.upsert\(/g;
      const found = [];
      let m;
      while ((m = re.exec(text))) found.push(`${path.relative(SRC, f)}:${lineOf(text, m.index)}`);
      return found;
    });
    expect(hits).toEqual([]);
  });

  // A later migration must never reopen what 20270348 closed: no table-wide SELECT on profiles, no grant on a private
  // column, no new view or publication over profiles. (The database-level check is journey profileColumnPrivacy.)
  test('no migration from 20270348 on reopens private profile columns', () => {
    const dir = path.join(SRC, '..', 'supabase', 'migrations');
    const OWN_VIEWS = new Set(['people_visible_to_me', 'dating_candidates_visible_to_me']);
    const problems = [];
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sql') && n >= '20270348').sort()) {
      const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/--[^\n]*/g, '');
      for (const m of sql.matchAll(/grant\s+([^;]*?)\s+on\s+(?:table\s+)?(?:public\.)?profiles\s+to\s+([^;]*);/gi)) {
        const [, what, who] = m;
        if (!/\b(authenticated|anon|public)\b/i.test(who)) continue;
        if (/^\s*(all|select)\s*(privileges)?\s*$/i.test(what) || /\ball\b/i.test(what)) problems.push(`${f}: table-wide ${what.trim()} to ${who.trim()}`);
        const cols = /select\s*\(([^)]*)\)/i.exec(what);
        if (cols) for (const c of cols[1].split(',').map((x) => x.trim())) if (!isPublic(c)) problems.push(`${f}: private column ${c} granted`);
      }
      for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:public\.)?([a-z_]+)([\s\S]*?);/gi)) {
        if (/\bprofiles\b/i.test(m[2]) && !OWN_VIEWS.has(m[1])) problems.push(`${f}: new view ${m[1]} over profiles`);
      }
      if (/alter\s+publication[^;]*\bprofiles\b/i.test(sql)) problems.push(`${f}: profiles added to a publication`);
      if (/alter\s+default\s+privileges[^;]*grant[^;]*select/i.test(sql)) problems.push(`${f}: default SELECT privileges`);
    }
    expect(problems).toEqual([]);
  });
});
