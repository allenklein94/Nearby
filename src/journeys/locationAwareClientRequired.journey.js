// Old-build loophole closed (20270427, STAGED; owner 2026-11-16), through the real roles. An account holding TWO locations
// (A, B) whose request names no location (x-nearby-business absent: builds <= 87, the current website, including a session
// that signed in AFTER the second location was added) can't make a location-specific write: every RPC that acts for the
// selected location and every write to a business table is refused before it runs (P0001, hint
// location_aware_client_required); the business-side rows of the two shared tables (a story posted as the business, a
// business reply) are refused by their row triggers; a gathering it creates is the person's own, never credited to
// whichever location is selected. Unchanged: the same account's customer actions, person-level settings, object-bound
// customer functions, recovery (switch / list / record), a request that names the selected location, every single-location
// account (owner or staff), and the account once a membership is removed (back to one location). A stale named location
// is still refused by 20270426 (concurrent switch). The whole-request refusal through a real PostgREST (GET reads pass, A
// and B byte-identical) is scripts/replay/business-selection-api-local.js. One rolled-back transaction.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { locationAwareSessionSql, runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;
const as = (sub) => `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;`;
const asServer = `reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.headers', '', true);`;
const rec = (step, expr) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', ${expr}));`;
const setReq = (header, path) => `perform set_config('request.headers',
      case when ${header} is null then '{}' else json_build_object('x-nearby-business', ${header})::text end, true);
    perform set_config('request.path', '${path}', true);`;
// one PostgREST request context (header SQL expr or null + path), then the pre-request check
const hook = (step, header, path) => `${setReq(header, path)}
  begin
    perform public.nearby_pre_request();
    ${rec(step, `jsonb_build_object('result', 'allowed')`)}
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    ${rec(step, `jsonb_build_object('result', 'refused', 'hint', v_hint)`)}
  end;`;
// a row written in that request context (the row triggers read the same request settings)
const row = (step, sql) => `begin
    ${sql}
    ${rec(step, `jsonb_build_object('result', 'allowed')`)}
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    ${rec(step, `jsonb_build_object('result', 'refused', 'hint', v_hint, 'msg', left(sqlerrm, 120))`)}
  end;`;
const app = (who, name, lat) => `${as(who)}
  insert into business_partner_requests (requester_id, business_name, category, subcategory, address, latitude, longitude, location_source)
    values (auth.uid(), '${name}', 'food_drink', 'Coffee', '1 ${name} St', ${lat}, -75.0, 'host_pin') returning id into v_req;
  ${asServer}
  ${as('v_admin')}`;
const ownerCtx = (header, path) => `perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  ${setReq(header, path)}`;

d('journey: an old client of a two-location account can never write for "the selected location"', () => {
  let s;
  beforeAll(async () => {
    const people = ['v_admin', 'v_owner', 'v_staff', 'v_single', 'v_customer'];
    const log = await runJourney(`${actorDeclares(people)} v_req uuid; v_pa uuid; v_pb uuid; v_pc uuid; v_hint text; v_sess uuid; v_g uuid; v_hp uuid;`, `
  ${actorsSql({ people })}
  update profiles set is_admin = true where id = v_admin;
  -- the owner's only session is location-aware, so a second location can be added (20270426's gate)
  ${locationAwareSessionSql('v_owner')}
  ${app('v_owner', 'Journey L Loc A', 40.0)}
  v_pa := approve_business_partner_request(v_req);
  ${asServer}
  ${app('v_owner', 'Journey L Loc B', 40.001)}
  v_pb := approve_business_partner_request(v_req);
  ${asServer}
  ${app('v_single', 'Journey L Single', 40.002)}
  v_pc := approve_business_partner_request(v_req);
  ${asServer}
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = v_pa where id = v_staff; -- A-only staff (one location)
  perform set_config('app.trusted_update', 'false', true);
  -- AFTER the second location exists, an old build signs in on another phone (a new session that never records itself)
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_owner, now(), now());
  ${rec('owner_locations', `(select count(*) from private.business_memberships where user_id = v_owner)`)}

  ${as('v_owner')}
  perform select_managed_business(v_pa);
  -- the old build (no header): location-specific writes refused
  ${hook('old_rpc_no_location_arg', 'null', '/rpc/create_occasion_package')}
  ${hook('old_rpc_with_partner_arg', 'null', '/rpc/set_business_operating_hours')}
  ${hook('old_rpc_offer', 'null', '/rpc/submit_business_offer')}
  ${hook('old_table_brand_offers', 'null', '/brand_offers')}
  ${hook('old_table_business_updates', 'null', '/business_updates')}
  ${hook('old_empty_header', "''", '/rpc/create_occasion_package')}
  -- the same old build: customer actions, person-level settings, object-bound customer functions, recovery
  ${hook('old_customer_join', 'null', '/rpc/join_gathering')}
  ${hook('old_customer_profile', 'null', '/profiles')}
  ${hook('old_customer_gatherings', 'null', '/gatherings')}
  ${hook('old_customer_story_path', 'null', '/stories')}
  ${hook('old_customer_message_path', 'null', '/business_messages')}
  ${hook('old_person_notifications', 'null', '/rpc/set_my_notification_group')}
  ${hook('old_person_email', 'null', '/rpc/set_my_business_email_enabled')}
  ${hook('old_person_group_insights', 'null', '/rpc/get_gathering_group_insights')}
  ${hook('old_customer_cancel_reservation', 'null', '/rpc/cancel_business_reservation')}
  ${hook('old_customer_complete_reservation', 'null', '/rpc/complete_business_reservation')}
  ${hook('old_switch', 'null', '/rpc/select_managed_business')}
  ${hook('old_list', 'null', '/rpc/get_my_businesses')}
  ${hook('old_note_session', 'null', '/rpc/note_location_aware_session')}
  -- a new client naming the selected location: works; naming the other one (switched elsewhere): 20270426 refuses
  ${hook('named_selected', 'v_pa::text', '/rpc/create_occasion_package')}
  ${hook('named_other', 'v_pb::text', '/rpc/create_occasion_package')}
  -- concurrent switch: another device selects B; the old build is still refused, the named-A screen now refused too
  perform select_managed_business(v_pb);
  ${hook('after_switch_old', 'null', '/rpc/set_business_max_group_size')}
  ${hook('after_switch_named_a', 'v_pa::text', '/rpc/set_business_max_group_size')}
  ${hook('after_switch_named_b', 'v_pb::text', '/rpc/set_business_max_group_size')}
  perform select_managed_business(v_pa);
  reset role;

  -- shared tables, row level (selection A): business-side rows refused without a named location, customer rows untouched
  ${asServer}
  ${ownerCtx('null', '/stories')}
  ${row('story_as_business_old', `insert into stories (user_id, partner_id, media_path, media_type) values (v_owner, v_pa, v_pa::text || '/old.jpg', 'image');`)}
  ${row('story_personal_old', `insert into stories (user_id, media_path, media_type) values (v_owner, v_owner::text || '/mine.jpg', 'image');`)}
  ${ownerCtx('v_pa::text', '/stories')}
  ${row('story_as_business_named', `insert into stories (user_id, partner_id, media_path, media_type) values (v_owner, v_pa, v_pa::text || '/named.jpg', 'image');`)}
  ${ownerCtx('null', '/business_messages')}
  ${row('reply_as_business_old', `insert into business_messages (partner_id, sender_id, from_business, body, conversation_with_id) values (v_pa, v_owner, true, 'old build reply', v_customer);`)}
  ${row('message_as_customer_old', `insert into business_messages (partner_id, sender_id, from_business, body, conversation_with_id) values (v_pc, v_owner, false, 'hello as a customer', v_owner);`)}
  ${ownerCtx('v_pa::text', '/business_messages')}
  ${row('reply_as_business_named', `insert into business_messages (partner_id, sender_id, from_business, body, conversation_with_id) values (v_pa, v_owner, true, 'named reply', v_customer);`)}

  -- gatherings created by the two-location account: credited only to a named location
  ${ownerCtx('null', '/gatherings')}
  set local role authenticated;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (v_owner, 'Old build gathering', now() + interval '2 days', 40.0, -75.0, 'Coffee', 'x', 'everyone') returning id into v_g;
  reset role;
  ${rec('gathering_old_hosting', `(select hosting_partner_id from gatherings where id = v_g)`)}
  ${ownerCtx('v_pa::text', '/gatherings')}
  set local role authenticated;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (v_owner, 'Named gathering', now() + interval '2 days', 40.0, -75.0, 'Coffee', 'x', 'everyone') returning id into v_g;
  reset role;
  ${rec('gathering_named_hosting', `(select hosting_partner_id = v_pa from gatherings where id = v_g)`)}
  ${asServer}

  -- single-location accounts (an owner of C, A-only staff) and a plain customer: nothing changes without a header
  ${as('v_single')}
  ${hook('single_owner_old', 'null', '/rpc/create_occasion_package')}
  ${hook('single_owner_table', 'null', '/brand_offers')}
  perform set_config('request.headers', '{}', true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (v_single, 'Single owner gathering', now() + interval '2 days', 40.0, -75.0, 'Coffee', 'x', 'everyone') returning id into v_g;
  reset role;
  ${rec('gathering_single_hosting', `(select hosting_partner_id = v_pc from gatherings where id = v_g)`)}
  ${as('v_staff')}
  ${hook('staff_one_location_old', 'null', '/rpc/set_business_operating_hours')}
  ${hook('staff_names_b', 'v_pb::text', '/rpc/set_business_operating_hours')}
  reset role;
  ${as('v_customer')}
  ${hook('customer_old', 'null', '/rpc/create_occasion_package')}
  reset role;
  -- signed out and the service role: unaffected
  ${asServer}
  set local role anon;
  ${hook('anon_old', 'null', '/rpc/create_occasion_package')}
  reset role;
  ${asServer}
  ${hook('service_old', 'null', '/rpc/create_occasion_package')}

  -- revoked membership: B removed, the account is back to one location: the old build works again (only A exists)
  delete from private.business_memberships where user_id = v_owner and partner_id = v_pb;
  ${as('v_owner')}
  ${hook('revoked_back_to_one_old', 'null', '/rpc/create_occasion_package')}
  ${hook('revoked_names_b', 'v_pb::text', '/rpc/create_occasion_package')}
  reset role;
  ${asServer}
  -- the edge functions' count: service-only
  ${rec('count_fn_grants', `jsonb_build_object('authenticated', has_function_privilege('authenticated', 'public._account_location_count(uuid)', 'execute'),
      'anon', has_function_privilege('anon', 'public._account_location_count(uuid)', 'execute'),
      'service', has_function_privilege('service_role', 'public._account_location_count(uuid)', 'execute'),
      'owner_now', public._account_location_count(v_owner))`)}`);
    s = stepMap(log);
  }, 120000);

  const refusedOld = (k) => expect([k, s[k].data]).toEqual([k, { result: 'refused', hint: 'location_aware_client_required' }]);
  const refusedStale = (k) => expect([k, s[k].data]).toEqual([k, { result: 'refused', hint: 'business_selection_changed' }]);
  const allowed = (k) => expect([k, s[k].data]).toEqual([k, { result: 'allowed' }]);
  const rowRefusedOld = (k) => expect([k, s[k].data.result, s[k].data.hint || s[k].data.msg]).toEqual([k, 'refused', 'location_aware_client_required']);

  test('fixture: the owner holds two locations, and an old build signed in after the second was added', () => {
    expect(s.owner_locations.data).toBe(2);
  });

  test('old build: every kind of location-specific write is refused (no location argument, a partner argument, offers, business tables)', () => {
    ['old_rpc_no_location_arg', 'old_rpc_with_partner_arg', 'old_rpc_offer', 'old_table_brand_offers',
      'old_table_business_updates', 'old_empty_header'].forEach(refusedOld);
  });

  test('old build: the same account can still act as a customer and change person-level settings', () => {
    ['old_customer_join', 'old_customer_profile', 'old_customer_gatherings', 'old_customer_story_path',
      'old_customer_message_path', 'old_person_notifications', 'old_person_email', 'old_person_group_insights',
      'old_customer_cancel_reservation', 'old_customer_complete_reservation'].forEach(allowed);
  });

  test('old build: recovery (switch, list, record the session) always works', () => {
    ['old_switch', 'old_list', 'old_note_session'].forEach(allowed);
  });

  test('a client naming the selected location works; naming another (switched elsewhere) is refused', () => {
    allowed('named_selected');
    refusedStale('named_other');
  });

  test('concurrent switch: after another device selects B, the old build stays refused, A-screen refused, B-screen works', () => {
    refusedOld('after_switch_old');
    refusedStale('after_switch_named_a');
    allowed('after_switch_named_b');
  });

  test('shared tables: a story / reply as the business needs a named location; the customer rows are untouched', () => {
    rowRefusedOld('story_as_business_old');
    rowRefusedOld('reply_as_business_old');
    allowed('story_personal_old');
    allowed('message_as_customer_old');
    // named: past the location check (a story as the business still needs the business-moments entitlement, unrelated)
    ['story_as_business_named', 'reply_as_business_named'].forEach((k) => expect([k, s[k].data.hint]).not.toEqual([k, 'location_aware_client_required']));
    allowed('reply_as_business_named');
  });

  test('gatherings: an unnamed request is the person\'s own; a named one is credited to that location; single owner unchanged', () => {
    expect(s.gathering_old_hosting.data).toBeNull();
    expect(s.gathering_named_hosting.data).toBe(true);
    expect(s.gathering_single_hosting.data).toBe(true);
  });

  test('single-location accounts, customers, signed-out and the service role are unaffected; the header never grants', () => {
    ['single_owner_old', 'single_owner_table', 'staff_one_location_old', 'customer_old', 'anon_old', 'service_old'].forEach(allowed);
    refusedStale('staff_names_b');
  });

  test('revoked membership: back to one location, the old build works; naming the removed location is refused', () => {
    allowed('revoked_back_to_one_old');
    refusedStale('revoked_names_b');
  });

  test('the location count the edge functions read is service-only', () => {
    expect(s.count_fn_grants.data).toEqual({ authenticated: false, anon: false, service: true, owner_now: 1 });
  });
});
