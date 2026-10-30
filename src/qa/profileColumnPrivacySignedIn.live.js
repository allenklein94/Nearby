// N6 (20270348, NOT LIVE until the owner approves the deploy): through the REAL PostgREST API, a signed-in user reads only
// other people's PUBLIC profile columns; the own whole row comes from get_my_profile(); signed out reads nothing.
// READ-ONLY: signs in to the DEDICATED test account (owner: never the owner's primary account; credentials never in Git, logs or
// chat), runs only SELECTs / RPC reads, then signs out. No app table is written. Values are never printed, only counts / codes.
// State-aware: before 20270348 is live (get_my_profile missing, PGRST202) it asserts today's exposure instead (another
// person's birthdate reads), so the same run shows before/after. Own-row edits + sign-up are covered by the journeys
// (profileColumnPrivacy, appVersionCompatibility), not here (no writes).
// Run: npx jest -c jest.live.config.js src/qa/profileColumnPrivacySignedIn.live.js   (skips when no account is given)
const { createClient } = require('@supabase/supabase-js');
const { PUBLIC_PROFILE_COLUMNS } = require('../constants/publicProfileColumns');

const URL = 'https://enmosvippabmuqslzrox.supabase.co';
const KEY = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW'; // the app's own publishable key (src/services/supabase.js)
const fileAccount = (() => {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.claude', 'live-test-account.json'), 'utf8')); } catch { return {}; }
})();
const EMAIL = process.env.NEARBY_TEST_EMAIL || fileAccount.email;
const PASSWORD = process.env.NEARBY_TEST_PASSWORD || fileAccount.password;

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const client = createClient(URL, KEY, opts);
const signedOut = createClient(URL, KEY, opts);
// A sample of private columns (every one is checked one by one in the journey).
const PRIVATE_SAMPLE = ['birthdate', 'gender_hidden', 'timezone', 'wide_area', 'is_admin', 'managed_partner_id', 'onboarding_motivations',
  'cuisine_preferences', 'referral_code', 'notification_mutes', 'last_home_visit'];

const d = EMAIL && PASSWORD ? describe : describe.skip;

d('N6: profile columns through the real signed-in API (read-only)', () => {
  let userId;
  let n6;
  beforeAll(async () => {
    const signedIn = await require('./live/signInTestAccount').signInTestAccount(client, { email: EMAIL, password: PASSWORD }); // CAPTCHA-safe
    userId = signedIn.user.id;
    const probe = await client.rpc('get_my_profile').select('id');
    n6 = !(probe.error && (probe.error.code === 'PGRST202' || probe.error.code === '42883'));
    // eslint-disable-next-line no-console
    console.log({ n6Live: n6 });
  }, 30000);
  afterAll(async () => { await client.auth.signOut(); });

  test('public columns of other people read (the pass is meaningful only if others are visible)', async () => {
    const { data, error } = await client.from('profiles').select(PUBLIC_PROFILE_COLUMNS.join(', '));
    expect(error).toBeNull();
    expect(data.filter((r) => r.id !== userId).length).toBeGreaterThan(0);
  }, 30000);

  test("another person's private columns: refused after N6 (select *, each sampled column); readable before it", async () => {
    const star = await client.from('profiles').select('*').neq('id', userId).limit(5);
    const results = {};
    for (const c of PRIVATE_SAMPLE) {
      const r = await client.from('profiles').select(`id, ${c}`).neq('id', userId).limit(5);
      results[c] = r.error ? r.error.code : `rows:${r.data.length}`;
    }
    // eslint-disable-next-line no-console
    console.log({ star: star.error ? star.error.code : `rows:${star.data.length}`, results });
    if (n6) {
      expect(star.error?.code).toBe('42501');
      for (const c of PRIVATE_SAMPLE) expect([c, results[c]]).toEqual([c, '42501']);
    } else {
      expect(star.error).toBeNull();
      expect(star.data.length).toBeGreaterThan(0); // today's exposure (the N6 finding)
    }
  }, 60000);

  test('own row: get_my_profile() returns only the caller, with private columns', async () => {
    if (!n6) return;
    const { data, error } = await client.rpc('get_my_profile').select('id, birthdate, timezone');
    expect(error).toBeNull();
    expect(data.map((r) => r.id)).toEqual([userId]);
  }, 30000);

  test('people views: no birthdate or other private column; hidden switches never exposed', async () => {
    if (!n6) return;
    for (const view of ['people_visible_to_me', 'dating_candidates_visible_to_me']) {
      const { data, error } = await client.from(view).select('*').limit(20);
      expect([view, error]).toEqual([view, null]);
      const cols = new Set((data || []).flatMap((r) => Object.keys(r)));
      for (const c of PRIVATE_SAMPLE) expect([view, c, cols.has(c)]).toEqual([view, c, false]);
      const bd = await client.from(view).select('id, birthdate').limit(1);
      expect([view, bd.error?.code]).toEqual([view, '42703']);
    }
  }, 60000);

  test("a non-friend's dining answers: nothing", async () => {
    if (!n6) return;
    const { data: others } = await client.from('profiles').select('id').neq('id', userId).limit(1);
    const { data, error } = await client.rpc('get_friend_dining_preferences', { p_friend: others[0].id });
    expect(error).toBeNull();
    // The test account has no accepted friends (if it ever does, pick a non-friend here).
    expect(data).toEqual([]);
  }, 30000);

  test('signed out: profiles, both views and get_my_profile refused', async () => {
    const p = await signedOut.from('profiles').select('id').limit(1);
    expect(p.error?.code).toBe('42501');
    if (!n6) return;
    for (const view of ['people_visible_to_me', 'dating_candidates_visible_to_me']) {
      const v = await signedOut.from(view).select('id').limit(1);
      expect([view, v.error?.code]).toEqual([view, '42501']);
    }
    const rpc = await signedOut.rpc('get_my_profile');
    expect(rpc.error?.code).toBe('42501');
  }, 30000);
});
