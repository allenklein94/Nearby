// Scans an app source tree for every database call: .rpc(name, {args}), .from(table) + select/insert/update/upsert/delete.
// node scan-calls.js <src dir> <out.json> (release compatibility, scripts/compat/README.md)
const fs = require('fs'), path = require('path');
const root = process.argv[2];
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const st = fs.statSync(p);
  if (st.isDirectory()) { if (!/node_modules|__tests__|journeys|qa$/.test(f)) walk(p); }
  else if (/\.js$/.test(f) && !/\.test\.js$|\.live\.js$|\.journey\.js$/.test(f)) files.push(p); } })(root);
const out = { rpc: [], table: [], files: files.length };
// Comments blanked (same length, line numbers kept) so words in a comment inside an argument object are not read as keys.
function stripComments(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) { const c = src[i], n = src[i + 1];
    if (q) { out += c; if (c === '\\') { out += n ?? ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && n === '*') { while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; } out += '  '; i += 2; continue; }
    out += c; i++; }
  return out;
}
function objectKeys(src, i) { // src[i] === '{' : top-level keys of the object literal
  // afterColon: inside a value (a key was already taken), so identifiers there are values, not shorthand keys.
  let depth = 0, j = i, keys = [], tok = '', afterColon = false;
  for (; j < src.length && j < i + 3000; j++) { const c = src[j];
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') { depth--; if (depth === 0) break; }
    if (depth === 1) { if (/[A-Za-z0-9_$'"]/.test(c)) tok += c; else {
      if (c === ':' && tok && !afterColon) { keys.push(tok.replace(/['"]/g, '')); afterColon = true; }
      if (c === ',') { if (tok && !afterColon && /^[A-Za-z_$][\w$]*$/.test(tok)) keys.push(tok); /* shorthand */ afterColon = false; }
      if (!/\s/.test(c)) tok = ''; } } }
  if (tok && !afterColon && /^[A-Za-z_$][\w$]*$/.test(tok)) keys.push(tok);
  return [...new Set(keys)];
}
for (const f of files) { const src = stripComments(fs.readFileSync(f, 'utf8')); const rel = path.relative(root, f);
  for (const m of src.matchAll(/\.rpc\(\s*'([a-z_0-9]+)'\s*(,\s*)?/g)) { const at = m.index + m[0].length;
    const args = m[2] && src[at] === '{' ? objectKeys(src, at) : (m[2] ? null : []);
    out.rpc.push({ name: m[1], args, file: rel, line: src.slice(0, m.index).split('\n').length }); }
  for (const m of src.matchAll(/\.from\(\s*'([a-z_0-9]+)'\s*\)/g)) { const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 400);
    const op = (tail.match(/^\s*\.(select|insert|update|upsert|delete)\(/) || [])[1] || null; let cols = null;
    if (op === 'select') { const s = tail.match(/^\s*\.select\(\s*(['`])([^'`$]*)\1/); if (s) cols = s[2]; }
    out.table.push({ name: m[1], op, cols, file: rel, line: src.slice(0, m.index).split('\n').length }); } }
fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
console.log(`files ${files.length} rpc calls ${out.rpc.length} (${new Set(out.rpc.map(r=>r.name)).size} names) table calls ${out.table.length} (${new Set(out.table.map(t=>t.name)).size}) unknown-args ${out.rpc.filter(r=>r.args===null).length} selects-with-literal ${out.table.filter(t=>t.cols!==null).length}`);
