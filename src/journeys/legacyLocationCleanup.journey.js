// Journey (owner, 2026-10-23, Google compliance follow-up, migration 20270338): a possibly Google-derived gathering point is
// cleared everywhere it is stored, with no coordinate kept anywhere and nobody notified. Rolled back.
//   new gatherings: their plan no longer copies the point (the gathering is the one location source);
//   cleanup (private.clear_unverified_gathering_points): a past gathering with no recorded source loses its point, area and
//     wide_area; its plan's copy is cleared; a business request made for it (NOT NULL point) is deleted with its plan; the
//     audit log holds only non-location metadata (no coordinate, no typed text); no push to the approved attendee;
//     an upcoming gathering, a point with a source, and an unknown id are refused;
//   triggers/checks: a cleared point is never relabelled 'host_pin'; a source without a point is refused;
//   reads: no distance, pin or meet-up point for a cleared gathering; the plan overview still works from the gathering;
//     the log and the function are not reachable by app roles;
//   the database: no legacy point (created before 2026-10-22, no source) and no gathering-plan copy remain.
// Not covered: WAL / provider-side copies of the old values (outside the database's control).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const refused = (name, sql) => `
  begin
    ${sql}
    v_msg := 'NO ERROR';
  exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','${name}','ok', v_msg <> 'NO ERROR', 'data', v_msg));`;
const gathering = (title, when, extra = '', values = '') => `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, wide_area, visibility${extra})
      values (v_host, '${title}', ${when}, 26.4611, -80.0722, 'Coffee', '26.46,-80.07', '26.5,-80.1', 'everyone'${values})`;

d('journey: a legacy gathering point is cleared everywhere, quietly', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_host', 'v_att'])}
      v_g uuid; v_up uuid; v_src uuid; v_req uuid; v_plan uuid; v_req_plan uuid; v_msg text; v_res jsonb;
      v_pushes int; v_row record;`, `
  ${actorsSql({ people: ['v_host', 'v_att'] })}

  -- 1. a new gathering's plan carries no copy of the point
  ${gathering('JLC past', "now() - interval '3 days'")} returning id into v_g;
  select id, location_lat, location_lng into v_row from plans where resulting_gathering_id = v_g;
  v_plan := v_row.id;
  log := log || jsonb_build_array(jsonb_build_object('step','new_plan_has_no_point_copy','ok',
     v_plan is not null and v_row.location_lat is null and v_row.location_lng is null));

  -- the legacy shape: an approved attendee, an old plan copy, a business request made for the gathering
  insert into gathering_interest (gathering_id, user_id, status) values (v_g, v_att, 'approved');
  update plans set location_lat = 26.4611, location_lng = -80.0722 where id = v_plan;
  insert into business_requests (requester_id, raw_text, category, latitude, longitude, expires_at, status, gathering_id, note_for_business)
    values (v_host, 'JLC coffee for my group', 'Coffee', 26.4611, -80.0722, now() - interval '1 day', 'expired', v_g, 'JLC note')
    returning id into v_req;
  select id into v_req_plan from plans where resulting_business_request_id = v_req;
  select count(*) into v_pushes from push_outbox where recipient_id = v_att;

  -- 2. refusals
  ${gathering('JLC upcoming', "now() + interval '3 days'")} returning id into v_up;
  ${gathering('JLC sourced', "now() - interval '3 days'", ', location_source', ", 'host_pin'")} returning id into v_src;
  ${refused('upcoming_refused', "perform private.clear_unverified_gathering_points(array[v_up], 'journey');")}
  ${refused('sourced_point_refused', "perform private.clear_unverified_gathering_points(array[v_src], 'journey');")}
  ${refused('unknown_id_refused', "perform private.clear_unverified_gathering_points(array[gen_random_uuid()], 'journey');")}

  -- 3. the cleanup
  v_res := private.clear_unverified_gathering_points(array[v_g], 'journey');
  log := log || jsonb_build_array(jsonb_build_object('step','counts','ok',
     v_res = '{"gatherings":1,"gathering_plans":1,"business_requests":1,"business_request_plans":1}'::jsonb, 'data', v_res));
  select * into v_row from gatherings where id = v_g;
  log := log || jsonb_build_array(jsonb_build_object('step','gathering_point_cleared','ok',
     v_row.precise_lat is null and v_row.precise_lng is null and v_row.area is null and v_row.wide_area is null
     and v_row.location_source is null and v_row.google_place_id is null and v_row.title = 'JLC past'));
  log := log || jsonb_build_array(jsonb_build_object('step','attendee_kept','ok',
     exists (select 1 from gathering_interest where gathering_id = v_g and user_id = v_att and status = 'approved')));
  log := log || jsonb_build_array(jsonb_build_object('step','plan_kept_copy_cleared','ok',
     (select location_lat is null and location_lng is null and resulting_gathering_id = v_g from plans where id = v_plan)));
  log := log || jsonb_build_array(jsonb_build_object('step','request_and_its_plan_deleted','ok',
     not exists (select 1 from business_requests where id = v_req) and not exists (select 1 from plans where id = v_req_plan)));
  log := log || jsonb_build_array(jsonb_build_object('step','no_push','ok',
     (select count(*) from push_outbox where recipient_id = v_att) = v_pushes));
  log := log || jsonb_build_array(jsonb_build_object('step','log_has_no_location_or_text','ok',
     (select count(*) = 4 and count(distinct object_kind) = 4
         and bool_and(metadata::text !~ '(26\\.46|80\\.07|JLC coffee|JLC note)')
         and bool_and(not (metadata ?| array['latitude','longitude','area_key','raw_text','note_for_business','location_lat','location_lng','precise_lat','area','wide_area']))
        from private.legacy_location_cleanup where reason = 'journey'),
     'data', (select jsonb_agg(jsonb_build_object('kind', object_kind, 'action', action, 'm', metadata)) from private.legacy_location_cleanup where reason = 'journey')));

  -- 4. triggers and checks
  update gatherings set precise_lat = null, precise_lng = null, area = null where id = v_src;
  log := log || jsonb_build_array(jsonb_build_object('step','cleared_point_not_relabelled','ok',
     (select location_source is null and google_place_id is null from gatherings where id = v_src)));
  ${refused('source_needs_point', "update gatherings set location_source = 'device' where id = v_src;")}
  ${refused('point_needs_area', "update gatherings set precise_lat = 26.4, precise_lng = -80.1, location_source = 'host_pin' where id = v_src;")}

  -- 5. reads
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  set local role authenticated;
  log := log || jsonb_build_array(jsonb_build_object('step','no_distance_or_pin','ok',
     not exists (select 1 from get_gathering_distances(26.46, -80.07, array[v_g]))));
  log := log || jsonb_build_array(jsonb_build_object('step','no_meetup_point','ok',
     not exists (select 1 from get_gathering_meetup_point(v_g) where latitude is not null)));
  begin v_res := get_plan_overview(v_plan)::jsonb; v_msg := 'OK'; exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','plan_overview_still_works','ok', v_msg = 'OK', 'data', v_msg));
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','not_reachable_by_app_roles','ok',
     not has_table_privilege('authenticated', 'private.legacy_location_cleanup', 'select')
     and not has_table_privilege('anon', 'private.legacy_location_cleanup', 'select')
     and not has_function_privilege('authenticated', 'private.clear_unverified_gathering_points(uuid[], text)', 'execute')
     and not has_function_privilege('anon', 'private.clear_unverified_gathering_points(uuid[], text)', 'execute')));

  -- 6. the database as a whole
  log := log || jsonb_build_array(jsonb_build_object('step','no_legacy_point_left','ok',
     not exists (select 1 from gatherings where location_source is null and (precise_lat is not null or precise_lng is not null)
                  and created_at < '2026-10-22'),
     'data', (select count(*) from gatherings where location_source is null and precise_lat is not null and created_at < '2026-10-22')));
  log := log || jsonb_build_array(jsonb_build_object('step','no_gathering_plan_copy_left','ok',
     not exists (select 1 from plans where resulting_gathering_id is not null and (location_lat is not null or location_lng is not null)),
     'data', (select count(*) from plans where resulting_gathering_id is not null and location_lat is not null)));
`);
    s = stepMap(log);
  }, 60000);

  test.each([
    'new_plan_has_no_point_copy', 'upcoming_refused', 'sourced_point_refused', 'unknown_id_refused', 'counts',
    'gathering_point_cleared', 'attendee_kept', 'plan_kept_copy_cleared', 'request_and_its_plan_deleted', 'no_push',
    'log_has_no_location_or_text', 'cleared_point_not_relabelled', 'source_needs_point', 'point_needs_area',
    'no_distance_or_pin', 'no_meetup_point', 'plan_overview_still_works', 'not_reachable_by_app_roles',
    'no_legacy_point_left', 'no_gathering_plan_copy_left',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    expect(s[n].ok).toBe(true);
  });
});
