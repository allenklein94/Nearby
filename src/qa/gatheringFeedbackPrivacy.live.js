// Post-deploy check for 20270408 through the REAL production API with a real signed-in JWT. READ-ONLY: signs in to a DEDICATED test
// account (never the owner's primary account; credentials as in plansLoadSignedIn.live.js), reads, signs out. No app table is written.
// Run: npx jest -c jest.live.config.js src/qa/gatheringFeedbackPrivacy.live.js   (skips when no account is given)
// FAILS before 20270408 is deployed while another person's rating exists, which is the point. Passing with no other rating in the
// table proves nothing: the test says so instead of passing quietly (it needs at least one rating by someone else in production).
const { createClient } = require('@supabase/supabase-js');

const URL = 'https://enmosvippabmuqslzrox.supabase.co';
const KEY = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW'; // the app's own publishable key
const fileAccount = (() => {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.claude', 'live-test-account.json'), 'utf8')); } catch { return {}; }
})();
const EMAIL = process.env.NEARBY_TEST_EMAIL || fileAccount.email;
const PASSWORD = process.env.NEARBY_TEST_PASSWORD || fileAccount.password;
const OTHER_RATINGS_EXPECTED = Number(process.env.NEARBY_OTHER_RATINGS_ON_PROD || 0);

const d = EMAIL && PASSWORD ? describe : describe.skip;

d('gathering ratings through the real signed-in API (read-only)', () => {
  const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let me;
  beforeAll(async () => {
    const { data, error } = await client.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error) throw error;
    me = data.user.id;
  });
  afterAll(() => client.auth.signOut());

  it('the deployer states how many ratings by other people exist (read with the service role), so an empty table cannot pass as proof', () => {
    expect(OTHER_RATINGS_EXPECTED).toBeGreaterThan(0);
  });

  it('every readable row is the account\'s own, unfiltered and through an embed', async () => {
    const { data, error } = await client.from('gathering_feedback').select('reviewer_id');
    expect(error).toBeNull();
    expect((data ?? []).filter((r) => r.reviewer_id !== me)).toEqual([]);
    const embed = await client.from('gatherings').select('id, gathering_feedback(reviewer_id)').limit(200);
    expect(embed.error).toBeNull();
    const others = (embed.data ?? []).flatMap((g) => g.gathering_feedback ?? []).filter((r) => r.reviewer_id !== me);
    expect(others).toEqual([]);
  });

  it('a signed-out caller reads nothing', async () => {
    const anon = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data } = await anon.from('gathering_feedback').select('reviewer_id');
    expect(data ?? []).toEqual([]);
  });
});
