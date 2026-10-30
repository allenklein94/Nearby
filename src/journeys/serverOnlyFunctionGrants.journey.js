// Server-only functions (migration 20270364; staged, run with 0348-0364 as JOURNEY_PRELUDE_FILE until live). The final gap
// audit (2026-10-30) found two that any signed-in account could execute: the unused OpenWeather fetcher (holds a database
// connection up to 20 s per call) and the stall-nudge cron job. After 20270364 a client is refused; cron (postgres) and
// service_role keep them.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

d('journey: server-only functions (20270364)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares(['v_a'])} v_out jsonb;`, `
  ${actorsSql({ people: ['v_a'] })}
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform send_occasion_group_plan_stall_nudges(); v_out := '"ran"'::jsonb;
  exception when others then v_out := to_jsonb(sqlerrm); end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'client_nudges', 'ok', true, 'data', v_out));
  log := log || jsonb_build_array(jsonb_build_object('step', 'grants', 'ok', true, 'data', jsonb_build_object(
    'forecast_auth', has_function_privilege('authenticated', 'public.get_social_forecast(double precision, double precision)', 'execute'),
    'forecast_anon', has_function_privilege('anon', 'public.get_social_forecast(double precision, double precision)', 'execute'),
    'nudges_auth', has_function_privilege('authenticated', 'public.send_occasion_group_plan_stall_nudges()', 'execute'),
    'nudges_anon', has_function_privilege('anon', 'public.send_occasion_group_plan_stall_nudges()', 'execute'),
    'forecast_service', has_function_privilege('service_role', 'public.get_social_forecast(double precision, double precision)', 'execute'),
    'nudges_service', has_function_privilege('service_role', 'public.send_occasion_group_plan_stall_nudges()', 'execute'),
    'cron_job', exists (select 1 from cron.job where jobname = 'send-occasion-group-plan-stall-nudges' and username = 'postgres'))));`);
    s = stepMap(log);
  }, 120000);

  test('a signed-in account can no longer run either function', () => {
    expect(s.client_nudges.data).toMatch(/permission denied/);
    expect(s.grants.data).toMatchObject({ forecast_auth: false, forecast_anon: false, nudges_auth: false, nudges_anon: false });
  });

  test('the cron job and the service role keep them', () => {
    expect(s.grants.data).toMatchObject({ forecast_service: true, nudges_service: true, cron_job: true });
  });
});
