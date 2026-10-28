// Edge functions and the legacy JWT secret (owner, 2026-10-28; PRODUCT_AUDIT/JWT_SECRET_EXPOSURE_2026-10-28.md).
// Retiring the exposed legacy HS256 secret is safe for a function only if it never needs that secret or a key signed by it:
//   1. no function reads a JWT secret (SUPABASE_JWT_SECRET / JWT_SECRET) or embeds a key;
//   2. functions read their API keys only through _shared/supabaseKeys.ts (SUPABASE_SECRET_KEYS / SUPABASE_PUBLISHABLE_KEYS),
//      except the 13 sources recovered verbatim from live bundles (not redeployed; their legacy-named variable already holds
//      the new key at runtime, digest compared 2026-10-28);
//   3. the helper reads only the new variables (legacy-name fallback removed 2026-10-28): missing/invalid = undefined;
//   4. every live function has a repo source (34 on 2026-10-28).
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const FUNCTIONS = path.join(__dirname, '..', '..', 'supabase', 'functions');
const dirs = fs.readdirSync(FUNCTIONS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name).sort();
const src = (name) => fs.readFileSync(path.join(FUNCTIONS, name, 'index.ts'), 'utf8');

const RECOVERED = ['export-data', 'generate-courage-message', 'generate-icebreaker', 'generate-introduction',
  'generate-strengths', 'get-online-status', 'moderate-chat-image', 'moderate-text', 'rehearsal-chat',
  'revenuecat-webhook', 'review-login', 'setup-review-account', 'translate-message'];
const LIVE = ['admin-sponsored-refund', 'ai-concierge', 'business-ai-assistant', 'business-email',
  'business-onboarding-assistant', 'business-stripe-connect-onboarding', 'cancel-sponsored-placement', 'create-assistant',
  'create-business-payment-intent', 'create-sponsored-checkout', 'delete-account', 'moderate-photo', 'read-offer-creative',
  'report-presence', 'resweep-business-content', 'rewrite-offer-plain-language', 'screen-business-content', 'send-push',
  'sponsored-stripe-webhook', 'stripe-connect-webhook', 'submit-business-application', ...RECOVERED].sort();

function loadHelper(env) {
  const code = ts.transpileModule(fs.readFileSync(path.join(FUNCTIONS, '_shared', 'supabaseKeys.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  const Deno = { env: { get: (k) => env[k] } };
  new Function('module', 'exports', 'Deno', code)(module, module.exports, Deno);
  return module.exports;
}

describe('edge functions never depend on the legacy JWT secret', () => {
  test('every live function has a repo source, and nothing else', () => {
    expect(dirs).toEqual(LIVE);
  });

  test.each(dirs)('%s reads no JWT secret and embeds no key', (name) => {
    const s = src(name);
    expect(s).not.toMatch(/JWT_SECRET/);
    expect(s).not.toMatch(/eyJhbGci[A-Za-z0-9_-]{10,}|sb_(secret|publishable)_[A-Za-z0-9_-]{10,}|sk_(live|test)_[A-Za-z0-9]{10,}/);
  });

  test.each(dirs.filter((d) => !RECOVERED.includes(d)))('%s reads API keys only via the shared helper', (name) => {
    const s = src(name);
    expect(s).not.toMatch(/Deno\.env\.get\(['"]SUPABASE_(SERVICE_ROLE|ANON)_KEY['"]\)/);
    if (/secretKey\(\)|publishableKey\(\)/.test(s)) expect(s).toMatch(/from '\.\.\/_shared\/supabaseKeys\.ts'/);
  });

  test('caller checks still compare against the service secret (send-push, resweep)', () => {
    expect(src('send-push')).toMatch(/const SERVICE_ROLE_KEY = secretKey\(\);[\s\S]*`Bearer \$\{SERVICE_ROLE_KEY\}`/);
    expect(src('resweep-business-content')).toMatch(/const SERVICE_ROLE_KEY = secretKey\(\);[\s\S]*token !== SERVICE_ROLE_KEY/);
  });

  test('review functions keep the reviewer email out of the public repo', () => {
    for (const n of ['review-login', 'setup-review-account']) expect(src(n)).toMatch(/const REVIEWER_EMAIL = Deno\.env\.get\('REVIEWER_EMAIL'\)/);
  });
});

describe('_shared/supabaseKeys.ts', () => {
  test('prefers the new JSON variables', () => {
    const k = loadHelper({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_new"}', SUPABASE_SERVICE_ROLE_KEY: 'legacy',
      SUPABASE_PUBLISHABLE_KEYS: '{"default":"sb_publishable_new"}', SUPABASE_ANON_KEY: 'legacy-anon' });
    expect(k.secretKey()).toBe('sb_secret_new');
    expect(k.publishableKey()).toBe('sb_publishable_new');
  });
  test('never falls back to the legacy-named variables', () => {
    expect(loadHelper({ SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y' }).secretKey()).toBeUndefined();
    expect(loadHelper({ SUPABASE_SERVICE_ROLE_KEY: 'x', SUPABASE_ANON_KEY: 'y' }).publishableKey()).toBeUndefined();
    expect(loadHelper({ SUPABASE_SECRET_KEYS: 'not json', SUPABASE_SERVICE_ROLE_KEY: 'x' }).secretKey()).toBeUndefined();
    expect(loadHelper({ SUPABASE_SECRET_KEYS: '{}', SUPABASE_SERVICE_ROLE_KEY: 'x' }).secretKey()).toBeUndefined();
    expect(loadHelper({}).secretKey()).toBeUndefined();
    expect(fs.readFileSync(path.join(FUNCTIONS, '_shared', 'supabaseKeys.ts'), 'utf8')).not.toMatch(/Deno\.env\.get\('SUPABASE_(SERVICE_ROLE|ANON)_KEY'\)/);
  });
  test('uses the only key when it is not named "default"', () => {
    expect(loadHelper({ SUPABASE_SECRET_KEYS: '{"server":"sb_secret_a"}' }).secretKey()).toBe('sb_secret_a');
  });
});
