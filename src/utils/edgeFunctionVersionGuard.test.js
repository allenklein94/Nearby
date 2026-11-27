// Minimum supported app version (20270434): every edge function the app or a website page calls either asks the database's
// version gate first (supabase/functions/_shared/appVersion.ts) or is listed here with the reason it must never be refused.
// A new app-called function fails this test until it does one or the other.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FN = path.join(ROOT, 'supabase/functions');

// Never refused by version, on purpose (owner, 2026-11-27: never block authentication, account recovery or sign-out).
const EXEMPT = {
  'delete-account': 'deleting your account is a data right: it must work from any build',
  'export-data': 'exporting your data is a data right: it must work from any build',
  'review-login': 'a sign-in path (App Review); sign-in itself is never refused',
  'submit-business-application': 'the static business sign-up page (docs/business.html), not an app build',
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(e.name) && !/\.(test|journey|live)\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

const callers = [...walk(path.join(ROOT, 'src')), ...fs.readdirSync(path.join(ROOT, 'docs')).filter((f) => f.endsWith('.html')).map((f) => path.join(ROOT, 'docs', f))]
  .map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const functions = fs.readdirSync(FN).filter((n) => !n.startsWith('_') && fs.existsSync(path.join(FN, n, 'index.ts')));
const called = functions.filter((n) => new RegExp(`functionUrl\\(\\s*['"\`]${n}['"\`]|functions/v1/${n}\\b|invoke\\(\\s*['"\`]${n}['"\`]`).test(callers));

test('the scan finds the functions the app calls', () => {
  expect(called.length).toBeGreaterThan(20);
});

test.each(called)('%s asks the version gate before any work, or is exempt with a reason', (n) => {
  const src = fs.readFileSync(path.join(FN, n, 'index.ts'), 'utf8');
  if (EXEMPT[n]) {
    expect(src).not.toMatch(/appVersionRefusal/);
    return;
  }
  expect(src).toMatch(/from '\.\.\/_shared\/appVersion\.ts'/);
  expect(src).toMatch(/await appVersionRefusal\(req/);
});

test('every exemption is a real, app-called function', () => {
  Object.keys(EXEMPT).forEach((n) => expect(called).toContain(n));
});

test('as-user database clients forward the caller\'s version headers (strict mode identifies them)', () => {
  for (const n of called.filter((x) => !EXEMPT[x])) {
    const src = fs.readFileSync(path.join(FN, n, 'index.ts'), 'utf8');
    const asUser = src.match(/createClient\([^;]*Authorization[^;]*\)/g) || [];
    asUser.forEach((c) => expect([n, /clientVersionHeaders\(req\)/.test(c)]).toEqual([n, true]));
  }
});
