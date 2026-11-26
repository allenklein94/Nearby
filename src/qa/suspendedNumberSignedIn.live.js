// 0374 post-deploy (suspended-number retention, owner 2026-10-31): through the REAL API, an ordinary signed-in account can't
// reach any of it: the retained records, the queue, the secret, the key function, the matcher and the earlier-decision
// reader are all out of reach, and the account's own profile carries nothing new. READ-ONLY: nothing is written (every
// call is one that must be refused, or a read of the account's own row).
// GATED: runs only with NEARBY_POST_DEPLOY_0374=1 AND once 0374 is live (admin_get_prior_suspension exists; before it,
// PostgREST answers "function not found" for every call and the test would prove nothing).
// Signs in to the DEDICATED test account (owner: never the owner's primary account; credentials never in Git, logs or chat).
// Anything that returns data = a security defect: STOP the deployment sequence and report it.
// The full story (suspend -> delete -> sign up again by SMS -> private case for an admin) is the manual post-deploy step in
// scripts/live-verify/post-deploy.js (a controlled real phone sign-up), never this file.
// Run: NEARBY_POST_DEPLOY_0374=1 npx jest -c jest.live.config.js src/qa/suspendedNumberSignedIn.live.js
const { createClient } = require('@supabase/supabase-js');

const URL = 'https://enmosvippabmuqslzrox.supabase.co';
const KEY = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW'; // the app's own publishable key (src/services/supabase.js)
const fileAccount = (() => {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.claude', 'live-test-account.json'), 'utf8')); } catch { return {}; }
})();
const EMAIL = process.env.NEARBY_TEST_EMAIL || fileAccount.email;
const PASSWORD = process.env.NEARBY_TEST_PASSWORD || fileAccount.password;

const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const d = EMAIL && PASSWORD && process.env.NEARBY_POST_DEPLOY_0374 === '1' ? describe : describe.skip;
const NIL = '00000000-0000-0000-0000-000000000000';

d('0374: suspended-number records are out of reach through the real API', () => {
  let userId;
  beforeAll(async () => {
    const signedIn = await require('./live/signInTestAccount').signInTestAccount(client, { email: EMAIL, password: PASSWORD });
    userId = signedIn.user.id;
    const probe = await client.rpc('admin_get_prior_suspension', { case_id_param: NIL });
    if (probe.error?.code === 'PGRST202') throw new Error('0374 is not live (no admin_get_prior_suspension): do not run this yet');
  }, 30000);
  afterAll(async () => { await client.auth.signOut(); });

  test('the earlier-decision reader is admins only', async () => {
    const r = await client.rpc('admin_get_prior_suspension', { case_id_param: NIL });
    if (!r.error) throw new Error(`READ: admin_get_prior_suspension answered an ordinary account (${JSON.stringify(r.data)})`);
    expect(r.error.hint).toBe('admin_only');
  }, 30000);

  test('the private functions are not reachable at all', async () => {
    for (const [fn, args] of [['match_suspended_numbers', {}], ['phone_number_key', { p_phone: '15615550190' }],
      ['retain_suspended_account', { p_user: NIL, p_phone: '1', p_phone_confirmed: true, p_released: 'account_deleted' }],
      ['purge_suspended_account_records', {}]]) {
      const r = await client.rpc(fn, args);
      if (!r.error) throw new Error(`REACHED: ${fn} answered (${JSON.stringify(r.data)})`);
    }
  }, 30000);

  test('the private tables are not exposed through the API', async () => {
    for (const t of ['suspended_account_records', 'phone_match_queue', 'phone_match_secret', 'suspended_number_failures']) {
      const r = await client.schema('private').from(t).select('*').limit(1);
      if (!r.error) throw new Error(`READ: private.${t} answered (${JSON.stringify(r.data)})`);
    }
  }, 30000);

  test('the review queue stays admins only, and the own profile has no new field about any of it', async () => {
    const r = await client.rpc('admin_list_account_review_cases', { include_closed_param: true });
    if (!r.error) throw new Error('READ: admin_list_account_review_cases answered an ordinary account');
    const own = await client.rpc('get_my_profile');
    expect(own.error).toBeNull();
    const keys = Object.keys((own.data || [])[0] || {});
    expect(keys.filter((k) => /prior|phone_key|retain|match_queue/.test(k))).toEqual([]);
    expect(((own.data || [])[0] || {}).id).toBe(userId);
  }, 30000);
});
