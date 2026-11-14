// A `const`/`let` read during render BEFORE its declaration is a TDZ ReferenceError in a real browser (the business
// website blanks), while native Hermes/Babel may lower it to `var` and hide it. Two render-time reads exist in hooks:
//   1. a hook's dependency array (useEffect/useLayoutEffect/useMemo/useCallback/useImperativeHandle) is evaluated
//      during render: every name in it must be declared earlier in the same component;
//   2. a useMemo callback runs during render: every component-level name it reads must be declared earlier.
// Real crash this guards (2026-11-14): BusinessDashboardScreen's logo-preview effect listed `offerModalRequestId` in
// its deps ~100 lines before `const [offerModalRequestId, ...] = useState(null)`: the linked business dashboard
// rendered blank on the website (also in the published export of 2026-10-23). Generalizes
// businessDashboardDeclarationOrder.test.js (two names) to every screen and component.
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const ROOT = path.join(__dirname, '..');
const DIRS = ['screens', 'components', 'navigation', 'motion', 'hooks'];
const DEPS_HOOKS = new Set(['useEffect', 'useLayoutEffect', 'useMemo', 'useCallback', 'useImperativeHandle', 'useFocusEffect']);

function filesIn(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return filesIn(rel);
    return /\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [rel] : [];
  });
}

function patternNames(node, out = []) {
  if (!node) return out;
  if (node.type === 'Identifier') out.push(node.name);
  else if (node.type === 'ArrayPattern') node.elements.forEach((e) => patternNames(e, out));
  else if (node.type === 'ObjectPattern') node.properties.forEach((p) => patternNames(p.type === 'RestElement' ? p.argument : p.value, out));
  else if (node.type === 'AssignmentPattern') patternNames(node.left, out);
  else if (node.type === 'RestElement') patternNames(node.argument, out);
  return out;
}

function rootName(node) {
  let n = node;
  while (n && (n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression')) n = n.object;
  return n && n.type === 'Identifier' ? n.name : null;
}

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'leadingComments', 'trailingComments', 'innerComments', 'extra']);
function walk(node, visit, parent) {
  if (!node || typeof node.type !== 'string') return;
  if (visit(node, parent) === false) return;
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === 'string' && walk(c, visit, node));
    else if (v && typeof v.type === 'string') walk(v, visit, node);
  }
}

function hookName(call) {
  const c = call.callee;
  if (c.type === 'Identifier') return c.name;
  if ((c.type === 'MemberExpression' || c.type === 'OptionalMemberExpression') && c.property.type === 'Identifier') return c.property.name;
  return null;
}

// Identifiers READ inside fn (references, not property keys or declarations local to fn).
function readsIn(fn) {
  const local = new Set(fn.params.flatMap((p) => patternNames(p)));
  walk(fn.body, (n) => {
    if (n.type === 'VariableDeclarator') patternNames(n.id).forEach((x) => local.add(x));
    if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression') && n !== fn) {
      n.params.flatMap((p) => patternNames(p)).forEach((x) => local.add(x));
    }
  });
  const reads = new Set();
  walk(fn.body, (n, parent) => {
    if (n.type !== 'Identifier') return;
    if (parent && (parent.type === 'MemberExpression' || parent.type === 'OptionalMemberExpression') && parent.property === n && !parent.computed) return;
    if (parent && (parent.type === 'ObjectProperty') && parent.key === n && !parent.computed && !parent.shorthand) return;
    if (parent && parent.type === 'JSXAttribute') return;
    if (!local.has(n.name)) reads.add(n.name);
  });
  return reads;
}

function violationsInFile(rel, code) {
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx'] });
  const out = [];
  walk(ast, (fn) => {
    if (!['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(fn.type)) return;
    if (!fn.body || fn.body.type !== 'BlockStatement') return;
    const stmts = fn.body.body;
    const declaredAt = new Map();
    stmts.forEach((st, i) => {
      if (st.type === 'VariableDeclaration' && st.kind !== 'var') {
        st.declarations.forEach((d) => patternNames(d.id).forEach((name) => { if (!declaredAt.has(name)) declaredAt.set(name, i); }));
      }
    });
    if (!declaredAt.size) return;
    stmts.forEach((st, i) => {
      walk(st, (n) => {
        // never descend into nested functions: their bodies run later (except the useMemo callback, handled below)
        if (n !== st && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(n.type)) return false;
        if (n.type !== 'CallExpression') return;
        const name = hookName(n);
        if (!DEPS_HOOKS.has(name)) return;
        const late = (v) => declaredAt.has(v) && declaredAt.get(v) > i;
        const deps = n.arguments[n.arguments.length - 1];
        if (deps && deps.type === 'ArrayExpression') {
          deps.elements.forEach((el) => {
            const v = el && rootName(el);
            if (v && late(v)) out.push(`${rel}:${el.loc.start.line} ${name} deps read \`${v}\` declared later (line ${stmts[declaredAt.get(v)].loc.start.line})`);
          });
        }
        const cb = n.arguments[0];
        if (name === 'useMemo' && cb && (cb.type === 'ArrowFunctionExpression' || cb.type === 'FunctionExpression')) {
          readsIn(cb).forEach((v) => {
            if (late(v)) out.push(`${rel}:${n.loc.start.line} useMemo body reads \`${v}\` declared later (line ${stmts[declaredAt.get(v)].loc.start.line})`);
          });
        }
      });
    });
  });
  return out;
}

const FILES = DIRS.flatMap(filesIn);

describe('render-time reads never precede their declaration (browser TDZ)', () => {
  it('finds the source files (sanity)', () => {
    expect(FILES).toContain(path.join('screens', 'BusinessDashboardScreen.js'));
    expect(FILES.length).toBeGreaterThan(100);
  });

  it('catches the 2026-11-14 crash shape (the effect above its state)', () => {
    const bad = `function S() {
      useEffect(() => { if (open) go(); }, [open, partner?.id]);
      const [open, setOpen] = useState(null);
      const [partner] = useState(null);
    }`;
    expect(violationsInFile('fixture.js', bad)).toEqual([
      expect.stringContaining('`open` declared later'),
      expect.stringContaining('`partner` declared later'),
    ]);
  });

  it('catches a useMemo body reading a later value, and allows reads in effect bodies (they run after render)', () => {
    const memo = `function S() { const x = useMemo(() => later + 1, []); const later = 2; }`;
    expect(violationsInFile('fixture.js', memo)).toEqual([expect.stringContaining('`later` declared later')]);
    const ok = `function S() { const [a] = useState(0); useEffect(() => { b(); }, [a]); const b = () => {}; }`;
    expect(violationsInFile('fixture.js', ok)).toEqual([]);
  });

  it('no screen, component, navigator, motion file or hook has one', () => {
    const all = FILES.flatMap((rel) => violationsInFile(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')));
    expect(all).toEqual([]);
  });
});
