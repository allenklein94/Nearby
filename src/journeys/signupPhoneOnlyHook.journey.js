// New accounts only by phone (migration 20270367; staged, run with it as JOURNEY_PRELUDE_FILE until live). The function
// Supabase Auth calls before creating a user: a phone sign-up passes ({}), every other new account is refused with 403.
// Payloads have the shape Auth sends (models.User as JSON: email/phone "" when absent, app_metadata.provider). Only Auth's
// own role may run it; clients and the service role may not.
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const event = (user) => JSON.stringify({ metadata: { name: 'before-user-created', ip_address: '203.0.113.7' }, user });
const CASES = {
  phone_signup: { email: '', phone: '15615550142', app_metadata: { provider: 'phone', providers: ['phone'] } },
  email_signup: { email: 'someone@example.com', phone: '', app_metadata: { provider: 'email', providers: ['email'] } },
  email_and_phone: { email: 'someone@example.com', phone: '15615550142', app_metadata: { provider: 'phone', providers: ['phone'] } },
  phone_provider_no_number: { email: '', phone: '', app_metadata: { provider: 'phone', providers: ['phone'] } },
  oauth: { email: 'someone@example.com', phone: '', app_metadata: { provider: 'google', providers: ['google'] } },
  anonymous: { email: '', phone: '', is_anonymous: true, app_metadata: {} },
  missing_user: null,
};

function call(step, user) {
  const payload = user === null ? JSON.stringify({ metadata: { name: 'before-user-created' } }) : event(user);
  return `
  begin select public.hook_before_user_created(${`'${payload.replace(/'/g, "''")}'`}::jsonb) into v_out;
  exception when others then v_out := jsonb_build_object('raised', sqlerrm); end;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}

d('journey: new accounts only by phone (20270367 before-user-created hook)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney('v_out jsonb;', `
  ${Object.entries(CASES).map(([k, u]) => call(k, u)).join('\n')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'grants', 'ok', true, 'data', jsonb_build_object(
    'auth_admin', has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute'),
    'anon', has_function_privilege('anon', 'public.hook_before_user_created(jsonb)', 'execute'),
    'authenticated', has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'execute'),
    'service_role', has_function_privilege('service_role', 'public.hook_before_user_created(jsonb)', 'execute'),
    'definer', (select prosecdef from pg_proc where oid = 'public.hook_before_user_created(jsonb)'::regprocedure))));`);
    s = stepMap(log);
  }, 120000);

  test('a phone sign-up is allowed (empty object = Auth goes ahead)', () => {
    expect(s.phone_signup.data).toEqual({});
  });

  test('every other new account is refused with 403 and plain words, never an exception', () => {
    ['email_signup', 'email_and_phone', 'phone_provider_no_number', 'oauth', 'anonymous', 'missing_user'].forEach((k) => {
      expect(s[k].data).toEqual({ error: { http_code: 403, message: 'New Nearby accounts are created with a phone number in the Nearby app.' } });
    });
  });

  test('only Supabase Auth can run it; not a definer function', () => {
    expect(s.grants.data).toEqual({ auth_admin: true, anon: false, authenticated: false, service_role: false, definer: false });
  });
});
