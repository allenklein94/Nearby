// Idea "397" follow-up (owner, 2026-10-24): the Plans load path through the REAL PostgREST API with a real signed-in JWT, not SQL.
// READ-ONLY: signs in to a DEDICATED test account (owner: never the owner's primary account; credentials never in Git, logs or chat), runs exactly the reads
// PlansScreen runs (its first load + focus reload: the same service functions, unmodified), then signs out. No app table is written;
// the only writes are Supabase Auth's own sign-in/sign-out bookkeeping (a session + refresh token, revoked at sign-out; last_sign_in_at).
// Run: npx jest -c jest.live.config.js src/qa/plansLoadSignedIn.live.js   (skips when no account is given)
// Not part of `npx jest` (no .test.js suffix). Native modules = inert stubs (jest.live.config.js); a call to one fails the run.
const { createClient } = require('@supabase/supabase-js');

const URL = 'https://enmosvippabmuqslzrox.supabase.co';
const KEY = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW'; // the app's own publishable key (src/services/supabase.js)
// Credentials: a temporary environment variable (preferred), else the gitignored .claude/live-test-account.json ({"email": "...", "password": "..."}), which the
// owner writes in an editor so the password never appears in a command line, the chat or the repo.
const fileAccount = (() => {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.claude', 'live-test-account.json'), 'utf8')); } catch { return {}; }
})();
const EMAIL = process.env.NEARBY_TEST_EMAIL || fileAccount.email;
const PASSWORD = process.env.NEARBY_TEST_PASSWORD || fileAccount.password;

// The services import `./supabase` (React Native storage): the same client, Node storage, no persistence.
const mockClient = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
jest.mock('../services/supabase', () => ({ supabase: mockClient, functionUrl: (n) => `https://enmosvippabmuqslzrox.supabase.co/functions/v1/${n}` }));

const { getMyAttendingGatherings, getMyGatherings, getMyInterestedGatherings } = require('../services/gatherings');
const { getMyGroupPlans } = require('../services/groupPlans');
const { getMyStandaloneBusinessRequestPlans, getMyDateProposalPlans, getMyExperiencePlans, getSharedExperiencePlans } = require('../services/plans');
const { businessPlanPlacement } = require('../utils/planHistory');

const d = EMAIL && PASSWORD ? describe : describe.skip;

d('Plans load path through the real signed-in API (read-only)', () => {
  let userId;
  beforeAll(async () => {
    const { data, error } = await mockClient.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error) throw new Error(`sign in: ${error.message}`);
    userId = data.user.id;
  }, 30000);
  afterAll(async () => { await mockClient.auth.signOut(); });

  test('signed in as an authenticated user', () => {
    expect(userId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('every PlansScreen read succeeds (first load + focus reload): no error, expected shapes back', async () => {
    const reads = {
      getMyAttendingGatherings, getMyGatherings, getMyGroupPlans, getMyStandaloneBusinessRequestPlans,
      getMyDateProposalPlans, getMyExperiencePlans, getMyInterestedGatherings, getSharedExperiencePlans,
    };
    const out = {};
    // several readers swallow a failed query (console.error + empty result), so any console.error fails the read
    const logged = [];
    const spy = jest.spyOn(console, 'error').mockImplementation((...args) => { logged.push(args.map(String).join(' ')); });
    try {
      for (const [name, fn] of Object.entries(reads)) {
        try { out[name] = await fn(); } catch (e) { out[name] = { error: e.message }; }
      }
    } finally { spy.mockRestore(); }
    // getMyAttendingGatherings returns { upcoming, past } (PlansScreen reads it that way); everything else an array
    const shapeOk = (v) => Array.isArray(v) || (v && Array.isArray(v.upcoming) && Array.isArray(v.past));
    const summary = (v) => (Array.isArray(v) ? `${v.length} rows` : shapeOk(v) ? `${v.upcoming.length} upcoming / ${v.past.length} past` : v);
    // eslint-disable-next-line no-console
    console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, summary(v)])));
    expect(logged).toEqual([]);
    for (const [name, v] of Object.entries(out)) expect([name, shapeOk(v) ? 'ok' : v]).toEqual([name, 'ok']);
    // the rule accepts whatever came back (no throw); rows are only the caller's own (RLS)
    for (const row of out.getMyStandaloneBusinessRequestPlans) businessPlanPlacement(row, new Date());
  }, 60000);

  test('the old self-embed is refused by the same signed-in API (why the fix was needed)', async () => {
    const { error } = await mockClient.from('plans').select('id, parent:plans!plans_parent_plan_id_fkey(plan_type)').limit(1);
    expect(error?.code).toBe('PGRST200');
  });
});
