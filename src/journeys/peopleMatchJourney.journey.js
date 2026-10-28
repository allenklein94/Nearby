// Journey (item 87 audit): PEOPLE MATCH. Two people opt in to "free tonight" -> each sees the other only as a mutual
// "Both free tonight" -> they become a match -> only then is a coarse distance available (whole miles, participant-only)
// -> a stranger never gets it -> a block ends the mutual signal. Rolled back; the client helpers run on the DB's output.
//
// Owner item 86 (2026-10-12): a typed people ask -> People mode. The DB half reads friend-discovery candidates as the asker
// would (get_friend_discovery_candidates, the RPC People -> Friends calls); the client half sends the typed words through the
// PRODUCTION search pipeline (runIntentSearch: the real classifyCreateRequest falling back to its deterministic rules, as in
// prod today) and the real People-mode helpers on those rows. Only network edges are replaced; the screen is not rendered.
jest.mock('expo-location', () => ({}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('../services/places', () => ({ getGoogleMapsRequestHeaders: () => ({}) }));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('../services/behaviorSignals', () => ({ recordSearchBehavior: jest.fn(), getMyLearnedAffinity: jest.fn(async () => ({ behavior: {}, maturity: null })) }));
jest.mock('../services/intentOutcomes', () => ({ recordIntentSubmission: jest.fn(async () => 'sub-1') }));
// Modules the search pipeline imports; a people ask returns before any of them is called (the supabase mock throws if it is).
jest.mock('../services/travelTime', () => ({ getTravelTimes: jest.fn(async () => null) }));
jest.mock('../services/homeDashboard', () => ({ getSocialForecast: jest.fn(async () => null) }));
jest.mock('../services/preferencePolls', () => ({ getWhoForPreferenceSignals: jest.fn(async () => ({ cuisineKeys: [], venueKeys: [] })) }));
jest.mock('../services/occasionPackages', () => ({ searchOccasionPackages: jest.fn(async () => []), formatOccasionPackageDetail: jest.fn() }));
jest.mock('../services/communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('../services/gatherings', () => ({ getNearbyGatherings: jest.fn(async () => []), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })) }));
jest.mock('../services/userLocation', () => ({ getUserLocation: jest.fn(async () => null) }));
jest.mock('../services/businessFulfillment', () => ({}));
jest.mock('../services/supabase', () => ({
  functionUrl: (n) => `https://example.invalid/${n}`,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 't', user: { id: 'asker' } } } }) },
    from: (t) => { throw new Error(`a people ask must not query ${t}`); },
    rpc: (n) => { throw new Error(`a people ask must not call ${n}`); },
  },
}));
const { runJourney, stepMap, hasToken, actorsSql, journeyPeople } = require('./journeyHarness');
import { matchDistanceLabel, MUTUAL_FREE_TONIGHT_LINE } from '../utils/freeTonight';
import { peopleModeParams, peopleAskUnderstood } from '../utils/peopleAsk';
import { understoodPieces } from '../utils/askUnderstood';
import { orderForTonight, countTonightSupply, peopleTonightBanner } from '../utils/meetTonight';

const d = hasToken ? describe : describe.skip;

d('journey: free tonight (mutual) -> match -> distance only for the pair -> block ends it', () => {
  let s;
  beforeAll(async () => {
    const p = journeyPeople(3);
    const log = await runJourney(`
      v_a uuid := '${p[0].id}'; v_b uuid := '${p[1].id}'; v_c uuid := '${p[2].id}'; v_m uuid; v_n int; v_d int; v_ids uuid[];`, `
  ${actorsSql({ people: ['v_a', 'v_b', 'v_c'] })}
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

d('journey (owner item 86): a typed people ask -> People mode, the right Dating/Friends, tonight-first', () => {
  let s;
  beforeAll(async () => {
    const p = journeyPeople(3);
    const log = await runJourney(`
      v_a uuid := '${p[0].id}'; v_far uuid := '${p[1].id}'; v_near uuid := '${p[2].id}'; v_rows jsonb;`, `
  ${actorsSql({ people: ['v_a', 'v_far', 'v_near'] })}
  -- three people opted into friend discovery, no prior relation between them (all rolled back). The far one shares an interest,
  -- so the server ranks it FIRST; the near one (same 0.1-degree bucket, as the app writes it) is the one "tonight" must lead with.
  perform set_config('app.trusted_update', 'on', true);
  delete from friendships where (user_a = v_a and user_b in (v_far, v_near)) or (user_b = v_a and user_a in (v_far, v_near));
  delete from matches where (user_a = v_a and user_b in (v_far, v_near)) or (user_b = v_a and user_a in (v_far, v_near));
  delete from friend_discovery_swipes where from_user = v_a and to_user in (v_far, v_near);
  delete from blocks where (blocker_id = v_a and blocked_id in (v_far, v_near)) or (blocked_id = v_a and blocker_id in (v_far, v_near));
  update profiles set open_to_friend_discovery = true, wide_area = '40.0,-75.0', interests = array['Pickleball'] where id = v_a;
  update profiles set open_to_friend_discovery = true, wide_area = '40.0,-75.1', interests = array['Pickleball'] where id = v_far;
  update profiles set open_to_friend_discovery = true, wide_area = '40.0,-75.0', interests = array[]::text[] where id = v_near;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_rows
    from get_friend_discovery_candidates(200) c where c.id in (v_far, v_near);
  log := log || jsonb_build_array(jsonb_build_object('step','friend_candidates','ok',
    jsonb_array_length(v_rows) = 2
    and v_rows->0->>'id' = v_far::text and v_rows->0->>'distance_bucket' = 'A few miles away'
    and v_rows->1->>'id' = v_near::text and v_rows->1->>'distance_bucket' = 'Nearby',
    'data', jsonb_build_object('rows', v_rows, 'far', v_far, 'near', v_near)));
`);
    s = stepMap(log);
  }, 60000);

  test('step friend_candidates: the server returns both, the far shared-interest one first', () => {
    expect(s.friend_candidates).toBeDefined();
    expect(s.friend_candidates.ok).toBe(true);
  });

  test('"I want to make new friends tonight" -> People on Friends with the tonight context; the near person leads', async () => {
    const { runIntentSearch } = require('../services/intentResolver');
    const r = await runIntentSearch('I want to make new friends tonight');
    expect(r.outcome).toBe('people');
    expect(r.items).toEqual([]); // no results list, no stranger in search
    expect(r.people).toEqual({ subMode: 'friends', tonight: true });
    const params = peopleModeParams(r.people);
    expect(params).toEqual({ initialMode: 'people', initialPeopleSubMode: 'friends', context: 'meet_tonight' });
    const { rows, far, near } = s.friend_candidates.data;
    const ordered = orderForTonight(rows, { subMode: params.initialPeopleSubMode });
    expect(ordered.map((x) => x.id)).toEqual([near, far]); // reordered only: nobody removed
    const count = countTonightSupply({ subMode: 'friends', list: rows });
    expect(count).toBe(1);
    expect(peopleTonightBanner({ subMode: 'friends', count })).toEqual({
      title: 'People worth meeting tonight', line: '1 person within a few miles could be new friends.', empty: false,
    });
  });

  test('"I want to meet someone tonight" -> People with the person\'s own default sub-mode, tonight context', async () => {
    const { runIntentSearch } = require('../services/intentResolver');
    const r = await runIntentSearch('I want to meet someone tonight');
    expect(r.outcome).toBe('people');
    expect(peopleModeParams(r.people)).toEqual({ initialMode: 'people', context: 'meet_tonight' });
  });

  test('"meet someone for a date tonight" -> Dating; "meet someone now" -> People plainly (no tonight banner)', async () => {
    const { runIntentSearch } = require('../services/intentResolver');
    expect(peopleModeParams((await runIntentSearch('meet someone for a date tonight')).people))
      .toEqual({ initialMode: 'people', initialPeopleSubMode: 'dating', context: 'meet_tonight' });
    expect(peopleModeParams((await runIntentSearch('meet someone now')).people)).toEqual({ initialMode: 'people' });
  });

  test('item 86 follow-up: People shows the understood chips the search read; a generic people ask shows none', async () => {
    const { runIntentSearch } = require('../services/intentResolver');
    const r = await runIntentSearch('I want to meet someone tonight');
    const u = peopleAskUnderstood(r.classifyResult, r.typedText);
    expect(understoodPieces(u.classifyResult, u.typedText)).toEqual(understoodPieces(r.classifyResult, r.typedText));
    expect(understoodPieces(u.classifyResult, u.typedText)).toEqual([{ key: 'when', window: 'tonight' }]);
    const plain = await runIntentSearch('I want to meet someone');
    expect(plain.outcome).toBe('people');
    expect(peopleAskUnderstood(plain.classifyResult, plain.typedText)).toBeNull();
    expect(peopleModeParams({ ...plain.people, understood: null })).toEqual({ initialMode: 'people' });
  });
});
