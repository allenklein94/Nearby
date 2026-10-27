// N1 (20270347, LIVE 2026-10-27): no signed-in user reads anyone's push or Spotify tokens through the REAL PostgREST API, not SQL.
// READ-ONLY: signs in to a DEDICATED test account (owner: never the owner's primary account; credentials never in Git, logs or chat),
// runs only SELECTs / a refused RPC, then signs out. No app table is written; the only writes are Supabase Auth's own sign-in/sign-out
// bookkeeping. Token values are never printed: only whether they are null.
// Run: npx jest -c jest.live.config.js src/qa/pushTokenPrivacySignedIn.live.js   (skips when no account is given)
const { createClient } = require('@supabase/supabase-js');

const URL = 'https://enmosvippabmuqslzrox.supabase.co';
const KEY = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW'; // the app's own publishable key (src/services/supabase.js)
// Credentials: same source as plansLoadSignedIn.live.js (env var preferred, else the gitignored .claude/live-test-account.json).
const fileAccount = (() => {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.claude', 'live-test-account.json'), 'utf8')); } catch { return {}; }
})();
const EMAIL = process.env.NEARBY_TEST_EMAIL || fileAccount.email;
const PASSWORD = process.env.NEARBY_TEST_PASSWORD || fileAccount.password;

const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
const TOKEN_COLUMNS = ['expo_push_token', 'spotify_access_token', 'spotify_refresh_token', 'spotify_token_expires_at'];

const d = EMAIL && PASSWORD ? describe : describe.skip;

d('N1: tokens through the real signed-in API (read-only)', () => {
  let userId;
  beforeAll(async () => {
    const { data, error } = await client.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error) throw new Error(`sign in: ${error.message}`);
    userId = data.user.id;
  }, 30000);
  afterAll(async () => { await client.auth.signOut(); });

  const leaked = (rows) => (rows || []).filter((r) => TOKEN_COLUMNS.some((c) => r[c] != null)).length;

  test('profiles: every readable row (other people and own, incl. select *) has no token', async () => {
    const named = await client.from('profiles').select(`id, ${TOKEN_COLUMNS.join(', ')}`);
    expect(named.error).toBeNull();
    const star = await client.from('profiles').select('*');
    expect(star.error).toBeNull();
    // eslint-disable-next-line no-console
    console.log({ profilesReadable: named.data.length, othersReadable: named.data.filter((r) => r.id !== userId).length });
    expect(leaked(named.data)).toBe(0);
    expect(leaked(star.data)).toBe(0);
  }, 30000);

  test('people_visible_to_me: no token on any row', async () => {
    const { data, error } = await client.from('people_visible_to_me').select(`id, ${TOKEN_COLUMNS.join(', ')}`);
    expect(error).toBeNull();
    expect(leaked(data)).toBe(0);
  }, 30000);

  test('the token reader and the private store are refused', async () => {
    const rpc = await client.rpc('push_token_for_delivery', { recipient_param: userId });
    expect(rpc.error?.code).toBe('42501');
    const store = await client.schema('private').from('push_tokens').select('*');
    expect(store.data ?? null).toBeNull();
    expect(store.error?.code).toBe('PGRST106');
  }, 30000);

  test('spotify_connections: only the caller\'s own row, never another person\'s', async () => {
    const { data, error } = await client.from('spotify_connections').select('user_id');
    expect(error).toBeNull();
    expect((data || []).filter((r) => r.user_id !== userId)).toEqual([]);
  }, 30000);
});
