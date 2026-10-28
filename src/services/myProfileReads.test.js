// Trust & safety N6 (owner, 2026-10-28): the app reads profiles directly ONLY for public columns (the column grant in
// 20270348); its own private columns come through readMyProfile (get_my_profile), other people's profile details through
// people_visible_to_me / dating_candidates_visible_to_me. A direct profiles read naming a private column, select('*'), or a
// column list the guard can't see would fail for every signed-in user once 20270348 is live.
const fs = require('fs');
const path = require('path');
const { PUBLIC_PROFILE_COLUMNS } = require('../constants/publicProfileColumns');

const SRC = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['journeys', 'qa', 'i18n']);
// The one place allowed a variable column list on profiles: readMyProfile's fallback while 20270348 is not live.
const ALLOWED_VARIABLE = new Set(['services/myProfile.js']);

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
const isPublic = (c) => PUBLIC_PROFILE_COLUMNS.includes(c);

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
});
