// 20270364 (staged): the OpenWeather fetcher and the stall-nudge cron job are refused to a signed-in account through the
// REAL PostgREST API, not SQL. POST-DEPLOY ONLY. Calling either function while a client can still execute it would really
// run it (a 20 s OpenWeather fetch holding a connection; real "Still deciding?" pushes), so this test first asks the catalog
// (read-only, Management API) and refuses to call anything unless authenticated EXECUTE is already gone on both.
// Signs in to the DEDICATED test account (same source as plansLoadSignedIn.live.js; never the owner's primary account).
// Run after 0364 is live:
//   NEARBY_POST_DEPLOY_0364=1 SUPABASE_ACCESS_TOKEN=... npx jest -c jest.live.config.js src/qa/serverOnlyGrantsSignedIn.live.js
const { createClient } = require('@supabase/supabase-js');

const URL = 'https://enmosvippabmuqslzrox.supabase.co';
const KEY = 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW'; // the app's own publishable key (src/services/supabase.js)
const fileAccount = (() => {
  try { return JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', '.claude', 'live-test-account.json'), 'utf8')); } catch { return {}; }
})();
const EMAIL = process.env.NEARBY_TEST_EMAIL || fileAccount.email;
const PASSWORD = process.env.NEARBY_TEST_PASSWORD || fileAccount.password;
const MGMT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

const FORECAST = 'public.get_social_forecast(double precision, double precision)';
const NUDGES = 'public.send_occasion_group_plan_stall_nudges()';

async function catalog() {
  const res = await fetch('https://api.supabase.com/v1/projects/enmosvippabmuqslzrox/database/query', {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `select
      has_function_privilege('authenticated', '${FORECAST}', 'execute') as forecast_auth,
      has_function_privilege('anon', '${FORECAST}', 'execute') as forecast_anon,
      has_function_privilege('authenticated', '${NUDGES}', 'execute') as nudges_auth,
      has_function_privilege('anon', '${NUDGES}', 'execute') as nudges_anon,
      has_function_privilege('service_role', '${FORECAST}', 'execute') as forecast_service,
      has_function_privilege('service_role', '${NUDGES}', 'execute') as nudges_service,
      exists (select 1 from cron.job where jobname = 'send-occasion-group-plan-stall-nudges' and username = 'postgres' and active) as cron_job` }),
  });
  if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`);
  return (await res.json())[0];
}

const d = process.env.NEARBY_POST_DEPLOY_0364 === '1' && EMAIL && PASSWORD && MGMT_TOKEN ? describe : describe.skip;

d('20270364: server-only functions through the real signed-in API (post-deploy)', () => {
  const client = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  let grants;
  beforeAll(async () => {
    grants = await catalog();
    // Safety gate: never call a function a client can still run.
    if (grants.forecast_auth || grants.forecast_anon || grants.nudges_auth || grants.nudges_anon) {
      throw new Error('0364 is not live (a client can still execute a function): refusing to call anything');
    }
    const { error } = await client.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
    if (error) throw new Error(`sign in: ${error.message}`);
  }, 30000);
  afterAll(async () => { await client.auth.signOut(); });

  test('catalog: clients refused; service role and the cron job keep them', () => {
    expect(grants).toEqual({
      forecast_auth: false, forecast_anon: false, nudges_auth: false, nudges_anon: false,
      forecast_service: true, nudges_service: true, cron_job: true,
    });
  });

  test('signed in: both RPCs are refused (42501), nothing runs', async () => {
    const forecast = await client.rpc('get_social_forecast', { my_lat: 26.6, my_lng: -80.04 });
    const nudges = await client.rpc('send_occasion_group_plan_stall_nudges');
    expect(forecast.error?.code).toBe('42501');
    expect(nudges.error?.code).toBe('42501');
  }, 30000);

  test('signed out (publishable key only): both refused', async () => {
    const anon = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const forecast = await anon.rpc('get_social_forecast', { my_lat: 26.6, my_lng: -80.04 });
    const nudges = await anon.rpc('send_occasion_group_plan_stall_nudges');
    expect(forecast.error?.code).toBe('42501');
    expect(nudges.error?.code).toBe('42501');
  }, 30000);
});
