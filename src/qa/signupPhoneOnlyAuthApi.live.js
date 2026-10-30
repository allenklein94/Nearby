// New accounts only by phone (20270367 + its Auth switch), through the REAL production Auth API.
// GATED: while the hook is off in production Auth (until 0367 is deployed AND the owner approves the switch) it calls
// nothing, and every test FAILS with "hook off" instead of passing empty, so a run before the switch can't be read as proof.
// Allow that state explicitly with NEARBY_SIGNUP_CHECK_EXPECT_OFF=1 (then it only confirms the hook is off).
// The checks are the shared ones in ./live/signupHookChecks.js, already proven against an isolated Auth at production's
// version (scripts/replay/signup-hook-auth-local.js, 13/13): a valid new address (the test mailbox + a tag) refused with
// the hook's own 403 + message (never a validation/rate-limit/CAPTCHA error), no account created, a malformed-address
// control told apart, the existing test account's password + magic-link sign-in, cleanup by exact address.
// Production differences: no new phone account here (needs a real SMS to a never-used number = run order Tier 1 item 0(f)
// on a phone, right after the switch); recovery only with NEARBY_SIGNUP_CHECK_RECOVERY=1 (a real email to the test account).
// Run: npx jest -c jest.live.config.js src/qa/signupPhoneOnlyAuthApi.live.js   (needs SUPABASE_ACCESS_TOKEN + the test account)
const { createClient } = require('@supabase/supabase-js');
const { runSignupHookChecks } = require('./live/signupHookChecks');
const { serviceKeyForCleanup } = require('./live/signInTestAccount');

const URL = 'https://enmosvippabmuqslzrox.supabase.co';
const REF = 'enmosvippabmuqslzrox';
const KEY = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW'; // the app's own publishable key
const HOOK_URI = 'pg-functions://postgres/public/hook_before_user_created';
const fileAccount = (() => {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.claude', 'live-test-account.json'), 'utf8')); } catch { return {}; }
})();
const EMAIL = process.env.NEARBY_TEST_EMAIL || fileAccount.email;
const PASSWORD = process.env.NEARBY_TEST_PASSWORD || fileAccount.password;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

async function mgmt(path, body) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}
const sqlString = (s) => `'${String(s).replace(/'/g, "''")}'`;

const d = TOKEN && EMAIL && PASSWORD ? describe : describe.skip;

d('new accounts only by phone, through the real production Auth API (20270367)', () => {
  let hookOn = false;
  let results = [];
  beforeAll(async () => {
    const cfg = await mgmt('config/auth');
    hookOn = cfg.hook_before_user_created_enabled === true && cfg.hook_before_user_created_uri === HOOK_URI;
    if (!hookOn) return;
    const admin = createClient(URL, await serviceKeyForCleanup(), { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
    results = await runSignupHookChecks({
      auth: () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).auth,
      usersWithEmail: async (email) => (await mgmt('database/query', {
        query: `select id from auth.users where lower(email) = lower(${sqlString(email)})`, read_only: true })).map((r) => r.id),
      deleteUser: async (id) => { const { error } = await admin.deleteUser(id); if (error) throw error; },
      magicLinkHash: async (email) => {
        const { data, error } = await admin.generateLink({ type: 'magiclink', email });
        if (error) throw error;
        return data.properties.hashed_token;
      },
      existing: { email: EMAIL, password: PASSWORD },
      phoneSignup: null,
      recovery: process.env.NEARBY_SIGNUP_CHECK_RECOVERY === '1',
    });
    // eslint-disable-next-line no-console
    results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.check}  ${JSON.stringify(r.detail ?? null)}`));
  }, 120000);

  test('the hook is on in production Auth (or the off state was explicitly expected)', () => {
    if (process.env.NEARBY_SIGNUP_CHECK_EXPECT_OFF === '1') { expect(hookOn).toBe(false); return; }
    expect(hookOn ? 'on' : 'hook off: deploy 0367 and switch it on first (nothing was called)').toBe('on');
  });

  test('every shared check passes (refusals attributed to the hook, no account, existing sign-in, cleanup)', () => {
    if (!hookOn) return;
    expect(results.filter((r) => !r.pass).map((r) => r.check)).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(8);
  });
});
