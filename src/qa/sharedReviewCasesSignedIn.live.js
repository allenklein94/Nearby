// 20270379 (staged): admin_get_shared_review_cases refuses a signed-in NON-admin through the REAL PostgREST API, and anon.
// POST-DEPLOY ONLY (before deploy the function doesn't exist and this fails as "not deployed"). Every call is a refusal
// with no side effect. Signs in to the DEDICATED test account (never the owner's primary account) and first confirms
// through the catalog that it is not an admin. Run after 0379 is live:
//   NEARBY_POST_DEPLOY_0379=1 SUPABASE_ACCESS_TOKEN=... npx jest -c jest.live.config.js src/qa/sharedReviewCasesSignedIn.live.js
const { createClient } = require('@supabase/supabase-js');

const URL = 'https://enmosvippabmuqslzrox.supabase.co';
const KEY = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW'; // the app's own publishable key (src/services/supabase.js)
const fileAccount = (() => {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.claude', 'live-test-account.json'), 'utf8')); } catch { return {}; }
})();
const EMAIL = process.env.NEARBY_TEST_EMAIL || fileAccount.email;
const PASSWORD = process.env.NEARBY_TEST_PASSWORD || fileAccount.password;
const MGMT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

async function query(sql) {
  const res = await fetch('https://api.supabase.com/v1/projects/enmosvippabmuqslzrox/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`);
  return (await res.json())[0];
}

const d = process.env.NEARBY_POST_DEPLOY_0379 === '1' && EMAIL && PASSWORD && MGMT_TOKEN ? describe : describe.skip;

d('20270379: shared review cases through the real signed-in API (post-deploy)', () => {
  const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const client = createClient(URL, KEY, opts);
  const anon = createClient(URL, KEY, opts);
  const someId = '00000000-0000-4000-8000-000000000000';
  beforeAll(async () => {
    await require('./live/signInTestAccount').signInTestAccount(client, { email: EMAIL, password: PASSWORD }); // CAPTCHA-safe
    const { data: { user } } = await client.auth.getUser();
    const row = await query(`select coalesce(is_admin, false) as admin,
      to_regprocedure('public.admin_get_shared_review_cases(uuid)') is not null as deployed from profiles where id = '${user.id}'`);
    if (!row || row.admin) throw new Error('the test account must exist and must NOT be an admin');
    if (!row.deployed) throw new Error('20270379 is not deployed');
  }, 30000);
  afterAll(async () => { await client.auth.signOut(); });

  test('a signed-in non-admin is refused (admin_only), nothing returned', async () => {
    const { data, error } = await client.rpc('admin_get_shared_review_cases', { case_id_param: someId });
    expect(data).toBeNull();
    expect(error && error.hint).toBe('admin_only');
  });

  test('anon is refused', async () => {
    const { data, error } = await anon.rpc('admin_get_shared_review_cases', { case_id_param: someId });
    expect(data).toBeNull();
    expect(error).toBeTruthy();
  });
});
