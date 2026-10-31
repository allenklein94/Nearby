// 0373 post-deploy (user-content screening): through the REAL PostgREST API, a signed-in ordinary account can't publish
// public text that screen-user-content didn't check, and can't forge a screening.
// GATED: runs only with NEARBY_POST_DEPLOY_0373=1 AND once get_my_held_content exists (0373 live). Before that, today's
// production writes unscreened text, so the attempts below would really change the test account's profile.
// Signs in to the DEDICATED test account (owner: never the owner's primary account; credentials never in Git, logs or
// chat). Every attempt targets only that account's own rows and must be refused or change nothing. It writes NO
// gathering, community, question or comment (nothing another person could see), and never calls the classifier.
// If any attempt WRITES (a test fails with "WROTE"): that is a security defect. STOP the deployment sequence, report it,
// and the owner resets the test account's row with the service role.
// Run: NEARBY_POST_DEPLOY_0373=1 npx jest -c jest.live.config.js src/qa/ugcScreeningSignedIn.live.js
const { createClient } = require('@supabase/supabase-js');

const URL = 'https://enmosvippabmuqslzrox.supabase.co';
const KEY = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW'; // the app's own publishable key (src/services/supabase.js)
const fileAccount = (() => {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.claude', 'live-test-account.json'), 'utf8')); } catch { return {}; }
})();
const EMAIL = process.env.NEARBY_TEST_EMAIL || fileAccount.email;
const PASSWORD = process.env.NEARBY_TEST_PASSWORD || fileAccount.password;

const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const d = EMAIL && PASSWORD && process.env.NEARBY_POST_DEPLOY_0373 === '1' ? describe : describe.skip;
const PROBE = `Unscreened live probe ${Date.now()}`;

d('0373: no public text without screening through the real API', () => {
  let userId;
  let before;
  const own = async () => {
    const { data, error } = await client.from('profiles').select('bio, display_name').eq('id', userId).single();
    if (error) throw new Error(`own row unreadable: ${error.code} ${error.message}`);
    return data;
  };
  beforeAll(async () => {
    const signedIn = await require('./live/signInTestAccount').signInTestAccount(client, { email: EMAIL, password: PASSWORD });
    userId = signedIn.user.id;
    const probe = await client.rpc('get_my_held_content');
    if (probe.error?.code === 'PGRST202') throw new Error('0373 is not live (no get_my_held_content): do not run this yet');
    before = await own();
  }, 30000);
  afterAll(async () => { await client.auth.signOut(); });

  test('an unscreened bio is refused (screening_required) and nothing changes', async () => {
    const { error } = await client.from('profiles').update({ bio: PROBE }).eq('id', userId);
    expect(error?.hint).toBe('screening_required');
    const after = await own();
    if (after.bio !== before.bio) throw new Error('WROTE: the unscreened bio was saved');
  });

  test('an unscreened display name is refused and nothing changes', async () => {
    const { error } = await client.from('profiles').update({ display_name: PROBE }).eq('id', userId);
    expect(error?.hint).toBe('screening_required');
    const after = await own();
    if (after.display_name !== before.display_name) throw new Error('WROTE: the unscreened name was saved');
  });

  test('the server-only functions are refused to a signed-in account', async () => {
    const sha = 'a'.repeat(64);
    for (const [fn, args] of [
      ['record_ugc_screening', { p_user: userId, p_text_sha256: sha, p_kind: 'bio', p_is_name: false, p_risk: 'low', p_categories: [], p_languages: ['en'], p_reasoning: 'x', p_model: 'x' }],
      ['find_ugc_screening', { p_user: userId, p_text_sha256: sha, p_is_name: false }],
      ['claim_ugc_chat_batch', { p_limit: 1 }],
      ['admin_decide_held_user_content', { p_item_id: '00000000-0000-0000-0000-000000000000', p_approve: true }],
    ]) {
      const { error } = await client.rpc(fn, args);
      expect(error).toBeTruthy();
    }
  });

  test('the edge function refuses a chat batch from a signed-in account', async () => {
    const { data: s } = await client.auth.getSession();
    const r = await fetch(`${URL}/functions/v1/screen-user-content`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session.access_token}` },
      body: JSON.stringify({ mode: 'chat_batch' }),
    });
    expect(r.status).toBe(403);
  });
});
