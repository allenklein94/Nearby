// Localization pass 5 codemod: turns the English UI literals the scanner finds (uiInventory.js) into ui.<ns>.<key> lookups.
//   node scripts/i18n/codemod.js <file> <ns> [--apply] [--skip=<line>,<line>...] [--skiptext=<json array>]
// Without --apply it prints the plan (key, English, how it will be replaced, anything it will NOT touch).
// With --apply it rewrites the file and merges the English into scripts/i18n/strings/<ns>.json (the source for
// src/i18n/ui/<ns>.js, built by build-ns.js once the other ten languages are written).
// Rules: inside a React component (Capitalized function) -> t() from useLanguage() (hook added when missing); in a plain
// helper function, a class, or where `t` is already bound to something else -> tr() (current language); at module level
// -> reported, never replaced (a module-level string would be read once, in English, at load time).
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { scan } = require('./uiInventory');

const [file, ns, ...flags] = process.argv.slice(2);
const APPLY = flags.includes('--apply');
const skipLines = new Set((flags.find((f) => f.startsWith('--skip=')) || '--skip=').slice(7).split(',').filter(Boolean).map(Number));
const skipTexts = new Set(JSON.parse((flags.find((f) => f.startsWith('--skiptext=')) || '--skiptext=[]').slice(11)));

const src = fs.readFileSync(file, 'utf8');
const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const hitsByLineText = new Set(scan(file).map((h) => `${h.line}|${h.text}`));
const isHit = (node, text) => hitsByLineText.has(`${node.loc.start.line}|${norm(text)}`) && !skipLines.has(node.loc.start.line) && !skipTexts.has(norm(text));

const stringsPath = path.join(__dirname, 'strings', `${ns}.json`);
const store = fs.existsSync(stringsPath) ? JSON.parse(fs.readFileSync(stringsPath, 'utf8')) : { en: {} };
const byEnglish = new Map(Object.entries(store.en).map(([k, v]) => [`${typeof v === 'string' ? v : JSON.stringify(v)}|${k.endsWith('A11y') ? 'A11y' : ''}`, k]));
const camel = (words) => words.map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join('');
const created = new Set();
const used = new Set();
function keyFor(english, suffix = '') {
  const existing = byEnglish.get(`${english}|${suffix}`);
  if (existing) return existing;
  const words = english.replace(/\{\w+\}/g, ' ').replace(/[^A-Za-z0-9' ]+/g, ' ').replace(/'/g, '').split(/\s+/).filter(Boolean).slice(0, 5);
  let base = (camel(words) || 'text') + suffix;
  if (/^[0-9]/.test(base)) base = `n${base}`;
  let key = base; let i = 2;
  while (store.en[key] !== undefined && store.en[key] !== english) key = `${base}${i++}`;
  store.en[key] = english;
  created.add(key);
  byEnglish.set(`${english}|${suffix}`, key);
  return key;
}
function placeholderName(expr, used) {
  let e = expr;
  while (e.type === 'TSNonNullExpression' || e.type === 'ParenthesizedExpression') e = e.expression;
  let name = 'value';
  if (e.type === 'Identifier') name = e.name;
  else if ((e.type === 'MemberExpression' || e.type === 'OptionalMemberExpression') && !e.computed) name = e.property.name;
  else if (e.type === 'CallExpression' || e.type === 'OptionalCallExpression') {
    const c = e.callee; const n = c.type === 'Identifier' ? c.name : c.property?.name;
    if (n && /^(format|display|get)/.test(n) && e.arguments[0]) return placeholderName(e.arguments[0], used);
    name = n || 'value';
  } else if (e.type === 'LogicalExpression' || e.type === 'ConditionalExpression') return placeholderName(e.type === 'LogicalExpression' ? e.left : e.consequent, used);
  if (/^[A-Z0-9_]+$/.test(name)) name = name.toLowerCase();
  name = name.replace(/_(\w)/g, (m, c) => c.toUpperCase()).replace(/^display[A-Z]/, (m) => m.slice(-1).toLowerCase());
  if (name === 'displayName' || name === 'initiatorName' || name === 'inviterName') name = 'name';
  if (name === 't' || name === 'tr') name = 'value';
  let out = name; let i = 2;
  while (used.has(out)) out = `${name}${i++}`;
  used.add(out);
  return out;
}

const edits = [];
const report = [];
const componentsNeedingHook = new Map(); // fn node -> true
let needTr = false;

function contextFor(p) {
  // nearest Capitalized function (component) walking up; a class or none = helper
  let helper = false;
  for (let q = p.parentPath; q; q = q.parentPath) {
    if (q.isClassBody()) return { kind: 'tr' };
    if (q.isFunction()) {
      let name = q.node.id?.name;
      if (!name && q.parentPath.isVariableDeclarator()) name = q.parentPath.node.id.name;
      if (!name && q.parentPath.isExportDefaultDeclaration()) name = 'Default';
      if (!name && q.parentPath.isCallExpression()) { // React.memo(function ...) / forwardRef
        const d = q.parentPath.parentPath; if (d?.isVariableDeclarator()) name = d.node.id.name;
      }
      if (name && /^[A-Z]/.test(name)) {
        if (q.node.body.type !== 'BlockStatement') return { kind: 'tr' };
        return { kind: 't', fn: q.node };
      }
      helper = true;
      if (!q.parentPath) break;
    }
  }
  return helper ? { kind: 'tr' } : { kind: 'module' };
}
function callFor(p, key, varsCode) {
  const ctx = contextFor(p);
  if (ctx.kind === 'module') return null;
  used.add(key);
  let fnName = ctx.kind;
  if (fnName === 't') {
    const b = p.scope.getBinding('t');
    if (b && !(b.path.isVariableDeclarator() && /useLanguage\(\)/.test(src.slice(b.path.node.start, b.path.node.end)))) fnName = 'tr';
  }
  if (fnName === 't') componentsNeedingHook.set(ctx.fn, true); else needTr = true;
  return `${fnName}('ui.${ns}.${key}'${varsCode ? `, ${varsCode}` : ''})`;
}
function templateParts(node) {
  const used = new Set();
  const vars = [];
  let english = '';
  node.quasis.forEach((q, i) => {
    english += q.value.cooked;
    if (i < node.expressions.length) {
      const e = node.expressions[i];
      const name = placeholderName(e, used);
      vars.push(`${name}: ${src.slice(e.start, e.end)}`);
      english += `{${name}}`;
    }
  });
  return { english, varsCode: vars.length ? `{ ${vars.join(', ')} }` : '' };
}
const suffixFor = (p) => {
  const attr = p.findParent((q) => q.isJSXAttribute());
  return attr && /accessibility/.test(attr.node.name.name) ? 'A11y' : '';
};

const handledJsx = new Set();
traverse(ast, {
  JSXElement(p) {
    // merge "text {expr} text" children into one sentence when every expression is a plain value
    const kids = p.node.children;
    const texts = kids.filter((k) => k.type === 'JSXText' && norm(k.value));
    if (!texts.some((k) => isHit(k, k.value))) return;
    const exprs = kids.filter((k) => k.type === 'JSXExpressionContainer');
    const simple = kids.every((k) => k.type === 'JSXText' || (k.type === 'JSXExpressionContainer' && k.expression.type !== 'JSXEmptyExpression'
      && !/JSX|StringLiteral|TemplateLiteral|ConditionalExpression|LogicalExpression|ArrowFunction|CallExpression/.test(JSON.stringify(k.expression.type))
      && !src.slice(k.expression.start, k.expression.end).match(/<|\?|&&|'|"|`/)));
    if (!simple || exprs.length === 0 || kids.length < 2) return;
    const used = new Set(); const vars = []; let english = '';
    for (const k of kids) {
      if (k.type === 'JSXText') english += k.value.replace(/\s*\n\s*/g, ' ');
      else { const name = placeholderName(k.expression, used); vars.push(`${name}: ${src.slice(k.expression.start, k.expression.end)}`); english += `{${name}}`; }
    }
    english = norm(english);
    const key = keyFor(english);
    const call = callFor(p, key, `{ ${vars.join(', ')} }`);
    if (!call) { report.push(`MODULE ${p.node.loc.start.line} ${english}`); return; }
    const first = kids[0]; const last = kids[kids.length - 1];
    edits.push({ start: first.start, end: last.end, text: `{${call}}` });
    for (const k of kids) handledJsx.add(k.start);
    report.push(`merge ${p.node.loc.start.line} ${key} = ${english}`);
  },
});
traverse(ast, {
  JSXText(p) {
    const v = p.node.value;
    if (handledJsx.has(p.node.start) || !isHit(p.node, v)) return;
    const english = norm(v);
    const key = keyFor(english);
    const call = callFor(p, key);
    if (!call) { report.push(`MODULE ${p.node.loc.start.line} ${english}`); return; }
    const lead = /^[ \t]+\S/.test(v) && !/\n/.test(v.slice(0, v.search(/\S/))) ? "{' '}" : '';
    const trail = /\S[ \t]+$/.test(v) && !/\n/.test(v.slice(v.search(/\s*$/))) ? "{' '}" : '';
    edits.push({ start: p.node.start, end: p.node.end, text: `${v.match(/^\s*/)[0].includes('\n') ? v.match(/^\s*/)[0] : ''}${lead}{${call}}${trail}${/\n\s*$/.test(v) ? v.match(/\s*$/)[0] : ''}` });
    report.push(`jsx ${p.node.loc.start.line} ${key} = ${english}`);
  },
  StringLiteral(p) {
    const v = p.node.value;
    if (!isHit(p.node, v)) return;
    if (p.parentPath.isObjectProperty() && p.parent.key.name === 'what') return; // presentRecoverableError phrase = lookup key
    const english = v;
    const key = keyFor(english, suffixFor(p));
    const call = callFor(p, key);
    if (!call) { report.push(`MODULE ${p.node.loc.start.line} ${english}`); return; }
    edits.push({ start: p.node.start, end: p.node.end, text: p.parentPath.isJSXAttribute() ? `{${call}}` : call });
    report.push(`str ${p.node.loc.start.line} ${key} = ${english}`);
  },
  TemplateLiteral(p) {
    const s = p.node.quasis.map((q) => q.value.cooked).join('{}');
    if (!isHit(p.node, s)) return;
    if (p.node.expressions.some((e) => /TemplateLiteral|JSX/.test(src.slice(e.start, e.end).includes('`') ? 'TemplateLiteral' : e.type))) {
      report.push(`SKIP-nested ${p.node.loc.start.line} ${s}`); return;
    }
    const { english, varsCode } = templateParts(p.node);
    const key = keyFor(english, suffixFor(p));
    const call = callFor(p, key, varsCode);
    if (!call) { report.push(`MODULE ${p.node.loc.start.line} ${english}`); return; }
    edits.push({ start: p.node.start, end: p.node.end, text: call });
    report.push(`tpl ${p.node.loc.start.line} ${key} = ${english}`);
  },
});

// nested edits: keep outermost only
edits.sort((a, b) => a.start - b.start || b.end - a.end);
const flat = [];
for (const e of edits) { const prev = flat[flat.length - 1]; if (prev && e.start < prev.end) continue; flat.push(e); }
const leftover = scan(file).filter((h) => !skipLines.has(h.line) && !skipTexts.has(h.text));

console.log(report.join('\n'));
if (!APPLY) { console.log(`\n${flat.length} edits; ${componentsNeedingHook.size} components need the hook; tr: ${needTr}`); process.exit(0); }

for (const k of created) if (!used.has(k)) delete store.en[k];
let out = src;
const hookEdits = [];
for (const fn of componentsNeedingHook.keys()) {
  const body = src.slice(fn.body.start, fn.body.end);
  const m = body.match(/const \{([^}]*)\} = useLanguage\(\);/);
  if (m) {
    if (!/\bt\b/.test(m[1])) hookEdits.push({ start: fn.body.start + m.index, end: fn.body.start + m.index + m[0].length, text: `const {${m[1].trimEnd()}, t } = useLanguage();` });
  } else {
    hookEdits.push({ start: fn.body.start + 1, end: fn.body.start + 1, text: '\n  const { t } = useLanguage();' });
  }
}
const all = [...flat, ...hookEdits].sort((a, b) => b.start - a.start);
for (const e of all) out = out.slice(0, e.start) + e.text + out.slice(e.end);
const rel = (to) => { let r = path.relative(path.dirname(file), to); if (!r.startsWith('.')) r = `./${r}`; return r; };
const addImport = (line) => { const i = out.indexOf('\n', out.search(/^import /m)); out = out.slice(0, i + 1) + line + '\n' + out.slice(i + 1); };
if (componentsNeedingHook.size && !/import \{[^}]*useLanguage[^}]*\} from/.test(out)) addImport(`import { useLanguage } from '${rel('src/context/LanguageContext')}';`);
if (needTr && !/import \{[^}]*\btr\b[^}]*\} from '[./]*i18n\/translate'/.test(out)) {
  const m = out.match(/import \{([^}]*)\} from '([./]*i18n\/translate)';/);
  if (m) out = out.replace(m[0], `import {${m[1].trimEnd()}, tr } from '${m[2]}';`); else addImport(`import { tr } from '${rel('src/i18n/translate')}';`);
}
fs.writeFileSync(file, out);
fs.mkdirSync(path.dirname(stringsPath), { recursive: true });
fs.writeFileSync(stringsPath, `${JSON.stringify(store, null, 1)}\n`);
console.log(`\napplied ${flat.length} edits; leftover before apply: ${leftover.length}`);
console.log('LEFT:\n' + scan(file).map((h) => `  ${h.line}\t${h.kind}\t${JSON.stringify(h.text)}`).join('\n'));
