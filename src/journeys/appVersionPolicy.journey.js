// Minimum supported app version (20270434, STAGED). Through the real PostgREST pre-request hook and the real roles, in one
// rolled-back transaction: enforcement off = nothing refused; enforcing a minimum above the newest AVAILABLE build is
// impossible; once enforced, a build below it is refused before anything runs (header from build 88 on, or the native
// "Nearby/<build>" user agent builds <= 87 already send, signed in or out), the policy read itself always passes, other
// platforms and unidentified clients are untouched, a forged higher build gains nothing beyond passing the version check,
// the business-location check still runs after it, a broken config fails OPEN, and lowering / switching off always works.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;
const rec = (step, expr) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', ${expr}));`;
const anon = `perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); set local role anon;`;
const signedIn = `perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  set local role authenticated;`;
const server = `reset role; perform set_config('request.jwt.claims', '', true);`;
// one request: headers (a SQL json-text expression) + path, through the hook
const req = (step, headers, path = '/rpc/get_my_plans_this_month') => `perform set_config('request.headers', ${headers}, true);
    perform set_config('request.path', '${path}', true);
  begin
    perform public.nearby_pre_request();
    ${rec(step, `jsonb_build_object('result', 'allowed')`)}
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    ${rec(step, `jsonb_build_object('result', 'refused', 'hint', v_hint)`)}
  end;`;
const hdr = (build, platform = 'ios', extra = '') => `json_build_object('x-nearby-build', '${build}', 'x-nearby-platform', '${platform}'${extra})::text`;
const ua = (s) => `json_build_object('user-agent', '${s}')::text`;
const OLD_IOS = 'Nearby/87 CFNetwork/3826.500.111 Darwin/25.0.0';
const tryPolicy = (step, sql) => `begin
    ${sql}
    ${rec(step, `jsonb_build_object('result', 'allowed')`)}
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    ${rec(step, `jsonb_build_object('result', 'refused', 'hint', v_hint)`)}
  end;`;

d('journey: an app build below an enforced minimum is refused by the server, and only then', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney('v_hint text; v_p jsonb; v_n int;', `
  ${server}
  -- 1. installed state: enforcement off everywhere, nothing refused
  ${anon}
  ${req('off_old_header', hdr(1))}
  ${req('off_old_ua', ua(OLD_IOS))}
  ${server}
  -- 2. a mandatory minimum needs that build to be AVAILABLE first
  ${tryPolicy('enforce_unavailable', `update private.app_version_policy set min_supported_build = 90, latest_build = 90, enforced = true where platform = 'ios';`)}
  insert into private.app_build_availability (platform, build, channel, recorded_by, evidence)
    values ('ios', 90, 'testflight', 'journey', 'journey fixture');
  ${tryPolicy('enforce_available', `update private.app_version_policy set min_supported_build = 90, latest_build = 90, enforced = true,
      update_url = 'itms-beta://testflight.apple.com/v1/app/0' where platform = 'ios';`)}
  ${tryPolicy('raise_above_available', `update private.app_version_policy set min_supported_build = 91 where platform = 'ios';`)}
  ${tryPolicy('latest_unavailable', `update private.app_version_policy set latest_build = 92 where platform = 'ios';`)}
  ${tryPolicy('store_link_testflight_only', `update private.app_version_policy set update_url = 'itms-apps://apps.apple.com/app/id0' where platform = 'ios';`)}
  ${tryPolicy('staging_link_not_on_staging', `update private.app_version_policy set update_url = 'https://expo.dev/accounts/x/projects/y/builds/z' where platform = 'ios';`)}
  insert into private.app_build_availability (platform, build, channel, recorded_by, evidence)
    values ('android', 5, 'google_play', 'journey', 'journey fixture');
  ${tryPolicy('enforce_without_link', `update private.app_version_policy set min_supported_build = 5, enforced = true where platform = 'android';`)}
  ${tryPolicy('web_not_on_website', `update private.app_version_policy set min_supported_build = 3, enforced = true where platform = 'web';`)}
  ${tryPolicy('bad_url', `update private.app_version_policy set update_url = 'javascript:alert(1)' where platform = 'ios';`)}
  -- 3. enforced: below = refused, at / above = allowed, signed out and signed in
  ${anon}
  ${req('anon_89', hdr(89))}
  ${req('anon_90', hdr(90))}
  ${req('anon_91', hdr(91))}
  ${req('anon_old_ua', ua(OLD_IOS))}
  ${req('anon_policy_read_old', ua(OLD_IOS), '/rpc/get_app_version_policy')}
  v_p := public.get_app_version_policy('ios');
  ${rec('policy_ios', 'v_p')}
  v_p := public.get_app_version_policy('android');
  ${rec('policy_android', 'v_p')}
  ${req('android_1', hdr(1, 'android'))}
  ${req('web_1', hdr(1, 'web'))}
  ${req('browser', ua('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15'))}
  ${req('no_headers', `'{}'`)}
  ${req('malformed_header_old_ua', `json_build_object('x-nearby-build', 'abc', 'x-nearby-platform', 'ios', 'user-agent', '${OLD_IOS}')::text`)}
  ${req('ua_without_darwin', ua('Nearby/87'))}
  ${req('probe_89', hdr(89), '/rpc/app_version_ok')}
  ${req('probe_90', hdr(90), '/rpc/app_version_ok')}
  ${tryPolicy('probe_runs_as_anon', `perform public.app_version_ok();`)}
  ${server}
  -- 3b. strict mode: unidentified / malformed clients refused too; server callers + the policy read still pass
  update private.app_version_settings set refuse_unidentified = true, updated_by = 'journey';
  ${anon}
  ${req('strict_browser', ua('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15'))}
  ${req('strict_no_headers', `'{}'`)}
  ${req('strict_malformed', `json_build_object('x-nearby-build', 'abc', 'x-nearby-platform', 'ios')::text`)}
  ${req('strict_unknown_platform', hdr(95, 'windows'))}
  ${req('strict_identified_95', hdr(95))}
  ${req('strict_policy_read', `'{}'`, '/rpc/get_app_version_policy')}
  ${server}
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  ${req('strict_service_role', `'{}'`)}
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.headers', '{not json', true);
  perform set_config('request.path', '/rpc/x', true);
  ${tryPolicy('strict_gate_bad_json', `perform private._app_version_gate();`)}
  update private.app_version_settings set refuse_unidentified = false, updated_by = 'journey';
  ${anon}
  ${req('strict_off_browser', ua('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15'))}
  ${signedIn}
  ${req('signed_in_old_ua', ua(OLD_IOS))}
  ${req('signed_in_write_old', hdr(80), '/rpc/set_business_operating_hours')}
  -- 4. a forged higher build passes the VERSION check only: the business-location check still runs after it, and no
  --    private data opens up
  ${req('forged_high_then_business_check', hdr(999999, 'ios', `, 'x-nearby-business', 'not-a-uuid'`), '/rpc/set_business_operating_hours')}
  ${tryPolicy('forged_reads_private', `select count(*) into v_n from private.app_version_policy;`)}
  ${tryPolicy('client_writes_policy', `update private.app_version_policy set enforced = false;`)}
  ${tryPolicy('client_calls_gate', `perform private._app_version_gate();`)}
  ${server}
  -- 5. fail open: unreadable headers never lock anyone out of the version check
  perform set_config('request.headers', '{not json', true);
  perform set_config('request.path', '/rpc/x', true);
  ${tryPolicy('gate_bad_json', `perform private._app_version_gate();`)}
  -- the build's availability record disappears (mistake, cleanup): recovery below must still go through
  delete from private.app_build_availability where platform = 'ios' and build = 90;
  -- 6. emergency recovery: lowering and switching off are always allowed and take effect on the next request
  ${tryPolicy('lower_to_80', `update private.app_version_policy set min_supported_build = 80 where platform = 'ios';`)}
  ${anon}
  ${req('after_lower_old_ua', ua(OLD_IOS))}
  ${req('after_lower_79', hdr(79))}
  ${server}
  ${tryPolicy('switch_off', `update private.app_version_policy set enforced = false where platform = 'ios';`)}
  ${anon}
  ${req('after_off_79', hdr(79))}
  v_p := public.get_app_version_policy('ios');
  ${rec('policy_after_off', 'v_p')}
  ${server}
  select count(*) into v_n from private.app_version_policy_log where platform = 'ios';
  ${rec('log_rows', `to_jsonb(v_n)`)}
  select count(*) into v_n from private.app_version_policy_log where platform = '*';
  ${rec('settings_log_rows', `to_jsonb(v_n)`)}
`);
    s = stepMap(log);
  }, 120000);

  const res = (k) => s[k]?.data?.result;
  const hint = (k) => s[k]?.data?.hint;

  test('installed state: enforcement off, nothing refused', () => {
    expect(res('off_old_header')).toBe('allowed');
    expect(res('off_old_ua')).toBe('allowed');
  });
  test('a minimum can be enforced only up to the newest available build', () => {
    expect(res('enforce_unavailable')).toBe('refused');
    expect(hint('enforce_unavailable')).toBe('build_not_available');
    expect(res('enforce_available')).toBe('allowed');
    expect(res('raise_above_available')).toBe('refused');
    expect(hint('raise_above_available')).toBe('build_not_available');
    expect(res('bad_url')).toBe('refused');
    expect(res('latest_unavailable')).toBe('refused');
    expect(hint('latest_unavailable')).toBe('build_not_available');
  });
  test('the update link must carry the build: a store link before the store has it, a staging link before staging has it', () => {
    expect(res('store_link_testflight_only')).toBe('refused');
    expect(hint('store_link_testflight_only')).toBe('build_not_available');
    expect(res('staging_link_not_on_staging')).toBe('refused');
    expect(hint('staging_link_not_on_staging')).toBe('build_not_available');
  });
  test('a mandatory minimum needs an update link (app platforms) / the website carrying it (web)', () => {
    expect(res('enforce_without_link')).toBe('refused');
    expect(hint('enforce_without_link')).toBe('update_url_required');
    expect(res('web_not_on_website')).toBe('refused');
    expect(hint('web_not_on_website')).toBe('build_not_available');
  });
  test('edge functions probe the same hook: below the minimum refused, at it allowed, callable signed out', () => {
    expect(res('probe_89')).toBe('refused');
    expect(hint('probe_89')).toBe('app_update_required');
    expect(res('probe_90')).toBe('allowed');
    expect(res('probe_runs_as_anon')).toBe('allowed');
  });
  test('strict mode: unidentified, malformed and unknown-platform clients refused; identified, policy read, service role pass', () => {
    for (const k of ['strict_browser', 'strict_no_headers', 'strict_malformed', 'strict_unknown_platform']) {
      expect([k, res(k)]).toEqual([k, 'refused']);
      expect(hint(k)).toBe('app_update_required');
    }
    expect(res('strict_identified_95')).toBe('allowed');
    expect(res('strict_policy_read')).toBe('allowed');
    expect(res('strict_service_role')).toBe('allowed');
    expect(res('strict_gate_bad_json')).toBe('refused');
    expect(res('strict_off_browser')).toBe('allowed');
    expect(s.settings_log_rows.data).toBe(2);
  });
  test('below the minimum = refused, at or above = allowed, signed out and signed in', () => {
    expect(res('anon_89')).toBe('refused');
    expect(hint('anon_89')).toBe('app_update_required');
    expect(res('anon_90')).toBe('allowed');
    expect(res('anon_91')).toBe('allowed');
    expect(res('signed_in_write_old')).toBe('refused');
    expect(hint('signed_in_write_old')).toBe('app_update_required');
  });
  test('builds <= 87 (no header, native user agent) are refused too', () => {
    expect(res('anon_old_ua')).toBe('refused');
    expect(res('signed_in_old_ua')).toBe('refused');
    expect(res('malformed_header_old_ua')).toBe('refused');
  });
  test('the policy read always passes and shows the minimum only while enforced', () => {
    expect(res('anon_policy_read_old')).toBe('allowed');
    expect(s.policy_ios.data).toMatchObject({ platform: 'ios', min_supported_build: 90, latest_build: 90 });
    expect(s.policy_ios.data.update_url).toMatch(/^itms-beta:/);
    expect(s.policy_android.data).toMatchObject({ platform: 'android', min_supported_build: null });
    expect(s.policy_after_off.data.min_supported_build).toBeNull();
  });
  test('other platforms and unidentified clients are untouched', () => {
    expect(res('android_1')).toBe('allowed');
    expect(res('web_1')).toBe('allowed');
    expect(res('browser')).toBe('allowed');
    expect(res('no_headers')).toBe('allowed');
    expect(res('ua_without_darwin')).toBe('allowed');
  });
  test('a forged higher build gains nothing: the next check still runs, private data stays closed', () => {
    expect(res('forged_high_then_business_check')).toBe('refused');
    expect(hint('forged_high_then_business_check')).toBe('business_selection_changed');
    expect(res('forged_reads_private')).toBe('refused');
    expect(res('client_writes_policy')).toBe('refused');
    expect(res('client_calls_gate')).toBe('refused');
  });
  test('strict mode off (default): a broken request never locks anyone out of the version check', () => {
    expect(res('gate_bad_json')).toBe('allowed');
  });
  test('emergency recovery: lowering and switching off always work, at once (even with no availability record left)', () => {
    expect(res('lower_to_80')).toBe('allowed');
    expect(res('after_lower_old_ua')).toBe('allowed');
    expect(res('after_lower_79')).toBe('refused');
    expect(res('switch_off')).toBe('allowed');
    expect(res('after_off_79')).toBe('allowed');
    expect(s.log_rows.data).toBe(3); // enforce, lower, off (refused changes leave no row)
  });
});
