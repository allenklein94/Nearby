// 0349 + 0350 post-deploy (owner, 2026-10-31): an ordinary signed-in user can't give themselves ID verification (the
// "ID Verified" badge), photo screening or admin rights through the REAL PostgREST API, not SQL.
// GATED: runs only with NEARBY_POST_DEPLOY_0350=1 AND once profiles.id_verified exists (0350 live). Before that, today's
// production lets a user set its own photo_verified (the 0349 finding), so the attempts below would really write.
// Signs in to the DEDICATED test account (owner: never the owner's primary account; credentials never in Git, logs or
// chat). Every attempt targets only that account's own rows and must be refused or change nothing. No pending ID
// submission is created (that would be a real submission for an admin to review).
// If any attempt WRITES (a test fails with "WROTE"): that is a security defect. STOP the deployment sequence, report it,
// and the owner resets the test account's row with the service role (the client can't undo it by design).
// Run: NEARBY_POST_DEPLOY_0350=1 npx jest -c jest.live.config.js src/qa/verificationSelfGrantSignedIn.live.js
const { createClient } = require('@supabase/supabase-js');

const URL = 'https://enmosvippabmuqslzrox.supabase.co';
const KEY = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW'; // the app's own publishable key (src/services/supabase.js)
const fileAccount = (() => {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.claude', 'live-test-account.json'), 'utf8')); } catch { return {}; }
})();
const EMAIL = process.env.NEARBY_TEST_EMAIL || fileAccount.email;
const PASSWORD = process.env.NEARBY_TEST_PASSWORD || fileAccount.password;

const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const d = EMAIL && PASSWORD && process.env.NEARBY_POST_DEPLOY_0350 === '1' ? describe : describe.skip;

d('0349 + 0350: nobody grants themselves verification through the real API', () => {
  let userId;
  let before;
  const own = async () => {
    const { data, error } = await client.from('profiles').select('id_verified, id_verified_at, photo_verified, is_admin').eq('id', userId).single();
    if (error) throw new Error(`own row unreadable: ${error.code} ${error.message}`);
    return data;
  };
  beforeAll(async () => {
    const signedIn = await require('./live/signInTestAccount').signInTestAccount(client, { email: EMAIL, password: PASSWORD });
    userId = signedIn.user.id;
    const probe = await client.from('profiles').select('id_verified').eq('id', userId).single();
    if (probe.error?.code === '42703') throw new Error('0350 is not live (no id_verified column): do not run this yet');
    before = await own();
    // eslint-disable-next-line no-console
    console.log({ before });
    if (before.id_verified || before.is_admin) throw new Error('the test account already has id_verified / is_admin: not a valid ordinary account');
  }, 30000);
  afterAll(async () => { await client.auth.signOut(); });

  test('setting id_verified (+ its time) on the own profile changes nothing', async () => {
    const r = await client.from('profiles').update({ id_verified: true, id_verified_at: new Date().toISOString() }).eq('id', userId);
    // eslint-disable-next-line no-console
    console.log({ id_verified_attempt: r.error ? { code: r.error.code, hint: r.error.hint } : 'no error' });
    const after = await own();
    if (after.id_verified) throw new Error('WROTE: the account gave itself id_verified');
    expect(after.id_verified_at).toBe(before.id_verified_at);
  }, 30000);

  test('setting photo_verified true never sticks (only screening sets it)', async () => {
    const r = await client.from('profiles').update({ photo_verified: true }).eq('id', userId);
    const after = await own();
    // eslint-disable-next-line no-console
    console.log({ photo_verified_attempt: r.error ? { code: r.error.code, hint: r.error.hint } : 'no error', exercised: !before.photo_verified });
    if (!before.photo_verified && after.photo_verified) throw new Error('WROTE: the account marked its own photo screened');
    expect(after.photo_verified).toBe(before.photo_verified);
  }, 30000);

  test('setting is_admin changes nothing', async () => {
    await client.from('profiles').update({ is_admin: true }).eq('id', userId);
    if ((await own()).is_admin) throw new Error('WROTE: the account made itself an admin');
  }, 30000);

  test('an ID submission can\'t be filed already approved', async () => {
    const r = await client.from('id_verification_submissions').insert({
      user_id: userId, selfie_path: `${userId}/selfie.jpg`, id_photo_path: `${userId}/id.jpg`, status: 'approved',
    }).select('id');
    if (!r.error) throw new Error(`WROTE: an approved submission was accepted (${JSON.stringify(r.data)})`);
    // eslint-disable-next-line no-console
    console.log({ approved_submission_refused: { code: r.error.code, hint: r.error.hint } });
  }, 30000);

  test('an ordinary user can\'t approve an ID submission (admins only)', async () => {
    const r = await client.rpc('admin_approve_id_verification', { submission_id_param: '00000000-0000-0000-0000-000000000000', approved: true });
    expect(r.error).not.toBeNull();
    // eslint-disable-next-line no-console
    console.log({ approve_refused: { code: r.error.code, message: r.error.message } });
  }, 30000);

  test('after every attempt the account is exactly as before', async () => {
    expect(await own()).toEqual(before);
  }, 30000);
});
