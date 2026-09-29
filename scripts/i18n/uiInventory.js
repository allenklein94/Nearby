// Finds hard-coded English UI text in a source file (localization pass 5). Used by src/i18n/uiInventory.test.js and as a CLI:
//   node scripts/i18n/uiInventory.js src/screens/HomeScreen.js [...]
// Reports: JSX text; text-bearing props (placeholder, title, label, accessibilityLabel...); string/template literals rendered
// as JSX children; Alert.alert / showSuccessToast / presentRecoverableError title, message and button text; object properties
// that carry display text (label, title, subtitle, description, text...); and any other literal that reads like a sentence
// (capitalized, 2+ words), except log/analytics/navigation/query arguments. Strings inside t()/tr()/translate() keys are keys.
const fs = require('fs');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const TEXT_NAME = /(label|title|text|message|caption|hint|placeholder|subtitle|description|heading|cta|body|prompt|question|helper|note|eyebrow|kicker|tagline|reason|copy|headline|detail)$/i;
const TEXT_PROPS = { has: (n) => typeof n === 'string' && TEXT_NAME.test(n) && !/^(testID|nativeID|key|style)$/.test(n) };
const TEXT_KEYS = { has: (n) => typeof n === 'string' && (TEXT_NAME.test(n) || /^(short|long|name)$/.test(n)) };
const SKIP_EXACT = new Set(['logSoftFailure', 'trackEvent', 'capture', 'require', 'navigate', 'push', 'replace', 'from', 'select', 'eq', 'neq',
  'rpc', 'order', 'in', 'or', 'ilike', 'like', 'contains', 'filter', 'getItem', 'setItem', 'removeItem', 'Error', 't', 'tr', 'translate',
  'interpolate', 'uiText', 'emptyCopy', 'addEventListener', 'registerCategoryTag', 'fetch', 'test', 'it', 'describe', 'expect', 'setParams',
  'reset', 'goBack', 'getParent', 'dispatch', 'track', 'identify', 'screen', 'match', 'startsWith', 'endsWith', 'includes', 'split', 'join',
  'toLocaleDateString', 'toLocaleTimeString', 'toLocaleString', 'Date', 'RegExp', 'upsert', 'insert', 'update', 'delete', 'single', 'maybeSingle',
  'limit', 'gte', 'lte', 'gt', 'lt', 'is', 'not', 'channel', 'on', 'subscribe', 'invoke', 'getPublicUrl', 'upload', 'storage', 'createSignedUrl']);
const skipCall = (name) => {
  if (!name) return false;
  const last = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
  return SKIP_EXACT.has(name) || SKIP_EXACT.has(last) || /^(console|posthog|navigation|Linking|StyleSheet|supabase|AsyncStorage|names|Haptics)\./.test(name);
};
const KEYISH = /^[a-z_]+(\.[a-zA-Z0-9_]+)+$/;

const english = (s) => typeof s === 'string' && /[A-Za-z]{2,}/.test(s) && !KEYISH.test(s.trim()) && !/^[a-z][a-zA-Z0-9]*$/.test(s.trim())
  && !/^[a-z0-9_-]+$/.test(s.trim()) && !/^(https?:|mailto:|tel:|#|\/)/.test(s.trim());
const sentence = (s) => english(s) && /^[^a-z]*[A-Z][a-z']*[,.!?]?\s+\S/.test(s.trim());

function calleeName(node) {
  const c = node.callee;
  if (!c) return '';
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'MemberExpression') return `${c.object.name || (c.object.type === 'MemberExpression' ? c.object.property.name : '')}.${c.property.name}`;
  return '';
}
const templateText = (n) => n.quasis.map((q) => q.value.cooked).join('{}');

function scan(file) {
  const src = fs.readFileSync(file, 'utf8');
  const ast = parser.parse(src, { sourceType: 'module', plugins: ['jsx'] });
  const hits = [];
  const seen = new Set();
  const add = (node, kind, text) => {
    const k = `${node.start}`;
    if (seen.has(k)) return;
    seen.add(k);
    hits.push({ line: node.loc.start.line, kind, text: text.replace(/\s+/g, ' ').trim() });
  };
  const insideSkippedCall = (path) => {
    for (let p = path.parentPath; p; p = p.parentPath) {
      if (p.isCallExpression() || p.isNewExpression()) {
        const n = calleeName(p.node);
        const isArg = p.node.arguments.includes(path.node) || true;
        if (isArg && skipCall(n) && !/^(Alert\.alert|showSuccessToast|presentRecoverableError)$/.test(n)) return true;
      }
      if (p.isJSXAttribute() && !TEXT_PROPS.has(p.node.name.name)) return true;
      if (p.isImportDeclaration() || p.isExportNamedDeclaration() && p.node.source) return true;
      if (p.isBinaryExpression() && /[=!]==?/.test(p.node.operator)) return true;
      if (p.isSwitchCase()) return true;
      if (p.isMemberExpression() && p.node.computed && p.node.property === path.node) return true;
      if (p.isObjectProperty() && p.node.key === path.node) return true;
      if (p.isFunction() || p.isProgram() || p.isJSXElement()) break;
    }
    return false;
  };
  traverse(ast, {
    JSXText(path) { const s = path.node.value; if (english(s)) add(path.node, 'jsx', s); },
    StringLiteral(path) {
      const s = path.node.value;
      if (!english(s) || insideSkippedCall(path)) return;
      const parent = path.parent;
      if (path.parentPath.isJSXAttribute()) { if (TEXT_PROPS.has(parent.name.name)) add(path.node, `prop:${parent.name.name}`, s); return; }
      const near = path.findParent((p) => p.isJSXAttribute() || p.isJSXElement());
      if (near && near.isJSXAttribute() && TEXT_PROPS.has(near.node.name.name)) { add(path.node, 'prop', s); return; }
      if (near && near.isJSXElement()) { add(path.node, 'expr', s); return; }
      if (path.parentPath.isObjectProperty() && TEXT_KEYS.has(parent.key.name || parent.key.value)) { add(path.node, `obj:${parent.key.name || parent.key.value}`, s); return; }
      const call = path.findParent((p) => p.isCallExpression());
      if (call && /^(Alert\.alert|showSuccessToast|presentRecoverableError)$/.test(calleeName(call.node))) { add(path.node, 'alert', s); return; }
      if (sentence(s)) add(path.node, 'loose', s);
    },
    TemplateLiteral(path) {
      const s = templateText(path.node);
      if (!english(s.replace(/\{\}/g, ' ')) || insideSkippedCall(path)) return;
      if (path.parentPath.isTaggedTemplateExpression()) return;
      const call = path.findParent((p) => p.isCallExpression());
      if (call && /^(Alert\.alert|showSuccessToast|presentRecoverableError)$/.test(calleeName(call.node))) { add(path.node, 'alert', s); return; }
      const near = path.findParent((p) => p.isJSXAttribute() || p.isJSXElement());
      if (near && near.isJSXAttribute() && TEXT_PROPS.has(near.node.name.name)) { add(path.node, 'prop', s); return; }
      if (near && near.isJSXElement()) { add(path.node, 'expr', s); return; }
      if (path.parentPath.isObjectProperty() && TEXT_KEYS.has(path.parent.key.name)) { add(path.node, `obj:${path.parent.key.name}`, s); return; }
      if (sentence(s.replace(/\{\}/g, 'X'))) add(path.node, 'loose', s);
    },
  });
  return hits;
}

module.exports = { scan };

if (require.main === module) {
  for (const f of process.argv.slice(2)) {
    const hits = scan(f);
    console.log(`${f}: ${hits.length}`);
    for (const h of hits) console.log(`  ${h.line}\t${h.kind}\t${JSON.stringify(h.text)}`);
  }
}
