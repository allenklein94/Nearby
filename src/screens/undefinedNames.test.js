// Every name the app's source reads is declared (imported, defined, or a real runtime global). Added 2026-10-11 after a sweep
// found four that were not, all invisible to unit tests and parse checks because no device or simulator has ever run the app:
//   HomeScreen called useEffect without importing it (a crash the moment Home renders, since 2026-09-20); HomeScreen read
//   `profile` outside the block that declared it (a ReferenceError its try swallowed, so Picked For You never built);
//   SettingsScreen called toggleNotifPref after item 142 removed it (four Privacy switches threw on tap); EditGatheringScreen
//   called Haptics.selectionAsync without importing expo-haptics (every chip tap threw).
// This is the substitute for a lint/run until a device exists. A new runtime global goes in GLOBALS with a reason.
const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const ROOT = path.join(__dirname, '..', '..');
const GLOBALS = new Set([
  ...Object.getOwnPropertyNames(globalThis),
  // React Native / Expo / web runtime globals the app legitimately reads
  'require', 'module', 'exports', '__dirname', '__filename', 'process', '__DEV__', 'global', 'window', 'document', 'navigator',
  'fetch', 'FormData', 'Blob', 'File', 'FileReader', 'Headers', 'Request', 'Response', 'XMLHttpRequest', 'WebSocket',
  'requestAnimationFrame', 'cancelAnimationFrame', 'alert', 'location', 'localStorage', 'sessionStorage', 'Image',
  'HTMLElement', 'Event', 'CustomEvent', 'KeyboardEvent', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'matchMedia', 'getComputedStyle', 'screen', 'innerWidth', 'innerHeight', 'history', 'self', 'ErrorUtils', 'arguments', 'Deno',
]);
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); } else if (/\.js$/.test(e.name) && !/\.(test|journey)\.js$/.test(e.name)) out.push(p); // tests and journeys run under Jest's globals
  }
  return out;
};

test('no source file reads a name it never declares or imports', () => {
  const files = walk(path.join(ROOT, 'src')).concat(['App.js'].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)));
  const missing = [];
  for (const f of files) {
    const ast = parser.parse(fs.readFileSync(f, 'utf8'), { sourceType: 'module', plugins: ['jsx'] });
    const bad = new Set();
    traverse(ast, {
      ReferencedIdentifier(p) {
        const n = p.node.name;
        if (p.isJSXIdentifier() && /^[a-z]/.test(n)) return; // <View>, but not intrinsic lower-case tags
        if (p.parentPath.isJSXMemberExpression() && p.parentPath.node.property === p.node) return;
        if (!p.scope.hasBinding(n, true) && !GLOBALS.has(n)) bad.add(n);
      },
    });
    for (const n of bad) missing.push(`${path.relative(ROOT, f)}: ${n}`);
  }
  expect(missing).toEqual([]);
}, 120000);
