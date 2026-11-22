// One disabled look for primary actions (owner, 2026-11-21): a coral button that can be disabled shows the shared grey
// (disabledButtonStyle) whenever its `disabled` condition holds, never a faded coral and never no change at all.
import fs from 'fs';
import path from 'path';
import { disabledButtonStyle } from './buttonStates';

const root = path.join(__dirname, '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const sources = walk(root).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

// chips are selections, not actions: their "selected" coral is not a primary button
const NOT_ACTIONS = new Set(['chipSelected']);

function primaryStyleNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/\n\s+(\w+):\s*\{([^{}]*)\}/g)) if (/backgroundColor:\s*colors\.primary\b/.test(m[2])) names.add(m[1]);
  return names;
}

function braced(s, i) { // s[i] === '{' -> the text inside the matching braces
  let d = 0;
  for (let k = i; k < s.length; k += 1) {
    if (s[k] === '{') d += 1; else if (s[k] === '}') { d -= 1; if (d === 0) return s.slice(i + 1, k); }
  }
  return '';
}

function buttonTags(src) {
  const tags = [];
  for (const m of src.matchAll(/<(TouchableOpacity|Pressable|ScaleButton)\b/g)) {
    let k = m.index + m[0].length; let d = 0;
    while (k < src.length && !(src[k] === '>' && d === 0)) { if (src[k] === '{') d += 1; else if (src[k] === '}') d -= 1; k += 1; }
    tags.push({ tag: src.slice(m.index, k), line: src.slice(0, m.index).split('\n').length });
  }
  return tags;
}

test('the shared look is a muted grey, never the primary colour', () => {
  const colors = { primary: '#FF6B5B', textTertiary: '#A69B92' };
  const s = disabledButtonStyle(colors);
  expect(s.backgroundColor).toBe('#A69B92');
  expect(s.backgroundColor).not.toBe(colors.primary);
  expect(s.opacity).toBeLessThan(1);
});

test('every coral button with a disabled condition shows the shared disabled look', () => {
  const offenders = [];
  let checked = 0;
  for (const f of sources) {
    const src = fs.readFileSync(f, 'utf8');
    const primary = primaryStyleNames(src);
    if (!primary.size) continue;
    for (const { tag, line } of buttonTags(src)) {
      const di = tag.indexOf('disabled={'); const si = tag.indexOf('style={');
      if (di < 0 || si < 0) continue;
      const disabledExpr = braced(tag, di + 9).trim();
      if (disabledExpr === 'true' || disabledExpr === 'false') continue;
      const style = braced(tag, si + 6);
      const used = [...style.matchAll(/styles\.(\w+)/g)].map((x) => x[1]).filter((n) => primary.has(n) && !NOT_ACTIONS.has(n));
      if (!used.length) continue;
      if (/BusinessPartnerApplyScreen/.test(f) && /styles\.chip\b/.test(style)) continue; // locked checklist chip
      checked += 1;
      if (!/disabledButtonStyle\(colors\)/.test(style) || /opacity: 0\.\d/.test(style)) offenders.push(`${path.relative(root, f)}:${line}`);
    }
  }
  expect(offenders).toEqual([]);
  expect(checked).toBeGreaterThanOrEqual(110);
});
