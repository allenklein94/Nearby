// 0375 post-deploy (account takeover protection, owner exception 2026-10-31): through the REAL API, an ordinary signed-in
// account reaches none of the security record: the event table, the notice sender, the purge, the guard and the admin reader
// are all out of reach; the one client function (get_my_phone_change_wait) answers for the account's OWN row only.
// Nearly read-only: nothing is written by a call here (each one must be refused, or read the own row). The sign-in itself is
// a normal Auth sign-in and, by design, may record one 'new_sign_in_elsewhere' event (+ notice) for the test account if it
// is signed in elsewhere: that is the feature working, not a write by this test.
// GATED: runs only with NEARBY_POST_DEPLOY_0375=1 AND once 0375 is live (get_my_phone_change_wait exists).
// Signs in to the DEDICATED test account (owner: never the owner's primary account; credentials never in Git, logs or chat).
// The intruder story itself (password / email / number change refused) is proven on real Auth by
// scripts/replay/account-takeover-auth-local.js and, after deploy, by the manual steps in scripts/live-verify/post-deploy.js.
// Anything that returns data it shouldn't = a security defect: STOP the deployment sequence and report it.
// Run: NEARBY_POST_DEPLOY_0375=1 npx jest -c jest.live.config.js src/qa/accountTakeoverSignedIn.live.js
const { createClient } = require('@supabase/supabase-js');

const URL = 'https://enmosvippabmuqslzrox.supabase.co';
const KEY = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW'; // the app's own publishable key (src/services/supabase.js)
const fileAccount = (() => {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.claude', 'live-test-account.json'), 'utf8')); } catch { return {}; }
})();
const EMAIL = process.env.NEARBY_TEST_EMAIL || fileAccount.email;
const PASSWORD = process.env.NEARBY_TEST_PASSWORD || fileAccount.password;

const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const d = EMAIL && PASSWORD && process.env.NEARBY_POST_DEPLOY_0375 === '1' ? describe : describe.skip;
const NIL = '00000000-0000-0000-0000-000000000000';

d('0375: the account security record is out of reach through the real API', () => {
  beforeAll(async () => {
    await require('./live/signInTestAccount').signInTestAccount(client, { email: EMAIL, password: PASSWORD });
    const probe = await client.rpc('get_my_phone_change_wait');
    if (probe.error?.code === 'PGRST202') throw new Error('0375 is not live (no get_my_phone_change_wait): do not run this yet');
  }, 30000);
  afterAll(async () => { await client.auth.signOut(); });

  test('the account asks for its own wait only (a time within 24 h of this sign-in, or null)', async () => {
    const r = await client.rpc('get_my_phone_change_wait');
    expect(r.error).toBeNull();
    if (r.data !== null) {
      const ms = new Date(r.data).getTime() - Date.now();
      expect(ms).toBeGreaterThan(0);
      expect(ms).toBeLessThanOrEqual(24 * 3600e3);
    }
  }, 30000);

  test('the admin reader is admins only', async () => {
    const r = await client.rpc('admin_get_account_security_events', { user_id_param: NIL });
    if (!r.error) throw new Error(`READ: admin_get_account_security_events answered an ordinary account (${JSON.stringify(r.data)})`);
    expect(r.error.hint).toBe('admin_only');
  }, 30000);

  test('the private functions and the table are not reachable', async () => {
    for (const [fn, args] of [['account_security_notice', { p_user: NIL, p_kind: 'phone_changed' }],
      ['purge_account_security_events', {}], ['phone_change_allowed_at', { p_last_sign_in: new Date().toISOString() }]]) {
      const r = await client.rpc(fn, args);
      if (!r.error) throw new Error(`REACHED: ${fn} answered (${JSON.stringify(r.data)})`);
    }
    const t = await client.schema('private').from('account_security_events').select('*').limit(1);
    if (!t.error) throw new Error(`READ: private.account_security_events answered (${JSON.stringify(t.data)})`);
  }, 30000);
});
