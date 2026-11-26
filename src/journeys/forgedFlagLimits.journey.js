// Enforcement a forged app.trusted_update cannot skip (migration 20270361; staged after 20270360, run with 0348-0361 as
// JOURNEY_PRELUDE_FILE until live). The 0356 rate limits, the name / photo change limit and the friend-request daily limit
// skip only for a private per-transaction marker that only two server paths set (swap_main_photo, a mutual friend-discovery
// like); a client role that sets the flag with set_config is limited like anyone else.
// Every step runs in ONE rolled-back transaction under the real client roles (set local role + JWT claims, as PostgREST).
// Rules are tightened inside the transaction so one extra action hits a limit; nothing touches production rows.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`, role = 'authenticated') {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', '${role}')::text, true);
  set local role ${role};
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('app.trusted_update', 'false', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
const forge = `perform set_config('app.trusted_update', 'true', true)`;
const friendRequest = (from, to) => `insert into friendships (user_a, user_b, status, requested_by) values (least(${from}, ${to}), greatest(${from}, ${to}), 'pending', ${from})`;
const markers = `(select count(*) from private.trusted_write_marker)`;
const today = `(now() at time zone 'America/New_York')::date`;

d('journey: a forged trusted-write flag skips no rate or friend-request limit', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_d', 'v_e', 'v_f', 'v_g'])}
      v_out jsonb; v_hint text; v_m1 boolean; v_m2 boolean;`, `
  ${actorsSql({ people: ['v_d', 'v_e', 'v_f', 'v_g'] })}
  perform set_config('app.trusted_update', 'false', true);
  -- tight limits for this transaction only: one name change, one report, one photo change (already used)
  delete from private.rate_limit_rules where action in ('name_change', 'photo_change', 'report');
  insert into private.rate_limit_rules (action, trust_level, window_seconds, max_count) values
    ('name_change', 'new', 86400, 1), ('name_change', 'established', 86400, 1),
    ('report', 'new', 86400, 1), ('report', 'established', 86400, 1),
    ('photo_change', 'new', 86400, 1), ('photo_change', 'established', 86400, 1);
  insert into private.limited_action_log (user_id, field) values (v_d, 'photo'), (v_f, 'photo'); -- photo limit already used
  -- v_d and v_e have used today's 15 friend requests
  update profiles set photo_url = v_d || '/main.jpg' where id = v_d; -- a photo to change
  update profiles set friend_requests_sent_today = 15, friend_requests_sent_date = ${today} where id in (v_d, v_e);
  ${rec('catalog_flag_skips', `(select coalesce(jsonb_agg(p.oid::regprocedure::text), '[]'::jsonb) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.prosrc ~ 'current_setting\\(''app\\.trusted_update'', true\\), ''''\\) = ''true''')`)}
  ${rec('marker_closed', `jsonb_build_object(
      'table', has_table_privilege('authenticated', 'private.trusted_write_marker', 'insert,update,delete,select') or has_table_privilege('anon', 'private.trusted_write_marker', 'insert,update,delete,select'),
      'mark', has_function_privilege('authenticated', 'private.mark_trusted_write()', 'execute') or has_function_privilege('anon', 'private.mark_trusted_write()', 'execute'),
      'schema', has_schema_privilege('authenticated', 'private', 'usage') or has_schema_privilege('anon', 'private', 'usage'))`)}

  -- authenticated: forged flag vs each limit
  ${as('first_name_change', 'v_d', `update profiles set display_name = 'Renamed once' where id = v_d`)}
  ${as('forged_second_name_change', 'v_d', `${forge}; update profiles set display_name = 'Renamed twice' where id = v_d`)}
  ${rec('name_after', `(select display_name from profiles where id = v_d)`)}
  ${as('forged_friend_request', 'v_d', `${forge}; ${friendRequest('v_d', 'v_g')}`)}
  ${as('first_report', 'v_d', `insert into reports (reporter_id, reported_id, reason) values (v_d, v_g, 'Spam or scam')`)}
  ${as('forged_second_report', 'v_d', `${forge}; insert into reports (reporter_id, reported_id, reason) values (v_d, v_f, 'Spam or scam')`)}
  ${as('forged_photo_change', 'v_d', `${forge}; update profiles set photo_url = v_d || '/forged.jpg' where id = v_d`)}
  ${rec('photo_kept', `(select photo_url = v_d || '/main.jpg' from profiles where id = v_d)`)}
  -- the client cannot create the marker itself
  ${as('client_marks', 'v_d', `perform private.mark_trusted_write()`)}
  -- anon with a forged flag
  ${as('anon_forged_report', 'null', `${forge}; insert into reports (reporter_id, reported_id, reason) values (v_d, v_g, 'Spam or scam')`, `'ok'::text`, 'anon')}

  -- legitimate server paths still skip: swap_main_photo with photo changes at 0 ...
  update profiles set photo_url = 'journey/main.jpg' where id = v_f;
  insert into profile_photos (user_id, photo_url) values (v_f, 'journey/extra.jpg');
  ${as('swap_main_photo', 'v_f', `perform swap_main_photo((select id from profile_photos where user_id = v_f limit 1))`)}
  ${rec('main_after_swap', `(select photo_url from profiles where id = v_f)`)}
  ${rec('markers_after_swap', markers)}
  -- ... and a mutual friend-discovery like with the friend-request limit used up
  update profiles set open_to_friend_discovery = true where id in (v_e, v_f);
  insert into friend_discovery_swipes (from_user, to_user, direction) values (v_f, v_e, 'like');
  ${as('mutual_like', 'v_e', `select is_mutual_match into v_m1 from record_friend_discovery_swipe(v_f, 'like')`, 'v_m1')}
  ${rec('friendship_from_like', `(select count(*) from friendships where user_a = least(v_e, v_f) and user_b = greatest(v_e, v_f))`)}
  ${rec('markers_after_like', markers)}
  -- right after the trusted calls, the same person's own forged request is limited again
  ${as('forged_request_after_like', 'v_e', `${forge}; ${friendRequest('v_e', 'v_g')}`)}

  -- nested: an inner call never removes the outer call's marker
  v_m1 := private.mark_trusted_write();
  v_m2 := private.mark_trusted_write();
  ${rec('nested_marks', `jsonb_build_object('outer', v_m1, 'inner', v_m2)`)}
  ${rec('active_while_nested', `private.trusted_write_active()`)}
  perform private.unmark_trusted_write();
  ${rec('active_after_outer', `private.trusted_write_active()`)}
  -- a failure after marking leaves no marker
  begin
    perform private.mark_trusted_write();
    raise exception 'fail while marked';
  exception when others then null;
  end;
  ${rec('markers_after_failure', markers)}
  ${as('forged_request_after_failure', 'v_d', `${forge}; ${friendRequest('v_d', 'v_f')}`)}
`);
    s = stepMap(log);
  }, 120000);

  const data = (k) => s[k].data;
  const limited = (k) => {
    expect(data(k).error).toBeTruthy();
    expect(`${data(k).error} ${data(k).hint}`).toMatch(/rate_limited|limit|friend requests per day/i);
  };

  test('nothing in the catalog skips enforcement on the flag, and the marker is closed to client roles', () => {
    expect(data('catalog_flag_skips')).toEqual([]);
    expect(data('marker_closed')).toEqual({ table: false, mark: false, schema: false });
    expect(data('client_marks').error).toMatch(/permission denied/i);
  });

  test('authenticated + forged flag: name change, friend request, report and photo change are still limited', () => {
    expect(data('first_name_change')).toBe('ok');
    limited('forged_second_name_change');
    expect(data('name_after')).toBe('Renamed once');
    limited('forged_friend_request');
    expect(data('first_report')).toBe('ok');
    limited('forged_second_report');
    limited('forged_photo_change');
    expect(data('photo_kept')).toBe(true);
  });

  test('anon + forged flag cannot file a report', () => {
    expect(data('anon_forged_report').error).toBeTruthy();
  });

  test('legitimate server paths keep their skip: photo swap with the photo limit used up, mutual like at the friend-request limit', () => {
    expect(data('swap_main_photo')).toBe('ok');
    expect(data('main_after_swap')).toBe('journey/extra.jpg');
    expect(data('mutual_like')).toBe(true);
    expect(data('friendship_from_like')).toBe(1);
  });

  test('the marker never outlives the server call that set it', () => {
    expect(data('markers_after_swap')).toBe(0);
    expect(data('markers_after_like')).toBe(0);
    limited('forged_request_after_like');
  });

  test('nested calls keep the outer marker; a failure leaves none behind', () => {
    expect(data('nested_marks')).toEqual({ outer: true, inner: false });
    expect(data('active_while_nested')).toBe(true);
    expect(data('active_after_outer')).toBe(false);
    expect(data('markers_after_failure')).toBe(0);
    limited('forged_request_after_failure');
  });
});
