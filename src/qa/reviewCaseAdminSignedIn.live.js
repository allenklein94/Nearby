// 20270368 + 20270369 (staged): the admin review functions refuse a signed-in NON-admin through the REAL PostgREST API, and
// the hash recorder refuses every client. POST-DEPLOY ONLY (before deploy the functions don't exist and this fails as
// "not deployed"). Every call here is a refusal with no side effect. Signs in to the DEDICATED test account (same source
// as plansLoadSignedIn.live.js; never the owner's primary account) and first confirms through the catalog that it is not
// an admin. Run after 0368 + 0369 are live:
//   NEARBY_POST_DEPLOY_0369=1 SUPABASE_ACCESS_TOKEN=... npx jest -c jest.live.config.js src/qa/reviewCaseAdminSignedIn.live.js
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

const d = process.env.NEARBY_POST_DEPLOY_0369 === '1' && EMAIL && PASSWORD && MGMT_TOKEN ? describe : describe.skip;

d('20270368 + 20270369: admin review through the real signed-in API (post-deploy)', () => {
  const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const someId = '00000000-0000-4000-8000-000000000000';
  beforeAll(async () => {
    await require('./live/signInTestAccount').signInTestAccount(client, { email: EMAIL, password: PASSWORD }); // CAPTCHA-safe
    const { data: { user } } = await client.auth.getUser();
    const row = await query(`select coalesce(is_admin, false) as admin,
      to_regprocedure('public.admin_get_account_review_case(uuid)') is not null as deployed from profiles where id = '${user.id}'`);
    if (!row || row.admin) throw new Error('the test account must exist and must NOT be an admin');
    if (!row.deployed) throw new Error('20270369 is not deployed');
  }, 30000);
  afterAll(async () => { await client.auth.signOut(); });

  test.each([
    ['admin_list_account_review_cases', { include_closed_param: true }],
    ['admin_get_account_review_case', { case_id_param: someId }],
    ['admin_reopen_account_review_case', { case_id_param: someId, reason_param: 'Trying to reopen without being an admin' }],
    ['admin_close_account_review_case', { case_id_param: someId, outcome_param: 'no_action' }],
    ['admin_add_account_review_note', { case_id_param: someId, note_param: 'x' }],
    ['admin_record_case_external_check', { case_id_param: someId, source_param: 'x', result_param: 'no_match' }],
    ['admin_open_case_from_report', { report_id_param: someId }],
  ])('%s refuses a non-admin', async (fn, args) => {
    const { data, error } = await client.rpc(fn, args);
    expect(data).toBeNull();
    expect(error && error.hint).toBe('admin_only');
  });

  test('the hash recorder refuses every client', async () => {
    const { data: { user } } = await client.auth.getUser();
    const { error } = await client.rpc('record_photo_perceptual_hashes', { p_user: user.id, p_object_id: someId, p_hashes: [] });
    expect(error).toBeTruthy();
    expect(error.code === '42501' || error.code === 'PGRST202').toBe(true); // denied, or hidden from the API altogether
  });

  test('admin_review_photo_visible is false for a non-admin', async () => {
    const { data, error } = await client.rpc('admin_review_photo_visible', { p_object_id: someId });
    expect(error).toBeNull();
    expect(data).toBe(false);
  });
});
