// 20270371 (staged): Verified Business can't be granted, revoked or read as an admin by an ordinary signed-in account
// through the REAL PostgREST API, and the public reader answers ids only. POST-DEPLOY ONLY (before deploy the functions don't
// exist and this fails as "not deployed"). Every call is a refusal or a read; nothing is written. Signs in to the DEDICATED
// test account (never the owner's primary account; credentials never in Git, logs or chat) and first confirms through the
// catalog that it is not an admin. Afterwards the record must be exactly as before (count + newest id).
// Any successful write (a test failing with "WROTE") = security defect: STOP the deployment sequence and report it.
//   NEARBY_POST_DEPLOY_0371=1 SUPABASE_ACCESS_TOKEN=... npx jest -c jest.live.config.js src/qa/businessVerificationSignedIn.live.js
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
const recordState = () => query(`select count(*)::int as n, coalesce(max(id), 0)::bigint as newest from private.business_verification_events`);

const ALL_PASSED = Object.fromEntries(['identity', 'authority', 'contact', 'consistency'].map((k) => [k, {
  method: k === 'contact' ? 'called_official_number' : 'site_visit', outcome: 'passed', note: 'Forged evidence attempt by a non-admin.',
}]));

const d = process.env.NEARBY_POST_DEPLOY_0371 === '1' && EMAIL && PASSWORD && MGMT_TOKEN ? describe : describe.skip;

d('20270371: Verified Business through the real signed-in API (post-deploy)', () => {
  const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let partnerIds;
  let before;
  beforeAll(async () => {
    await require('./live/signInTestAccount').signInTestAccount(client, { email: EMAIL, password: PASSWORD }); // CAPTCHA-safe
    const { data: { user } } = await client.auth.getUser();
    const row = await query(`select coalesce(is_admin, false) as admin, managed_partner_id,
      to_regprocedure('public.admin_verify_business(uuid, jsonb, text)') is not null as deployed from profiles where id = '${user.id}'`);
    if (!row || row.admin) throw new Error('the test account must exist and must NOT be an admin');
    if (!row.deployed) throw new Error('20270371 is not deployed');
    partnerIds = (await query(`select coalesce(json_agg(id), '[]'::json) as ids from brand_partners`)).ids;
    if (!partnerIds.length) throw new Error('no business to try against');
    before = await recordState();
  }, 30000);
  afterAll(async () => { await client.auth.signOut(); });

  test('verifying any business (incl. one it manages, if any) is refused', async () => {
    for (const id of partnerIds) {
      const { data, error } = await client.rpc('admin_verify_business', { partner_id_param: id, checks_param: ALL_PASSED, decision_note_param: 'Forged decision attempt.' });
      if (!error) throw new Error(`WROTE: a non-admin verified ${id} (${JSON.stringify(data)})`);
      expect(error.hint).toBe('admin_only');
    }
  }, 30000);

  test.each([
    ['admin_revoke_business_verification', (id) => ({ partner_id_param: id, reason_param: 'Forged revocation attempt.' })],
    ['admin_list_business_verifications', () => ({})],
    ['admin_business_verification_methods', () => ({})],
  ])('%s refuses a non-admin', async (fn, args) => {
    const { data, error } = await client.rpc(fn, args(partnerIds[0]));
    expect(data).toBeNull();
    expect(error && error.hint).toBe('admin_only');
  });

  test('the record and the private status are not reachable through the API', async () => {
    const r1 = await client.schema('private').from('business_verification_events').select('id').limit(1);
    expect(r1.error).toBeTruthy();
    const r2 = await client.rpc('business_verification_status', { p_partner: partnerIds[0] });
    expect(r2.error).toBeTruthy();
  });

  test('the public reader answers ids only, a subset of what was asked', async () => {
    const { data, error } = await client.rpc('get_verified_business_ids', { partner_ids: partnerIds });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    for (const id of data) expect(partnerIds).toContain(id);
  });

  test('the record is exactly as before (nothing written)', async () => {
    expect(await recordState()).toEqual(before);
  });
});
