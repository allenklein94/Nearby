// Owner item 146 (2026-10-17, approved): a gathering's precise point reaches only its host and approved attendees, only
// through get_gathering_meetup_point. Unlike most journeys, every actor here runs under the REAL database role the API uses
// (`set local role anon` / `authenticated` + the JWT claims), so table and column grants are exercised, not bypassed:
//   per actor (signed-out visitor, stranger, pending request, waitlisted, invited-not-joined, approved attendee, host):
//     direct `precise_lat` read, `select *`, a whole-row read (what an embed `gatherings(*)` does), a filter on the column
//     (`?precise_lat=gt.0` would be an oracle) -> all refused; an ordinary read of the allowed columns works; the lookup
//     gives the point to the host + approved attendee only (anon cannot call it).
//   RPC paths, as the invitee: get_gathering_distances' pin is no longer the md5 offset (the old reversal fails), lies in the
//     point's 0.007 deg cell, and distance_miles is measured to the pin; get_bounded_nearby_gathering_ids tests the pin, never the
//     point; the place-count oracle count_gatherings_near_batch is gone (owner Option A, 20270325): a grid scan as a signed-in
//     user cannot even call it, and no public count_gatherings* function exists.
//   Pin averaging (item 146 Option A, owner 2026-10-17): the pin is keyed by host + cell, never the gathering: a host's
//     gatherings at one point (a weekly series), or spread inside one cell, share ONE pin; knowing one gathering's real point
//     gives no offset that recovers another's; another host or another cell gets another pin; the radius boundary is the pin;
//     the pre-filter still finds a gathering whose point is at the far corner of its cell from the pin.
//   Grants: no table-wide SELECT; the client-readable columns = every column except precise_lat/lng; the secret, its schema
//     and the pin function are out of client reach; count_gatherings_near is gone.
// Rolled back. Coordinates are mid-Atlantic so no real gathering shares their cell.
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const LAT = 12.345678;
const LNG = -45.678912;

// One actor's probes against gathering `gid`, under `role` with JWT subject `sub` (null = signed out).
function probe(step, role, sub, gid) {
  const claims = sub
    ? `json_build_object('sub', ${sub}, 'role', 'authenticated')::text`
    : `json_build_object('role', 'anon')::text`;
  return `
  perform set_config('request.jwt.claims', ${claims}, true);
  set local role ${role};
  begin perform precise_lat from gatherings where id = ${gid}; v_direct := 'readable';
  exception when insufficient_privilege then v_direct := 'denied'; end;
  begin perform * from gatherings where id = ${gid}; v_star := 'readable';
  exception when insufficient_privilege then v_star := 'denied'; end;
  begin perform (select g from gatherings g where g.id = ${gid}); v_row := 'readable';
  exception when insufficient_privilege then v_row := 'denied'; end;
  begin perform 1 from gatherings where id = ${gid} and precise_lat > 0; v_filter := 'readable';
  exception when insufficient_privilege then v_filter := 'denied'; end;
  begin select jsonb_build_object('title', title, 'area', area, 'visibility', visibility) into v_safe from gatherings where id = ${gid};
  exception when insufficient_privilege then v_safe := '"denied"'::jsonb; end;
  begin select coalesce(jsonb_agg(jsonb_build_object('lat', latitude, 'lng', longitude)), '[]'::jsonb) into v_meet
    from get_gathering_meetup_point(${gid});
  exception when insufficient_privilege then v_meet := '"denied"'::jsonb; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', jsonb_build_object(
    'direct', v_direct, 'star', v_star, 'row', v_row, 'filter', v_filter, 'safe', v_safe, 'meet', v_meet)));`;
}

function miles(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const c = Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r) + Math.sin(lat1 * r) * Math.sin(lat2 * r);
  return 3958.8 * Math.acos(Math.min(1, Math.max(-1, c)));
}

d('journey: precise gathering location only for the host and approved attendees, on every database path', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      v_host uuid := gen_random_uuid(); v_fan uuid := gen_random_uuid(); v_req uuid := gen_random_uuid();
      v_wait uuid := gen_random_uuid(); v_inv uuid := gen_random_uuid(); v_str uuid := gen_random_uuid(); u uuid;
      v_open uuid; v_appr uuid; v_full uuid; v_priv uuid;
      v_direct text; v_star text; v_row text; v_filter text; v_safe jsonb; v_meet jsonb;
      v_pin record; v_safe_id uuid; v_md5_lat double precision; v_md5_lng double precision; v_err text;
      v_series uuid[] := '{}'; v_spread uuid; v_far uuid; v_other_host uuid; v_other_cell uuid; v_base record;
      v_cell_lat double precision; v_cell_lng double precision; v_far_lat double precision; v_far_lng double precision;
      v_d double precision; i int;`, `
  foreach u in array array[v_host, v_fan, v_req, v_wait, v_inv, v_str] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@j146.test');
    insert into profiles (id, display_name, birthdate) values (u, 'J146-' || left(u::text, 4), date '1990-01-01');
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J146 open', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 10, 'everyone') returning id into v_open;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, requires_approval)
    values (v_host, 'J146 approval', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 10, 'everyone', true) returning id into v_appr;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J146 full', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 2, 'everyone') returning id into v_full;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_host, 'J146 invite-only', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 10, 'invite_only', false) returning id into v_priv;
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id, status) values (v_host, v_inv, 'gathering', v_priv, 'pending');

  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  perform join_gathering(v_open);
  perform join_gathering(v_full); -- takes the full gathering's one guest spot
  perform set_config('request.jwt.claims', json_build_object('sub', v_req, 'role', 'authenticated')::text, true);
  perform join_gathering(v_appr);
  perform set_config('request.jwt.claims', json_build_object('sub', v_wait, 'role', 'authenticated')::text, true);
  perform join_gathering(v_full);
  log := log || jsonb_build_array(jsonb_build_object('step', 'statuses', 'ok', true, 'data', jsonb_build_object(
    'approved', (select status from gathering_interest where gathering_id = v_open and user_id = v_fan),
    'pending', (select status from gathering_interest where gathering_id = v_appr and user_id = v_req),
    'waitlisted', (select status from gathering_interest where gathering_id = v_full and user_id = v_wait))));
  -- the host's own writes the way the app makes them: insert returning named columns (createGathering), an edit (updateGathering)
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (v_host, 'J146 created', now() + interval '2 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'invite_only')
    returning id into v_safe_id;
  update gatherings set title = 'J146 edited' where id = v_safe_id;
  begin insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
      values (v_host, 'J146 star', now() + interval '2 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 'invite_only') returning * into v_pin;
    v_err := 'readable';
  exception when insufficient_privilege then v_err := 'denied'; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'host_writes', 'ok', true, 'data', jsonb_build_object(
    'edited', (select title from gatherings where id = v_safe_id),
    'point_stored', (select precise_lat = ${LAT} and precise_lng = ${LNG} from gatherings where id = v_safe_id),
    'returning_star', v_err)));
  ${probe('anon_public', 'anon', null, 'v_open')}
  ${probe('anon_invite_only', 'anon', null, 'v_priv')}
  ${probe('stranger_public', 'authenticated', 'v_str', 'v_open')}
  ${probe('stranger_invite_only', 'authenticated', 'v_str', 'v_priv')}
  ${probe('pending', 'authenticated', 'v_req', 'v_appr')}
  ${probe('waitlisted', 'authenticated', 'v_wait', 'v_full')}
  ${probe('invited', 'authenticated', 'v_inv', 'v_priv')}
  ${probe('approved', 'authenticated', 'v_fan', 'v_open')}
  ${probe('host', 'authenticated', 'v_host', 'v_open')}
  ${probe('host_invite_only', 'authenticated', 'v_host', 'v_priv')}

  -- RPC paths, as the invitee (item 147: a stranger now gets nothing for an invite-only gathering) under the real role
  perform set_config('request.jwt.claims', json_build_object('sub', v_inv, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into v_pin from get_gathering_distances(0, 0, array[v_priv]);
  v_md5_lat := v_pin.fuzzed_lat - ((((('x' || substr(md5(v_priv::text || 'lat'), 1, 8))::bit(32)::bigint % 1000) / 1000.0 - 0.5) * 0.007));
  v_md5_lng := v_pin.fuzzed_lng - ((((('x' || substr(md5(v_priv::text || 'lng'), 1, 8))::bit(32)::bigint % 1000) / 1000.0 - 0.5) * 0.007));
  log := log || jsonb_build_array(jsonb_build_object('step', 'distances', 'ok', true, 'data', jsonb_build_object(
    'pin_lat', v_pin.fuzzed_lat, 'pin_lng', v_pin.fuzzed_lng, 'distance_from_origin', v_pin.distance_miles,
    'md5_recovered_lat', v_md5_lat, 'md5_recovered_lng', v_md5_lng,
    'again', (select jsonb_build_object('lat', fuzzed_lat, 'lng', fuzzed_lng) from get_gathering_distances(1, 1, array[v_priv])),
    'from_precise', (select distance_miles from get_gathering_distances(${LAT}, ${LNG}, array[v_priv])))));
  log := log || jsonb_build_array(jsonb_build_object('step', 'bounded', 'ok', true, 'data', jsonb_build_object(
    -- a radius around the PIN finds the invite-only gathering; a radius around the precise point smaller than the pin's
    -- distance from it does not
    'around_pin', exists (select 1 from get_bounded_nearby_gathering_ids(v_pin.fuzzed_lat, v_pin.fuzzed_lng, 0.01) b where b.id = v_priv),
    'around_point', exists (select 1 from get_bounded_nearby_gathering_ids(${LAT}, ${LNG},
        (select distance_miles from get_gathering_distances(${LAT}, ${LNG}, array[v_priv])) / 2) b where b.id = v_priv))));
  -- Place-count oracle (owner Option A, 20270325): the old grid scan (20 points around three public + discoverable journey
  -- gatherings at the point) can no longer be run at all; dynamic SQL so the journey itself compiles without the function.
  begin execute format('select * from public.count_gatherings_near_batch(array_fill(%s::double precision, array[20]), array_fill(%s::double precision, array[20]))', ${LAT}, ${LNG});
    v_err := 'callable';
  exception when undefined_function then v_err := 'undefined';
  when others then v_err := sqlstate; end;
  log := log || jsonb_build_array(jsonb_build_object('step', 'counts', 'ok', true, 'data', jsonb_build_object(
    'grid_scan', v_err,
    'count_functions', (select coalesce(jsonb_agg(proname::text order by proname), '[]'::jsonb) from pg_proc
      where pronamespace = 'public'::regnamespace and proname like 'count_gatherings%'))));
  reset role;

  -- Pin averaging (item 146 Option A): pins read as the host (who may see all of these), radius tests as the stranger.
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  for i in 1..10 loop -- a weekly series from one point (each occurrence is created on its own day: reset the daily cap)
    perform set_config('app.trusted_update', 'true', true);
    update profiles set gatherings_created_date = null where id = v_host;
    insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
      values (v_host, 'J146 series ' || i, now() + (i || ' weeks')::interval, ${LAT}, ${LNG}, 'Coffee', 'journey', 10, 'everyone')
      returning id into v_safe_id;
    v_series := v_series || v_safe_id;
  end loop;
  perform set_config('app.trusted_update', 'true', true);
  update profiles set gatherings_created_date = null where id = v_host;
  select * into v_base from get_gathering_distances(0, 0, array[v_open]);
  v_cell_lat := floor(${LAT} / 0.007) * 0.007;
  v_cell_lng := floor(${LNG} / 0.007) * 0.007;
  -- another point in the same cell (a different, known spot), and the cell corner farthest from the pin
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J146 spread', now() + interval '1 day', v_cell_lat + 0.0001, v_cell_lng + 0.0068, 'Coffee', 'journey', 10, 'everyone')
    returning id into v_spread;
  v_far_lat := case when v_base.fuzzed_lat - v_cell_lat > 0.0035 then v_cell_lat + 0.00001 else v_cell_lat + 0.00699 end;
  v_far_lng := case when v_base.fuzzed_lng - v_cell_lng > 0.0035 then v_cell_lng + 0.00001 else v_cell_lng + 0.00699 end;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_host, 'J146 far corner', now() + interval '1 day', v_far_lat, v_far_lng, 'Coffee', 'journey', 10, 'invite_only', false)
    returning id into v_far;
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id, status) values (v_host, v_inv, 'gathering', v_far, 'pending');
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J146 next cell', now() + interval '1 day', ${LAT} + 0.007, ${LNG}, 'Coffee', 'journey', 10, 'everyone')
    returning id into v_other_cell;
  perform set_config('request.jwt.claims', json_build_object('sub', v_str, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_str, 'J146 other host', now() + interval '1 day', ${LAT}, ${LNG}, 'Coffee', 'journey', 10, 'everyone')
    returning id into v_other_host;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  set local role authenticated;
  log := log || jsonb_build_array(jsonb_build_object('step', 'averaging', 'ok', true, 'data', jsonb_build_object(
    'base', jsonb_build_object('lat', v_base.fuzzed_lat, 'lng', v_base.fuzzed_lng),
    'cell', jsonb_build_object('lat', v_cell_lat, 'lng', v_cell_lng),
    'same_point_pins', (select count(distinct (fuzzed_lat, fuzzed_lng)) from get_gathering_distances(0, 0, array[v_open, v_appr, v_full, v_priv] || v_series)),
    'same_point_rows', (select count(*) from get_gathering_distances(0, 0, array[v_open, v_appr, v_full, v_priv] || v_series)),
    'series_mean', (select jsonb_build_object('lat', avg(fuzzed_lat), 'lng', avg(fuzzed_lng)) from get_gathering_distances(0, 0, v_series)),
    'spread', (select jsonb_build_object('lat', fuzzed_lat, 'lng', fuzzed_lng) from get_gathering_distances(0, 0, array[v_spread])),
    'spread_point', jsonb_build_object('lat', v_cell_lat + 0.0001, 'lng', v_cell_lng + 0.0068),
    'far', (select jsonb_build_object('lat', fuzzed_lat, 'lng', fuzzed_lng) from get_gathering_distances(0, 0, array[v_far])),
    'far_point', jsonb_build_object('lat', v_far_lat, 'lng', v_far_lng),
    'next_cell', (select jsonb_build_object('lat', fuzzed_lat, 'lng', fuzzed_lng) from get_gathering_distances(0, 0, array[v_other_cell])),
    'refresh', (select jsonb_build_object('lat', fuzzed_lat, 'lng', fuzzed_lng) from get_gathering_distances(-30, 100, array[v_open])))));
  reset role;
  -- the other host reads their own pin
  perform set_config('request.jwt.claims', json_build_object('sub', v_str, 'role', 'authenticated')::text, true);
  set local role authenticated;
  log := log || jsonb_build_array(jsonb_build_object('step', 'other_host', 'ok', true, 'data', (
    select jsonb_build_object('lat', fuzzed_lat, 'lng', fuzzed_lng) from get_gathering_distances(0, 0, array[v_other_host]))));
  reset role;
  -- radius boundary and pre-filter on the invite-only far-corner gathering, as its invitee (public gatherings skip the radius,
  -- and the host never sees their own gatherings in this list)
  perform set_config('request.jwt.claims', json_build_object('sub', v_inv, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_d := (select distance_miles from get_gathering_distances(v_base.fuzzed_lat + 0.01, v_base.fuzzed_lng, array[v_far]));
  log := log || jsonb_build_array(jsonb_build_object('step', 'radius', 'ok', true, 'data', jsonb_build_object(
    'just_inside', exists (select 1 from get_bounded_nearby_gathering_ids(v_base.fuzzed_lat + 0.01, v_base.fuzzed_lng, v_d + 0.001) b where b.id = v_far),
    'just_outside', exists (select 1 from get_bounded_nearby_gathering_ids(v_base.fuzzed_lat + 0.01, v_base.fuzzed_lng, v_d - 0.001) b where b.id = v_far),
    'far_corner_around_pin', exists (select 1 from get_bounded_nearby_gathering_ids(v_base.fuzzed_lat, v_base.fuzzed_lng, 0.01) b where b.id = v_far),
    'far_corner_around_point', exists (select 1 from get_bounded_nearby_gathering_ids(v_far_lat, v_far_lng, 0.05) b where b.id = v_far))));
  reset role;

  log := log || jsonb_build_array(jsonb_build_object('step', 'grants', 'ok', true, 'data', jsonb_build_object(
    'anon_table_select', has_table_privilege('anon', 'public.gatherings', 'SELECT'),
    'auth_table_select', has_table_privilege('authenticated', 'public.gatherings', 'SELECT'),
    'unreadable_for_anon', (select coalesce(jsonb_agg(attname order by attname), '[]'::jsonb) from pg_attribute
      where attrelid = 'public.gatherings'::regclass and attnum > 0 and not attisdropped
        and not has_column_privilege('anon', 'public.gatherings', attname, 'SELECT')),
    'unreadable_for_authenticated', (select coalesce(jsonb_agg(attname order by attname), '[]'::jsonb) from pg_attribute
      where attrelid = 'public.gatherings'::regclass and attnum > 0 and not attisdropped
        and not has_column_privilege('authenticated', 'public.gatherings', attname, 'SELECT')),
    'host_can_still_write_point', has_column_privilege('authenticated', 'public.gatherings', 'precise_lat', 'INSERT'),
    'private_schema_usage', has_schema_privilege('authenticated', 'private', 'USAGE') or has_schema_privilege('anon', 'private', 'USAGE'),
    'secret_readable', has_table_privilege('authenticated', 'private.pin_secret', 'SELECT') or has_table_privilege('anon', 'private.pin_secret', 'SELECT'),
    'pin_fn_callable', has_function_privilege('authenticated', 'private.gathering_location_pin(uuid, uuid, double precision, double precision)', 'execute')
      or has_function_privilege('anon', 'private.gathering_location_pin(uuid, uuid, double precision, double precision)', 'execute'),
    'old_per_gathering_pin_exists', exists (select 1 from pg_proc where proname = 'gathering_pin' and pronamespace = 'private'::regnamespace),
    'count_single_exists', exists (select 1 from pg_proc where proname = 'count_gatherings_near' and pronamespace = 'public'::regnamespace),
    'anon_distances', has_function_privilege('anon', 'public.get_gathering_distances(double precision, double precision, uuid[])', 'execute'),
    'anon_meetup', has_function_privilege('anon', 'public.get_gathering_meetup_point(uuid)', 'execute'))));`);
    s = stepMap(log);
  }, 180000);

  const data = (k) => s[k].data;
  const refused = { direct: 'denied', star: 'denied', row: 'denied', filter: 'denied' };
  const exact = [{ lat: LAT, lng: LNG }];
  const pick = (k) => ({ direct: data(k).direct, star: data(k).star, row: data(k).row, filter: data(k).filter });

  test('the actors are in the states they claim', () => {
    expect(data('statuses')).toEqual({ approved: 'approved', pending: 'pending', waitlisted: 'waitlisted' });
  });

  test("the host still creates (insert returning named columns) and edits a gathering; `returning *` is refused", () => {
    expect(data('host_writes')).toEqual({ edited: 'J146 edited', point_stored: true, returning_star: 'denied' });
  });

    test.each(['anon_public', 'anon_invite_only'])('signed-out visitor (%s): every direct read of the point refused; cannot call the lookup', (k) => {
    expect(pick(k)).toEqual(refused);
    expect(data(k).meet).toBe('denied');
  });

  test.each(['stranger_public', 'stranger_invite_only', 'pending', 'waitlisted', 'invited'])('%s: every direct read refused; the lookup gives nothing', (k) => {
    expect(pick(k)).toEqual(refused);
    expect(data(k).meet).toEqual([]);
  });

  test.each(['approved', 'host', 'host_invite_only'])('%s: direct reads refused too; the lookup gives the exact point', (k) => {
    expect(pick(k)).toEqual(refused);
    expect(data(k).meet).toEqual(exact);
  });

  test('ordinary reads of the allowed columns keep working for every actor who may see the row', () => {
    for (const k of ['stranger_public', 'pending', 'waitlisted', 'approved', 'host']) {
      expect(data(k).safe).toEqual({ title: expect.stringMatching(/^J146 /), area: 'journey', visibility: 'everyone' });
    }
    // Item 147 (2026-10-17): rows reach only who may see them (journey gatheringRowPrivacy); signed out = no row at all.
    expect(data('invited').safe).toEqual({ title: 'J146 invite-only', area: 'journey', visibility: 'invite_only' });
    for (const k of ['anon_public', 'anon_invite_only', 'stranger_invite_only']) expect(data(k).safe).toBeNull();
  });

  test("get_gathering_distances: a keyed pin in the point's cell, stable, not reversible by the old md5 offset, distance to the pin", () => {
    const p = data('distances');
    expect(Math.floor(p.pin_lat / 0.007)).toBe(Math.floor(LAT / 0.007));
    expect(Math.floor(p.pin_lng / 0.007)).toBe(Math.floor(LNG / 0.007));
    expect(Math.abs(p.pin_lat - LAT) + Math.abs(p.pin_lng - LNG)).toBeGreaterThan(1e-6);
    expect(p.again).toEqual({ lat: p.pin_lat, lng: p.pin_lng });
    expect(Math.abs(p.md5_recovered_lat - LAT) + Math.abs(p.md5_recovered_lng - LNG)).toBeGreaterThan(1e-6);
    expect(p.distance_from_origin).toBeCloseTo(miles(0, 0, p.pin_lat, p.pin_lng), 6);
    expect(p.from_precise).toBeCloseTo(miles(LAT, LNG, p.pin_lat, p.pin_lng), 6);
    expect(p.from_precise).toBeGreaterThan(0);
  });

  test('get_bounded_nearby_gathering_ids tests the pin, never the precise point', () => {
    expect(data('bounded')).toEqual({ around_pin: true, around_point: false });
  });

  test('place counts are gone: a signed-in grid scan cannot run, and no count_gatherings* function exists', () => {
    expect(data('counts')).toEqual({ grid_scan: 'undefined', count_functions: [] });
  });

  test('pin averaging: one host, one point = one pin for every gathering (a weekly series included); the mean is that pin', () => {
    const a = data('averaging');
    expect(a.same_point_rows).toBe(14);
    expect(a.same_point_pins).toBe(1);
    expect(a.series_mean.lat).toBeCloseTo(a.base.lat, 9);
    expect(a.series_mean.lng).toBeCloseTo(a.base.lng, 9);
    expect(a.refresh).toEqual(a.base);
  });

  test('pin averaging: another point in the same cell shares the pin, and no stable offset recovers it from a known point', () => {
    const a = data('averaging');
    expect(a.spread).toEqual(a.base);
    expect(a.far).toEqual(a.base);
    // Option C's attack: learn the offset from one known point (the series' LAT/LNG), apply it to another gathering's pin.
    const off = { lat: a.base.lat - LAT, lng: a.base.lng - LNG };
    for (const [pin, point] of [[a.spread, a.spread_point], [a.far, a.far_point]]) {
      const guess = { lat: pin.lat - off.lat, lng: pin.lng - off.lng };
      expect(Math.abs(guess.lat - point.lat) + Math.abs(guess.lng - point.lng)).toBeGreaterThan(0.001);
    }
  });

  test('pin averaging: another host at the same point, or the next cell, gets a different pin', () => {
    const a = data('averaging');
    expect(data('other_host')).not.toEqual(a.base);
    expect(Math.floor(data('other_host').lat / 0.007)).toBe(Math.floor(LAT / 0.007));
    expect(a.next_cell).not.toEqual(a.base);
    expect(Math.floor(a.next_cell.lat / 0.007)).toBe(Math.floor(LAT / 0.007) + 1);
  });

  test('radius boundary is the pin; the widened pre-filter still finds a point at the far corner of its cell', () => {
    expect(data('radius')).toEqual({
      just_inside: true, just_outside: false, far_corner_around_pin: true, far_corner_around_point: false,
    });
  });

  test('grants: column allowlist (all but the point), host still writes it, secret + pin function unreachable, single count gone', () => {
    expect(data('grants')).toEqual({
      anon_table_select: false, auth_table_select: false,
      unreadable_for_anon: ['precise_lat', 'precise_lng'], unreadable_for_authenticated: ['precise_lat', 'precise_lng'],
      host_can_still_write_point: true, private_schema_usage: false, secret_readable: false, pin_fn_callable: false,
      old_per_gathering_pin_exists: false,
      count_single_exists: false, anon_distances: false, anon_meetup: false,
    });
  });
});
