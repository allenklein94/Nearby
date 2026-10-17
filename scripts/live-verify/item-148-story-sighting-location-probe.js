// Item 148 (2026-10-17, scope evidence; after migration 20270321 it shows the fix: reads denied, md5 reversal off): who can read or reconstruct a story's / sighting's location, under the REAL
// database roles (anon / authenticated + JWT claims). Prints the step log; asserts nothing (it records the leak as found).
// One transaction, ALWAYS rolled back (journey harness). Run: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/item-148-story-sighting-location-probe.js
const { runJourney } = require('../../src/journeys/journeyHarness');
const LAT = 12.3456789, LNG = -45.6789123;
const off = (id, axis) => `(((('x' || substr(md5(${id}::text || '${axis}'), 1, 8))::bit(32)::bigint % 1000) / 1000.0 - 0.5) * 0.007)`;
function as(sub) {
  return sub ? `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true); set local role authenticated;`
             : `perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true); set local role anon;`;
}
function storyProbe(step, sub) {
  return `${as(sub)}
  begin select jsonb_agg(jsonb_build_object('lat', latitude, 'lng', longitude)) into v_a from stories where id in (v_pub, v_priv, v_old);
  exception when others then v_a := to_jsonb(sqlerrm); end;
  begin select count(*) into v_n from stories where latitude between ${LAT} - 0.0001 and ${LAT} + 0.0001; -- filter oracle
  exception when others then v_n := -1; end;
  begin select jsonb_agg(jsonb_build_object('id', r.id, 'fl', r.fuzzed_lat, 'rev_lat', r.fuzzed_lat - ${off('r.id', 'lat')}, 'rev_lng', r.fuzzed_lng - ${off('r.id', 'lng')}))
    into v_b from get_public_stories_with_fuzzed_coords() r where r.id = v_pub;
  exception when others then v_b := to_jsonb(sqlerrm); end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', jsonb_build_object('direct', v_a, 'filter_hits', v_n, 'rpc', v_b)));`;
}
function sightProbe(step, sub) {
  return `${as(sub)}
  begin select jsonb_agg(approx_area) into v_a from sightings where id = v_s;
  exception when others then v_a := to_jsonb(sqlerrm); end;
  begin select jsonb_agg(jsonb_build_object('fl', r.fuzzed_lat, 'rev_lat', r.fuzzed_lat - ${off('r.id', 'lat')}, 'rev_lng', r.fuzzed_lng - ${off('r.id', 'lng')}))
    into v_b from get_sighting_fuzzed_coords(array[v_s]) r;
  exception when others then v_b := to_jsonb(sqlerrm); end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', jsonb_build_object('approx_area', v_a, 'rpc', v_b)));`;
}
(async () => {
  const log = await runJourney(`
    v_p uuid := gen_random_uuid(); v_f uuid := gen_random_uuid(); v_str uuid := gen_random_uuid(); v_blk uuid := gen_random_uuid(); u uuid;
    v_pub uuid; v_priv uuid; v_old uuid; v_s uuid; v_a jsonb; v_b jsonb; v_n int;`, `
  foreach u in array array[v_p, v_f, v_str, v_blk] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@p148.test');
    insert into profiles (id, display_name, birthdate) values (u, 'P148-' || left(u::text, 4), date '1990-01-01');
  end loop;
  insert into friendships (user_a, user_b, status, requested_by) values (v_p, v_f, 'accepted', v_p);
  insert into blocks (blocker_id, blocked_id) values (v_p, v_blk);
  -- the poster's own inserts, the way uploadStory makes them (public = GPS captured; friends-only with coords sent anyway)
  ${as('v_p')}
  insert into stories (user_id, media_path, media_type, is_public, latitude, longitude) values (v_p, v_p || '/1.jpg', 'image', true, ${LAT}, ${LNG}) returning id into v_pub;
  insert into stories (user_id, media_path, media_type, is_public, latitude, longitude) values (v_p, v_p || '/2.jpg', 'image', false, ${LAT}, ${LNG}) returning id into v_priv;
  reset role;
  insert into stories (user_id, media_path, media_type, is_public, latitude, longitude, created_at, expires_at)
    values (v_p, v_p || '/3.jpg', 'image', true, ${LAT}, ${LNG}, now() - interval '2 day', now() - interval '1 day') returning id into v_old;
  ${storyProbe('story_anon', null)}
  ${storyProbe('story_stranger', 'v_str')}
  ${storyProbe('story_friend', 'v_f')}
  ${storyProbe('story_blocked', 'v_blk')}
  -- the poster can also rewrite coordinates after posting? (no UPDATE policy expected)
  ${as('v_p')}
  update stories set latitude = 0 where id = v_pub;
  get diagnostics v_n = row_count;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'poster_update_rows', 'ok', true, 'data', v_n));
  insert into sightings (user_a, user_b, approx_area, first_seen_at, last_seen_at, expires_at)
    values (v_p, v_f, round(${LAT}::numeric, 4) || ',' || round(${LNG}::numeric, 4), now(), now(), now() + interval '1 day') returning id into v_s;
  ${sightProbe('sight_anon', null)}
  ${sightProbe('sight_participant', 'v_f')}
  ${sightProbe('sight_stranger', 'v_str')}
  ${as('v_str')}
  begin insert into sightings (user_a, user_b, approx_area, first_seen_at, last_seen_at, expires_at) values (v_str, v_p, '0,0', now(), now(), now()); v_a := '"inserted"';
  exception when others then v_a := to_jsonb(sqlerrm); end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'sight_client_insert', 'ok', true, 'data', v_a));
  `);
  console.log(JSON.stringify(log, null, 1));
})().catch((e) => { console.error(e.message); process.exit(1); });
