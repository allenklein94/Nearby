// Journey (item 87 audit): PEOPLE MATCH. Two people opt in to "free tonight" -> each sees the other only as a mutual
// "Both free tonight" -> they become a match -> only then is a coarse distance available (whole miles, participant-only)
// -> a stranger never gets it -> a block ends the mutual signal. Rolled back; the client helpers run on the DB's output.
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { matchDistanceLabel, MUTUAL_FREE_TONIGHT_LINE } from '../utils/freeTonight';

const d = hasToken ? describe : describe.skip;

d('journey: free tonight (mutual) -> match -> distance only for the pair -> block ends it', () => {
  let s;
  beforeAll(async () => {
    const p = await runSql(`select id from profiles order by created_at limit 3;`);
    const log = await runJourney(`
      v_a uuid := '${p[0].id}'; v_b uuid := '${p[1].id}'; v_c uuid := '${p[2].id}'; v_m uuid; v_n int; v_d int; v_ids uuid[];`, `
  -- 1. only b opts in: a (not opted in) sees nobody, so nothing can leak a one-sided flag
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_free_tonight(now() + interval '5 hours');
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  select array_agg(user_id) into v_ids from get_mutual_free_tonight(array[v_b, v_c]);
  log := log || jsonb_build_array(jsonb_build_object('step','one_sided_shows_nothing','ok', v_ids is null));

  -- 2. a opts in too: b is mutual, c (not opted in) is not, self never
  perform set_free_tonight(now() + interval '5 hours');
  select array_agg(user_id) into v_ids from get_mutual_free_tonight(array[v_b, v_c, v_a]);
  log := log || jsonb_build_array(jsonb_build_object('step','mutual_only','ok', v_ids = array[v_b]));

  insert into notification_areas (user_id, area) values (v_a, '40.00,-75.00') on conflict (user_id) do update set area = '40.00,-75.00', updated_at = now();
  insert into notification_areas (user_id, area) values (v_b, '40.00,-75.05') on conflict (user_id) do update set area = '40.00,-75.05', updated_at = now();
  -- 3. no match yet: both areas ARE known (so a null is not just "missing data"), the pair has no match row, and the only
  -- distance door (get_match_distance, keyed by match id) has nothing to open for them
  select count(*) into v_n from matches where (user_a = v_a and user_b = v_b) or (user_a = v_b and user_b = v_a);
  v_d := get_match_distance(gen_random_uuid());
  log := log || jsonb_build_array(jsonb_build_object('step','no_match_no_distance',
     'ok', v_n = 0 and v_d is null and (select count(*) from notification_areas where user_id in (v_a, v_b)) = 2,
     'data', jsonb_build_object('match_rows', v_n)));

  -- 3b. a REAL match exists (a with c). b, who is mutual-free with a but has NO match with anyone, cannot read its distance
  insert into notification_areas (user_id, area) values (v_c, '40.00,-75.02') on conflict (user_id) do update set area = '40.00,-75.02', updated_at = now();
  insert into matches (user_a, user_b) values (v_a, v_c) returning id into v_m;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step','unmatched_person_cannot_read_a_real_match','ok', get_match_distance(v_m) is null));
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step','the_real_match_itself_reads_fine','ok', get_match_distance(v_m) is not null));

  -- 4. they match: the pair gets whole-mile distance
  insert into matches (user_a, user_b) values (v_a, v_b) returning id into v_m;
  v_d := get_match_distance(v_m);
  log := log || jsonb_build_array(jsonb_build_object('step','match_distance','ok', v_d between 2 and 4, 'data', jsonb_build_object('miles', v_d)));

  -- 5. a stranger to the match gets nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step','stranger_gets_nothing','ok', get_match_distance(v_m) is null));

  -- 6. a blocks b: the mutual signal ends for both directions
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  insert into blocks (blocker_id, blocked_id) values (v_a, v_b);
  select array_agg(user_id) into v_ids from get_mutual_free_tonight(array[v_b]);
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  select count(*) into v_n from get_mutual_free_tonight(array[v_a]);
  log := log || jsonb_build_array(jsonb_build_object('step','block_ends_mutual','ok', v_ids is null and v_n = 0));
`);
    s = stepMap(log);
  }, 60000);

  test.each(['one_sided_shows_nothing', 'mutual_only', 'no_match_no_distance', 'unmatched_person_cannot_read_a_real_match', 'the_real_match_itself_reads_fine', 'match_distance', 'stranger_gets_nothing', 'block_ends_mutual'])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    expect(s[n].ok).toBe(true);
  });

  test('the client words what the DB returned: whole miles only, unknown says nothing', () => {
    expect(matchDistanceLabel(s.match_distance.data.miles)).toMatch(/^About \d+ mi away$/);
    expect(matchDistanceLabel(null)).toBeNull();
    expect(MUTUAL_FREE_TONIGHT_LINE).toBe('🌙 Both free tonight');
  });
});
