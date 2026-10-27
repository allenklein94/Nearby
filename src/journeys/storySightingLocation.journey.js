// Owner item 148 (2026-10-17, D1-D4 LOCKED): Nearby never stores a story's or a sighting's precise location. Every actor
// runs under the REAL database role the API uses (`set local role anon` / `authenticated` + JWT claims), like journey
// `preciseLocation`, so table/column grants and the triggers are exercised, not bypassed:
//   stories: a public story posted at an exact point stores only the pin (the exact value is in no column); 30 posts from
//     the same place (GPS jitter) and a post elsewhere in the same cell all get ONE pin (nothing to average); another
//     person at the same place gets a different pin; another cell, another pin; a later UPDATE back to the exact point
//     stores the pin again; the map RPC returns the stored pin and the old md5 reversal no longer gives the point;
//     direct latitude/longitude reads are refused for anon, a stranger, a friend and the poster; the app's own reads work.
//   business moments (D3): a moment posted with coordinates stores none.
//   sightings (D4): approx_area is stored as the pair's pin (either order, same pin), never the exact value; the other
//     participant cannot read approx_area directly; unparseable values store nothing; get_sighting_fuzzed_coords is gone.
//   grants: the pin function, the triggers' functions and the secret are out of client reach.
// Rolled back. Coordinates are mid-Atlantic, away from a cell edge (12.3456789 / 0.007 = 1763.67, -45.6789123 / 0.007 = -6525.56).
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const LAT = 12.3456789;
const LNG = -45.6789123;
const CELL = 0.007;
const EXACT = '12.3456789';

const md5Offset = (id, axis) => `(((('x' || substr(md5(${id}::text || '${axis}'), 1, 8))::bit(32)::bigint % 1000) / 1000.0 - 0.5) * 0.007)`;

function as(sub) {
  return sub
    ? `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true); set local role authenticated;`
    : `perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); set local role anon;`;
}

// One actor's direct reads of the location columns, plus the app's own column lists.
function reads(step, sub) {
  return `${as(sub)}
  begin perform latitude from stories where id = v_pub; v_a := 'readable';
  exception when insufficient_privilege then v_a := 'denied'; end;
  begin perform * from stories where id = v_pub; v_b := 'readable';
  exception when insufficient_privilege then v_b := 'denied'; end;
  begin perform 1 from stories where latitude > 0; v_c := 'readable';
  exception when insufficient_privilege then v_c := 'denied'; end;
  begin perform approx_area from sightings where id = v_s; v_d := 'readable';
  exception when insufficient_privilege then v_d := 'denied'; end;
  begin perform (select s from sightings s where s.id = v_s); v_e := 'readable';
  exception when insufficient_privilege then v_e := 'denied'; end;
  begin select count(*) into v_n from (
      select id, user_id, media_path, media_type, created_at, expires_at, gathering_id, partner_id from stories where gathering_id is null
    ) x;
    v_app := jsonb_build_object('stories', v_n);
    select count(*) into v_n from (select id, user_a, user_b, last_seen_at from sightings) x;
    v_app := v_app || jsonb_build_object('sightings', v_n);
  exception when others then v_app := to_jsonb(sqlerrm); end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', jsonb_build_object(
    'story_lat', v_a, 'story_star', v_b, 'story_filter', v_c, 'sighting_area', v_d, 'sighting_row', v_e, 'app_reads', v_app)));`;
}

d('journey: stories and sightings never store a precise location (item 148)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      v_p uuid := gen_random_uuid(); v_f uuid := gen_random_uuid(); v_str uuid := gen_random_uuid(); v_o uuid := gen_random_uuid();
      v_biz uuid := gen_random_uuid(); u uuid; v_partner uuid; i int;
      v_pub uuid; v_same uuid; v_other_cell uuid; v_other_person uuid; v_moment uuid; v_s uuid; v_s2 uuid; v_bad uuid;
      v_a text; v_b text; v_c text; v_d text; v_e text; v_n int; v_app jsonb; v_rpc jsonb; v_err text;`, `
  foreach u in array array[v_p, v_f, v_str, v_o, v_biz] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@j148.test');
    update auth.users set phone = '1555' || lpad(((('x0' || substr(md5(id::text), 1, 7))::bit(32)::int) % 100000000)::text, 8, '0'), phone_confirmed_at = now() where id in (u);
    insert into profiles (id, display_name, birthdate) values (u, 'J148-' || left(u::text, 4), date '1990-01-01');
  end loop;
  insert into friendships (user_a, user_b, status, requested_by) values (v_p, v_f, 'accepted', v_p);
  insert into brand_partners (name, tier) values ('J148 Cafe', 'growth') returning id into v_partner;
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = v_partner where id = v_biz;

  -- the poster's own inserts, the way uploadStory makes them (insert, no returning)
  ${as('v_p')}
  insert into stories (id, user_id, media_path, media_type, is_public, latitude, longitude)
    values (gen_random_uuid(), v_p, v_p || '/0.jpg', 'image', true, ${LAT}, ${LNG});
  reset role;
  select id into v_pub from stories where user_id = v_p;
  log := log || jsonb_build_array(jsonb_build_object('step', 'stored', 'ok', true, 'data', (
    select jsonb_build_object('lat', latitude, 'lng', longitude, 'row_has_exact', position('${EXACT}' in to_jsonb(st)::text) > 0)
    from stories st where id = v_pub)));

  -- 30 more posts from the same place (+/- ~30 m of GPS jitter), 15 per "day" (the daily limit is 20)
  for i in 1..30 loop
    if i = 16 then update profiles set stories_posted_today = 0 where id = v_p; end if;
    ${as('v_p')}
    insert into stories (user_id, media_path, media_type, is_public, latitude, longitude)
      values (v_p, v_p || '/' || i || '.jpg', 'image', true, ${LAT} + (random() - 0.5) * 0.0006, ${LNG} + (random() - 0.5) * 0.0006);
    reset role;
  end loop;
  update profiles set stories_posted_today = 0 where id = v_p;
  ${as('v_p')}
  -- ~250 m away, still the same cell (cell fractions 0.67 -> 0.38 lat, 0.44 -> 0.58 lng); then a point in the next cell north
  insert into stories (user_id, media_path, media_type, is_public, latitude, longitude)
    values (v_p, v_p || '/samecell.jpg', 'image', true, ${LAT} - 0.002, ${LNG} + 0.001);
  insert into stories (user_id, media_path, media_type, is_public, latitude, longitude)
    values (v_p, v_p || '/othercell.jpg', 'image', true, ${LAT} + 0.01, ${LNG});
  reset role;
  select id into v_same from stories where media_path = v_p || '/samecell.jpg';
  select id into v_other_cell from stories where media_path = v_p || '/othercell.jpg';
  ${as('v_o')}
  insert into stories (user_id, media_path, media_type, is_public, latitude, longitude)
    values (v_o, v_o || '/0.jpg', 'image', true, ${LAT}, ${LNG});
  reset role;
  select id into v_other_person from stories where user_id = v_o;
  log := log || jsonb_build_array(jsonb_build_object('step', 'stable', 'ok', true, 'data', jsonb_build_object(
    'posts', (select count(*) from stories where user_id = v_p and media_path not like '%cell.jpg'),
    'distinct_pins', (select count(distinct (latitude, longitude)) from stories where user_id = v_p and media_path not like '%cell.jpg'),
    'mean_lat', (select avg(latitude) from stories where user_id = v_p and media_path not like '%cell.jpg'),
    'mean_lng', (select avg(longitude) from stories where user_id = v_p and media_path not like '%cell.jpg'),
    'any_exact', (select count(*) from stories where latitude = ${LAT} or longitude = ${LNG}),
    'same_cell', (select jsonb_build_object('lat', latitude, 'lng', longitude) from stories where id = v_same),
    'other_cell', (select jsonb_build_object('lat', latitude, 'lng', longitude) from stories where id = v_other_cell),
    'other_person', (select jsonb_build_object('lat', latitude, 'lng', longitude) from stories where id = v_other_person))));

  -- a trusted write back to the exact point (no client UPDATE exists) stores the pin again
  update stories set latitude = ${LAT}, longitude = ${LNG} where id = v_pub;
  log := log || jsonb_build_array(jsonb_build_object('step', 'rewritten', 'ok', true, 'data', (
    select jsonb_build_object('lat', latitude, 'lng', longitude) from stories where id = v_pub)));

  -- D3: a business moment, posted the way uploadBusinessMoment would (with coordinates sent anyway)
  ${as('v_biz')}
  insert into stories (user_id, media_path, media_type, is_public, latitude, longitude, partner_id)
    values (v_biz, v_biz || '/m.jpg', 'image', false, ${LAT}, ${LNG}, v_partner);
  reset role;
  select id into v_moment from stories where user_id = v_biz;
  log := log || jsonb_build_array(jsonb_build_object('step', 'moment', 'ok', true, 'data', (
    select jsonb_build_object('lat', latitude, 'lng', longitude, 'partner', partner_id = v_partner) from stories where id = v_moment)));

  -- invalid / half coordinates store nothing
  update profiles set stories_posted_today = 0 where id = v_f;
  ${as('v_f')}
  insert into stories (user_id, media_path, media_type, is_public, latitude, longitude) values (v_f, v_f || '/h.jpg', 'image', true, ${LAT}, null);
  insert into stories (user_id, media_path, media_type, is_public, latitude, longitude) values (v_f, v_f || '/x.jpg', 'image', true, 123, ${LNG});
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'invalid', 'ok', true, 'data', (
    select jsonb_agg(jsonb_build_object('lat', latitude, 'lng', longitude) order by media_path) from stories where user_id = v_f)));

  -- the map, as a stranger
  ${as('v_str')}
  select jsonb_build_object('lat', r.fuzzed_lat, 'lng', r.fuzzed_lng,
      'md5_lat', r.fuzzed_lat - ${md5Offset('r.id', 'lat')}, 'md5_lng', r.fuzzed_lng - ${md5Offset('r.id', 'lng')})
    into v_rpc from get_public_stories_with_fuzzed_coords() r where r.id = v_pub;
  select count(*) into v_n from get_public_stories_with_fuzzed_coords() r where r.id = v_moment;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'map', 'ok', true, 'data', v_rpc || jsonb_build_object(
    'stored', (select jsonb_build_object('lat', latitude, 'lng', longitude) from stories where id = v_pub), 'moment_on_map', v_n)));

  -- D4: sightings (written by the server only; no client insert path exists)
  insert into sightings (user_a, user_b, approx_area, first_seen_at, last_seen_at, expires_at)
    values (v_p, v_f, '12.3457,-45.6789', now(), now(), now() + interval '1 day') returning id into v_s;
  insert into sightings (user_a, user_b, approx_area, first_seen_at, last_seen_at, expires_at)
    values (v_f, v_p, '12.3459,-45.6787', now(), now(), now() + interval '1 day') returning id into v_s2;
  insert into sightings (user_a, user_b, approx_area, first_seen_at, last_seen_at, expires_at)
    values (v_p, v_str, 'somewhere', now(), now(), now() + interval '1 day') returning id into v_bad;
  update sightings set approx_area = approx_area where id = v_s;
  log := log || jsonb_build_array(jsonb_build_object('step', 'sightings', 'ok', true, 'data', jsonb_build_object(
    'area', (select approx_area from sightings where id = v_s),
    'swapped_pair', (select approx_area from sightings where id = v_s2),
    'unparseable', (select approx_area from sightings where id = v_bad),
    'old_fn_exists', exists (select 1 from pg_proc where proname = 'get_sighting_fuzzed_coords'))));

  ${reads('anon', null)}
  ${reads('stranger', 'v_str')}
  ${reads('friend', 'v_f')}
  ${reads('poster', 'v_p')}

  log := log || jsonb_build_array(jsonb_build_object('step', 'grants', 'ok', true, 'data', jsonb_build_object(
    'stories_unreadable', (select coalesce(jsonb_agg(attname order by attname), '[]'::jsonb) from pg_attribute
      where attrelid = 'public.stories'::regclass and attnum > 0 and not attisdropped
        and not (has_column_privilege('anon', 'public.stories', attname, 'SELECT') and has_column_privilege('authenticated', 'public.stories', attname, 'SELECT'))),
    'sightings_unreadable', (select coalesce(jsonb_agg(attname order by attname), '[]'::jsonb) from pg_attribute
      where attrelid = 'public.sightings'::regclass and attnum > 0 and not attisdropped
        and not (has_column_privilege('anon', 'public.sightings', attname, 'SELECT') and has_column_privilege('authenticated', 'public.sightings', attname, 'SELECT'))),
    'pin_fn_callable', has_function_privilege('authenticated', 'private.location_pin(text, text, double precision, double precision)', 'execute')
      or has_function_privilege('anon', 'private.location_pin(text, text, double precision, double precision)', 'execute'),
    'trigger_fns_callable', has_function_privilege('authenticated', 'private.story_location_to_pin()', 'execute')
      or has_function_privilege('authenticated', 'private.sighting_area_to_pin()', 'execute'),
    'secret_readable', has_table_privilege('authenticated', 'private.pin_secret', 'SELECT') or has_table_privilege('anon', 'private.pin_secret', 'SELECT'),
    'map_rpc_anon', has_function_privilege('anon', 'public.get_public_stories_with_fuzzed_coords()', 'execute'))));`);
    s = stepMap(log);
  }, 180000);

  const data = (k) => s[k].data;
  const cellOf = (v) => Math.floor(v / CELL);
  const inCell = (pin, lat, lng) => cellOf(pin.lat) === cellOf(lat) && cellOf(pin.lng) === cellOf(lng);

  test('D1: a public story stores only a pin in its cell, never the exact point (no column holds it)', () => {
    const p = data('stored');
    expect(p.row_has_exact).toBe(false);
    expect(p.lat).not.toBe(LAT);
    expect(p.lng).not.toBe(LNG);
    expect(inCell(p, LAT, LNG)).toBe(true);
    expect(data('stable').any_exact).toBe(0);
  });

  test('D2: 31 posts from one place (with GPS jitter) and a post elsewhere in the cell share ONE pin; averaging gives the pin, not the point', () => {
    const st = data('stable');
    const p = data('stored');
    expect(st.posts).toBe(31);
    expect(st.distinct_pins).toBe(1);
    expect(st.mean_lat).toBeCloseTo(p.lat, 9);
    expect(st.mean_lng).toBeCloseTo(p.lng, 9);
    expect(st.same_cell).toEqual({ lat: p.lat, lng: p.lng });
  });

  test('D2: another cell gives another pin; another person at the same place gets their own pin', () => {
    const st = data('stable');
    const p = data('stored');
    expect(inCell(st.other_cell, LAT + 0.01, LNG)).toBe(true);
    expect(st.other_cell).not.toEqual({ lat: p.lat, lng: p.lng });
    expect(inCell(st.other_person, LAT, LNG)).toBe(true);
    expect(st.other_person).not.toEqual({ lat: p.lat, lng: p.lng });
  });

  test('a later write back to the exact point stores the same pin again (idempotent, never the point)', () => {
    const p = data('stored');
    expect(data('rewritten')).toEqual({ lat: p.lat, lng: p.lng });
  });

  test('D3: a business moment stores no location', () => {
    expect(data('moment')).toEqual({ lat: null, lng: null, partner: true });
  });

  test('half or out-of-range coordinates store nothing', () => {
    expect(data('invalid')).toEqual([{ lat: null, lng: null }, { lat: null, lng: null }]);
  });

  test('the map returns the stored pin; the old md5 reversal no longer gives the point; business moments are never on it', () => {
    const m = data('map');
    expect({ lat: m.lat, lng: m.lng }).toEqual(m.stored);
    expect(Math.abs(m.md5_lat - LAT) + Math.abs(m.md5_lng - LNG)).toBeGreaterThan(1e-6);
    expect(m.moment_on_map).toBe(0);
  });

  test('D4: a sighting stores the pair\'s pin (either order), never the exact value; unparseable stores nothing; the old RPC is gone', () => {
    const sg = data('sightings');
    expect(sg.area).not.toBe('12.3457,-45.6789');
    const [lat, lng] = sg.area.split(',').map(Number);
    expect(inCell({ lat, lng }, 12.3457, -45.6789)).toBe(true);
    expect(sg.swapped_pair).toBe(sg.area);
    expect(sg.unparseable).toBeNull();
    expect(sg.old_fn_exists).toBe(false);
  });

  test.each(['anon', 'stranger', 'friend', 'poster'])('%s: direct reads of story/sighting location refused', (k) => {
    const r = data(k);
    expect({ a: r.story_lat, b: r.story_star, c: r.story_filter, d: r.sighting_area, e: r.sighting_row })
      .toEqual({ a: 'denied', b: 'denied', c: 'denied', d: 'denied', e: 'denied' });
  });

  test("the app's own reads (signed in) still work: poster, friend and stranger see what RLS allows", () => {
    for (const k of ['stranger', 'friend', 'poster']) {
      expect(data(k).app_reads).toEqual({ stories: expect.any(Number), sightings: expect.any(Number) });
    }
    // signed out: the app never reads these; the sightings policy already refused anon before item 148 (is_blocked)
    expect(data('anon').app_reads).toBe('permission denied for function is_blocked');
    expect(data('poster').app_reads.sightings).toBe(3); // two with the friend + one with the stranger
    expect(data('stranger').app_reads.sightings).toBe(1); // the stranger's own (unparseable) sighting with the poster
  });

  test('grants: only the location columns are unreadable; pin function, trigger functions and secret are out of reach', () => {
    expect(data('grants')).toEqual({
      stories_unreadable: ['latitude', 'longitude'],
      sightings_unreadable: ['approx_area'],
      pin_fn_callable: false,
      trigger_fns_callable: false,
      secret_readable: false,
      map_rpc_anon: false,
    });
  });
});
