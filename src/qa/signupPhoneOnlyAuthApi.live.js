// New accounts only by phone (20270367 + its Auth switch): checked through the REAL Supabase Auth API, not SQL.
// GATED: while the hook is off in Auth (today, and until the owner approves the switch after 0367 is deployed) it calls
// nothing and only reports "hook off". Once on:
//   1. an email sign-up for an unknown address is refused with the hook's 403 and creates no auth user;
//   2. an email code / magic link to an unknown address (shouldCreateUser) is refused the same way and creates no user;
//   3. an existing email account still signs in by password AND by a server-issued magic link (the review-login path
//      App Review uses; business owners with email accounts sign in the same way, never through the hook);
//   4. password recovery for an existing account still sends (only with NEARBY_SIGNUP_CHECK_RECOVERY=1: a real email).
// The address used in 1-2 is a fresh one on the reserved .invalid domain (nothing can be delivered); if a step ever creates
// it, the test fails and removes exactly that user (matched by the full address) so nothing is left behind.
// Not covered here: a NEW phone account through phone OTP needs a real SMS to a real, never-used number = run order Tier 1
// item 0(f) on a phone, right after the switch. Adding an email/phone to an EXISTING account (updateUser) is not account
// creation: the hook never runs and the account stays phone-verified or email-only as it was; an email-only account can't
// add a phone first because it can't be created.
// Run: npx jest -c jest.live.config.js src/qa/signupPhoneOnlyAuthApi.live.js   (needs SUPABASE_ACCESS_TOKEN)
const { createClient } = require('@supabase/supabase-js');

const URL = 'https://enmosvippabmuqslzrox.supabase.co';
const REF = 'enmosvippabmuqslzrox';
const KEY = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW'; // the app's own publishable key
const HOOK_MESSAGE = 'New Nearby accounts are created with a phone number in the Nearby app.';
const fileAccount = (() => {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.claude', 'live-test-account.json'), 'utf8')); } catch { return {}; }
})();
const EMAIL = process.env.NEARBY_TEST_EMAIL || fileAccount.email;
const PASSWORD = process.env.NEARBY_TEST_PASSWORD || fileAccount.password;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROBE = `signup-hook-check-${Date.now()}@nearby-check.invalid`;

const anon = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
async function mgmt(path, body) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}
const probeUsers = async () => mgmt('database/query', { query: `select id from auth.users where email = '${PROBE}'`, read_only: true });
const refusedByHook = (error) => error && error.status === 403 && String(error.message).includes(HOOK_MESSAGE);

const d = TOKEN ? describe : describe.skip;

d('new accounts only by phone, through the real Auth API (20270367)', () => {
  let hookOn = false;
  beforeAll(async () => {
    const cfg = await mgmt('config/auth');
    hookOn = cfg.hook_before_user_created_enabled === true && cfg.hook_before_user_created_uri === 'pg-functions://postgres/public/hook_before_user_created';
    // eslint-disable-next-line no-console
    if (!hookOn) console.log('signup hook is OFF in Auth: nothing called (run again after the approved switch)');
  }, 30000);

  afterAll(async () => {
    if (!hookOn) return;
    const left = await probeUsers();
    if (!left.length) return;
    const admin = createClient(URL, await require('./live/signInTestAccount').serviceKeyForCleanup(), { auth: { persistSession: false } });
    for (const u of left) await admin.auth.admin.deleteUser(u.id);
  }, 30000);

  test('1. email sign-up for an unknown address: refused by the hook, no user created', async () => {
    if (!hookOn) return;
    const { error } = await anon().auth.signUp({ email: PROBE, password: `x-${Date.now()}-Long!` });
    expect(refusedByHook(error)).toBe(true);
    expect(await probeUsers()).toEqual([]);
  }, 30000);

  test('2. email code / magic link to an unknown address: refused by the hook, no user created', async () => {
    if (!hookOn) return;
    const { error } = await anon().auth.signInWithOtp({ email: PROBE, options: { shouldCreateUser: true } });
    expect(refusedByHook(error)).toBe(true);
    expect(await probeUsers()).toEqual([]);
  }, 30000);

  const withAccount = EMAIL && PASSWORD ? test : test.skip;
  withAccount('3. an existing email account still signs in, by password and by server-issued magic link', async () => {
    if (!hookOn) return;
    const { signInTestAccount } = require('./live/signInTestAccount');
    for (const via of ['password', 'link']) {
      const client = anon();
      const prev = process.env.NEARBY_TEST_SIGNIN;
      if (via === 'link') process.env.NEARBY_TEST_SIGNIN = 'link';
      try {
        const r = await signInTestAccount(client, { email: EMAIL, password: PASSWORD });
        expect(r.user.email).toBe(EMAIL);
      } finally {
        if (prev === undefined) delete process.env.NEARBY_TEST_SIGNIN; else process.env.NEARBY_TEST_SIGNIN = prev;
        await client.auth.signOut();
      }
    }
  }, 60000);

  const recovery = EMAIL && process.env.NEARBY_SIGNUP_CHECK_RECOVERY === '1' ? test : test.skip;
  recovery('4. password recovery for an existing account still sends (real email to the test account)', async () => {
    if (!hookOn) return;
    const { error } = await anon().auth.resetPasswordForEmail(EMAIL);
    expect(error).toBeNull();
  }, 30000);
});
