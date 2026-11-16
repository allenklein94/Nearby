// Stale-location guard (20270426, STAGED; owner 2026-11-16). The PostgREST pre-request check, through the real roles:
// one account owns locations A and B. A screen that names the location it shows (x-nearby-business) is refused as soon
// as the account's selection is another one (switched on another device, or a membership removed); switching / listing
// stay allowed so the screen can recover; no header (builds <= 87), signed out and the service role are unaffected; the
// header can only refuse, never grant (A-only staff naming B is refused, never let in). The whole-request refusal through
// a real PostgREST (nothing runs, B byte-identical, every write path) is scripts/replay/business-selection-api-local.js.
// One rolled-back transaction.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { locationAwareSessionSql, runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;
const as = (sub) => `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;`;
const asServer = `reset role; perform set_config('request.jwt.claims', '', true);`;
const rec = (step, expr) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', ${expr}));`;
// one PostgREST request context: header (SQL text expr or null) + path, then the pre-request check
const hook = (step, header, path = '/rpc/set_business_operating_hours') => `perform set_config('request.headers',
      case when ${header} is null then '{}' else json_build_object('x-nearby-business', ${header})::text end, true);
    perform set_config('request.path', '${path}', true);
  begin
    perform public.nearby_pre_request();
    ${rec(step, `jsonb_build_object('result', 'allowed')`)}
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    ${rec(step, `jsonb_build_object('result', 'refused', 'hint', v_hint, 'state', sqlstate)`)}
  end;`;
const app = (who, name, lat) => `${as(who)}
  insert into business_partner_requests (requester_id, business_name, category, subcategory, address, latitude, longitude, location_source)
    values (auth.uid(), '${name}', 'food_drink', 'Coffee', '1 ${name} St', ${lat}, -75.0, 'host_pin') returning id into v_req;
  ${asServer}
  ${as('v_admin')}`;

d('journey: a screen showing one location can never act after the account switched to another', () => {
  let s;
  beforeAll(async () => {
    const people = ['v_admin', 'v_owner', 'v_staff'];
    const log = await runJourney(`${actorDeclares(people)} v_req uuid; v_pa uuid; v_pb uuid; v_hint text; v_sess uuid; v_old uuid; v_n int;`, `
  ${actorsSql({ people })}
  update profiles set is_admin = true where id = v_admin;
  ${app('v_owner', 'Journey G Loc A', 40.0)}
  v_pa := approve_business_partner_request(v_req);
  ${asServer}
  -- rollout gate: a second location only while every live session of the account is location-aware
  ${app('v_owner', 'Journey G Loc B', 40.001)}
  begin
    v_pb := approve_business_partner_request(v_req);
    ${rec('gate_no_session', `jsonb_build_object('result', 'allowed')`)}
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_pb := null;
    ${rec('gate_no_session', `jsonb_build_object('result', 'refused', 'hint', v_hint)`)}
  end;
  ${asServer}
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_owner, now(), now()) returning id into v_old;
  ${as('v_admin')}
  begin
    v_pb := approve_business_partner_request(v_req);
    ${rec('gate_old_session_only', `jsonb_build_object('result', 'allowed')`)}
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_pb := null;
    ${rec('gate_old_session_only', `jsonb_build_object('result', 'refused', 'hint', v_hint)`)}
  end;
  ${asServer}
  ${locationAwareSessionSql('v_owner')}
  ${as('v_admin')}
  begin
    v_pb := approve_business_partner_request(v_req);
    ${rec('gate_old_plus_new_session', `jsonb_build_object('result', 'allowed')`)}
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_pb := null;
    ${rec('gate_old_plus_new_session', `jsonb_build_object('result', 'refused', 'hint', v_hint)`)}
  end;
  ${asServer}
  delete from auth.sessions where id = v_old; -- the old phone signs out
  ${as('v_admin')}
  begin
    v_pb := approve_business_partner_request(v_req);
    ${rec('gate_all_sessions_aware', `jsonb_build_object('result', 'allowed')`)}
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_pb := null;
    ${rec('gate_all_sessions_aware', `jsonb_build_object('result', 'refused', 'hint', v_hint)`)}
  end;
  ${asServer}
  ${rec('memberships_after_gate', `(select count(*) from private.business_memberships where user_id = v_owner)`)}
  -- an old phone signs in again later: switching between the account's existing locations is never gated
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_owner, now(), now());
  ${as('v_owner')}
  begin
    perform select_managed_business(v_pa); perform select_managed_business(v_pb); perform select_managed_business(v_pa);
    ${rec('switch_existing_with_old_session', `jsonb_build_object('result', 'allowed')`)}
  exception when others then
    ${rec('switch_existing_with_old_session', `jsonb_build_object('result', 'refused', 'msg', sqlerrm)`)}
  end;
  reset role;
  ${asServer}
  -- recording needs a signed-in session of one's own; anon can't call it; the table has no client access
  set local role anon;
  begin perform public.note_location_aware_session(); ${rec('anon_note', `jsonb_build_object('result', 'allowed')`)}
  exception when others then ${rec('anon_note', `jsonb_build_object('result', 'refused')`)} end;
  reset role;
  ${as('v_staff')}
  begin perform count(*) from private.location_aware_sessions; ${rec('client_reads_sessions', `jsonb_build_object('result', 'allowed')`)}
  exception when others then ${rec('client_reads_sessions', `jsonb_build_object('result', 'refused')`)} end;
  reset role;
  ${asServer}
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = v_pa where id = v_staff;
  perform set_config('app.trusted_update', 'false', true);
  ${rec('installed', `(select count(*) from pg_db_role_setting s join pg_roles r on r.oid = s.setrole, unnest(s.setconfig) c
      where r.rolname = 'authenticator' and c = 'pgrst.db_pre_request=public.nearby_pre_request')`)}
  ${rec('grants', `jsonb_build_object('anon', has_function_privilege('anon', 'public.nearby_pre_request()', 'execute'),
      'authenticated', has_function_privilege('authenticated', 'public.nearby_pre_request()', 'execute'),
      'definer', (select prosecdef from pg_proc where oid = 'public.nearby_pre_request()'::regprocedure))`)}

  -- the phone shows A
  ${as('v_owner')}
  perform select_managed_business(v_pa);
  ${hook('a_shows_a', 'v_pa::text')}
  -- the website switches the account to B (another device)
  perform select_managed_business(v_pb);
  ${hook('a_after_switch', 'v_pa::text')}
  ${hook('a_after_switch_read', 'v_pa::text', '/brand_partners')}
  ${hook('b_shows_b', 'v_pb::text')}
  ${hook('no_header', 'null')}
  ${hook('empty_header', "''")}
  ${hook('malformed', "'not-a-location'")}
  ${hook('stale_may_switch', 'v_pa::text', '/rpc/select_managed_business')}
  ${hook('stale_may_list', 'v_pa::text', '/rpc/get_my_businesses')}
  ${hook('unknown_location', 'gen_random_uuid()::text')}
  -- the check can't read the request's headers (never produced by PostgREST): a write is refused, recovery still works
  perform set_config('request.headers', '{not json', true);
  perform set_config('request.path', '/rpc/set_business_operating_hours', true);
  begin perform public.nearby_pre_request(); ${rec('unreadable_write', `jsonb_build_object('result', 'allowed')`)}
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; ${rec('unreadable_write', `jsonb_build_object('result', 'refused', 'hint', v_hint, 'state', sqlstate)`)} end;
  perform set_config('request.path', '/rpc/select_managed_business', true);
  begin perform public.nearby_pre_request(); ${rec('unreadable_recovery', `jsonb_build_object('result', 'allowed')`)}
  exception when others then ${rec('unreadable_recovery', `jsonb_build_object('result', 'refused')`)} end;
  reset role;

  -- A-only staff naming B: refused (the header never grants)
  ${as('v_staff')}
  ${hook('staff_names_b', 'v_pb::text')}
  ${hook('staff_names_a', 'v_pa::text')}
  reset role;

  -- signed out / service role with a header: nothing to compare, no-op
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  ${hook('anon_header', 'v_pa::text')}
  reset role;
  ${asServer}
  ${hook('service_header', 'v_pa::text')}

  -- a membership removed while a screen showing it is open: that screen is refused
  delete from private.business_memberships where user_id = v_owner and partner_id = v_pb;
  ${rec('selected_after_removal', `(select managed_partner_id from profiles where id = v_owner)`)}
  ${as('v_owner')}
  ${hook('removed_b_shows_b', 'v_pb::text')}
  ${hook('removed_a_shows_a', 'v_pa::text')}
  reset role;
  ${asServer}
  ${rec('ids', `jsonb_build_object('a', v_pa, 'b', v_pb)`)}`);
    s = stepMap(log);
  }, 120000);

  const refused = (k) => expect([k, s[k].data]).toEqual([k, { result: 'refused', hint: 'business_selection_changed', state: 'P0001' }]);
  const allowed = (k) => expect([k, s[k].data]).toEqual([k, { result: 'allowed' }]);

  test('installed as the PostgREST pre-request check; callable by the request roles; definer', () => {
    expect(s.installed.data).toBe(1);
    expect(s.grants.data).toEqual({ anon: true, authenticated: true, definer: true });
  });

  test('the screen showing A works while A is selected', () => allowed('a_shows_a'));

  test('after another device switches to B, the screen still showing A is refused (writes and reads)', () => {
    refused('a_after_switch');
    refused('a_after_switch_read');
  });

  test('a screen showing B (the selection) works', () => allowed('b_shows_b'));

  test('a stale screen can still switch and list locations (how it recovers)', () => {
    allowed('stale_may_switch');
    allowed('stale_may_list');
  });

  test('a malformed or unknown location refuses; no header (builds <= 87) or an empty one changes nothing', () => {
    refused('malformed');
    refused('unknown_location');
    allowed('no_header');
    allowed('empty_header');
  });

  test('rollout gate: no second location while any live session of the account is not location-aware', () => {
    expect(s.gate_no_session.data).toEqual({ result: 'refused', hint: 'multi_location_not_ready' });
    expect(s.gate_old_session_only.data).toEqual({ result: 'refused', hint: 'multi_location_not_ready' });
    expect(s.gate_old_plus_new_session.data).toEqual({ result: 'refused', hint: 'multi_location_not_ready' });
    expect(s.gate_all_sessions_aware.data).toEqual({ result: 'allowed' });
    expect(s.memberships_after_gate.data).toBe(2);
  });

  test('rollout gate never blocks the first location or switching between existing ones; recording is self-only', () => {
    expect(s.ids.data.a).toBeTruthy(); // first location approved with no session at all
    expect(s.switch_existing_with_old_session.data).toEqual({ result: 'allowed' });
    expect(s.anon_note.data.result).toBe('refused');
    expect(s.client_reads_sessions.data.result).toBe('refused');
  });

  test('fail closed: a check that cannot read the request refuses a write; recovery paths still pass', () => {
    refused('unreadable_write');
    allowed('unreadable_recovery');
  });

  test('the header never grants: A-only staff naming B is refused, naming A works', () => {
    refused('staff_names_b');
    allowed('staff_names_a');
  });

  test('signed-out and service-role requests are unaffected', () => {
    allowed('anon_header');
    allowed('service_header');
  });

  test('a removed membership: its screen is refused, the remaining location works', () => {
    expect(s.selected_after_removal.data).toBe(s.ids.data.a);
    refused('removed_b_shows_b');
    allowed('removed_a_shows_a');
  });
});
