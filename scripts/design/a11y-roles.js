#!/usr/bin/env node
// Item 34 (owner, 2026-11-27): every tappable control tells a screen reader it is a button. JSX-aware (Babel AST), so
// arrow functions inside props never confuse it. `node scripts/design/a11y-roles.js` = report only; `--write` adds
// accessibilityRole="button" right after the tag name where none is set. Never touched: an element with a spread
// ({...props}: the caller decides), accessible={false}, or a backdrop (activeOpacity={1} with no accessibilityLabel).
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const ROOT = path.join(__dirname, '..', '..', 'src');
const TAGS = new Set(['TouchableOpacity', 'Pressable', 'TouchableHighlight', 'ScaleButton']);
const write = process.argv.includes('--write');
const list = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? list(path.join(d, e.name)) : (e.name.endsWith('.js') && !e.name.endsWith('.test.js') ? [path.join(d, e.name)] : []));
const files = ['screens', 'components', 'navigation', 'motion'].filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap(list).concat(fs.readdirSync(ROOT).filter((f) => /^App.*\.js$/.test(f)));
const res = { added: 0, files: 0, skippedSpread: [], skippedBackdrop: [], skippedNotAccessible: 0, already: 0 };
for (const f of files) {
  const full = path.join(ROOT, f);
  const src = fs.readFileSync(full, 'utf8');
  if (!/<(TouchableOpacity|Pressable|TouchableHighlight|ScaleButton)\b/.test(src)) continue;
  let ast;
  try { ast = parse(src, { sourceType: 'module', plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'] }); } catch (e) { console.error(`parse failed ${f}: ${e.message}`); process.exitCode = 1; continue; }
  const inserts = [];
  traverse(ast, {
    JSXOpeningElement(p) {
      const n = p.node.name;
      if (n.type !== 'JSXIdentifier' || !TAGS.has(n.name)) return;
      const attrs = p.node.attributes;
      const named = (k) => attrs.find((a) => a.type === 'JSXAttribute' && a.name.name === k);
      if (named('accessibilityRole') || named('role')) { res.already++; return; }
      const acc = named('accessible');
      if (acc && acc.value?.expression?.value === false) { res.skippedNotAccessible++; return; }
      if (attrs.some((a) => a.type === 'JSXSpreadAttribute')) { res.skippedSpread.push(`${f}:${p.node.loc.start.line}`); return; }
      const ao = named('activeOpacity');
      if (ao && ao.value?.expression?.value === 1 && !named('accessibilityLabel')) { res.skippedBackdrop.push(`${f}:${p.node.loc.start.line}`); return; }
      inserts.push(n.end);
    },
  });
  if (!inserts.length) continue;
  res.added += inserts.length; res.files++;
  if (write) {
    let out = src;
    for (const at of inserts.sort((a, b) => b - a)) out = `${out.slice(0, at)} accessibilityRole="button"${out.slice(at)}`;
    fs.writeFileSync(full, out);
  }
}
console.log(JSON.stringify({ mode: write ? 'write' : 'report', added: res.added, files: res.files, already: res.already, skippedNotAccessible: res.skippedNotAccessible, skippedSpread: res.skippedSpread.length, skippedBackdrop: res.skippedBackdrop.length }, null, 1));
if (process.argv.includes('--list')) console.log({ spread: res.skippedSpread, backdrop: res.skippedBackdrop });
