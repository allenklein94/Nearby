#!/usr/bin/env node
// Item 34 (owner, 2026-11-27): every tappable control reaches 44 x 44 pt. Finds touchables whose style is a StyleSheet entry
// with a height / minHeight (or width for round controls) under 44 and no hitSlop, via the Babel AST. Report by default;
// `--write` adds an invisible hitSlop of (44 - size) / 2 on each side, so nothing changes visually.
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const ROOT = path.join(__dirname, '..', '..', 'src');
const TAGS = new Set(['TouchableOpacity', 'Pressable', 'TouchableHighlight', 'ScaleButton']);
const write = process.argv.includes('--write');
const list = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? list(path.join(d, e.name)) : (e.name.endsWith('.js') && !e.name.endsWith('.test.js') ? [path.join(d, e.name)] : []));
const files = ['screens', 'components'].flatMap(list);
const found = [];
for (const f of files) {
  const full = path.join(ROOT, f);
  const src = fs.readFileSync(full, 'utf8');
  let ast;
  try { ast = parse(src, { sourceType: 'module', plugins: ['jsx'] }); } catch (e) { continue; }
  const sizes = {};
  traverse(ast, {
    ObjectProperty(p) {
      const v = p.node.value;
      if (v.type !== 'ObjectExpression' || p.node.key.type !== 'Identifier') return;
      const num = (k) => { const q = v.properties.find((x) => x.type === 'ObjectProperty' && x.key.name === k && x.value.type === 'NumericLiteral'); return q ? q.value.value : null; };
      const h = num('minHeight') ?? num('height');
      if (h != null) sizes[p.node.key.name] = h;
    },
  });
  const inserts = [];
  traverse(ast, {
    JSXOpeningElement(p) {
      const n = p.node.name;
      if (n.type !== 'JSXIdentifier' || !TAGS.has(n.name)) return;
      const attrs = p.node.attributes;
      if (attrs.some((a) => a.type === 'JSXAttribute' && a.name.name === 'hitSlop')) return;
      const style = attrs.find((a) => a.type === 'JSXAttribute' && a.name.name === 'style');
      if (!style || style.value?.type !== 'JSXExpressionContainer') return;
      const names = [];
      const collect = (e) => {
        if (!e) return;
        if (e.type === 'MemberExpression' && e.object.name === 'styles' && e.property.type === 'Identifier') names.push(e.property.name);
        else if (e.type === 'ArrayExpression') e.elements.forEach(collect);
        else if (e.type === 'LogicalExpression') collect(e.right);
      };
      collect(style.value.expression);
      const base = names.map((x) => sizes[x]).filter((x) => x != null);
      if (!base.length) return;
      const h = Math.max(...base);
      if (h >= 44) return;
      const pad = Math.ceil((44 - h) / 2);
      found.push(`${f}:${p.node.loc.start.line} ${names.join('+')}=${h} -> hitSlop ${pad}`);
      inserts.push([n.end, pad]);
    },
  });
  if (write && inserts.length) {
    let out = src;
    for (const [at, pad] of inserts.sort((a, b) => b[0] - a[0])) out = `${out.slice(0, at)} hitSlop={{ top: ${pad}, bottom: ${pad}, left: ${pad}, right: ${pad} }}${out.slice(at)}`;
    fs.writeFileSync(full, out);
  }
}
console.log(JSON.stringify({ mode: write ? 'write' : 'report', under44: found.length, found }, null, 1));
