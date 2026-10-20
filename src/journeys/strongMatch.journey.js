// Owner item 37 (2026-10-11): "Perfect Match" -> the strong-match moment. A host posts plans; a viewer types "coffee
// tomorrow"; the ONE rule (utils/strongMatch.js strongMatchPieces) is applied to the rows the database holds, with the
// distance the real get_gathering_distances RPC returns (the one the gatherings service calls), shaped exactly as
// services/intentResolver.js carries a gathering (category = interest_tag, startsAt = scheduled_at, distanceMiles):
//   A. Coffee, tomorrow noon, ~0.3 mi       -> strong: activity ✓ time ✓ place ✓
//   B. Coffee, tomorrow noon, ~7 mi         -> no claim (not close)
//   C. Coffee, in 3 days, ~0.3 mi           -> no claim (outside the asked day)
//   D. Board Games, tomorrow noon, ~0.3 mi  -> no claim (a different activity)
// An ask with no stated time makes no claim even for A. Rolled back. The moment itself (tier, Reduce Motion, readable from
// the first frame, Home + Discover top pick only) is checked in motion/strongMatch.test.js. Not covered: rendering on a device,
// and which result the resolver ranks first (the moment only ever decorates the existing top pick).
const { runJourney, stepMap, hasToken, actorsSql, journeyPeople } = require('./journeyHarness');
import { strongMatchPieces } from '../utils/strongMatch';

const d = hasToken ? describe : describe.skip;

const tomorrowNoon = () => { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(12, 0, 0, 0); return t.toISOString(); };
const inThreeDays = () => { const t = new Date(); t.setDate(t.getDate() + 3); t.setHours(12, 0, 0, 0); return t.toISOString(); };

d('journey: a typed ask -> its top result really matches activity, time and place -> strong match (or no claim)', () => {
  let s;
  const me = { lat: 40.3, lng: -75.2 };
  beforeAll(async () => {
    const people = journeyPeople(2);
    const log = await runJourney(`
      v_host uuid := '${people[0].id}'; v_viewer uuid := '${people[1].id}'; v_a uuid; v_b uuid; v_c uuid; v_d uuid;`, `
  ${actorsSql({ people: ['v_host', 'v_viewer'] })}
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J37 near', '${tomorrowNoon()}', 40.304, -75.2, 'Coffee', 'journey', 6, 'everyone') returning id into v_a;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J37 far', '${tomorrowNoon()}', 40.4, -75.2, 'Coffee', 'journey', 6, 'everyone') returning id into v_b;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J37 later', '${inThreeDays()}', 40.304, -75.2, 'Coffee', 'journey', 6, 'everyone') returning id into v_c;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J37 games', '${tomorrowNoon()}', 40.304, -75.2, 'Board Games', 'journey', 6, 'everyone') returning id into v_d;
  update gatherings set wide_area = '40.3,-75.2', is_public = true where id in (v_a, v_b, v_c, v_d);

  -- the viewer's own reads: the rows they can see, and the real distances
  perform set_config('request.jwt.claims', json_build_object('sub', v_viewer, 'role', 'authenticated')::text, true);
  set local role authenticated;
  log := log || jsonb_build_array(jsonb_build_object('step','rows','ok', true, 'data', (select jsonb_agg(jsonb_build_object(
      'title', g.title, 'interest_tag', g.interest_tag, 'scheduled_at', g.scheduled_at,
      'distance_miles', (select x.distance_miles from get_gathering_distances(${me.lat}, ${me.lng}, array[g.id]) x)))
    from gatherings g where g.id in (v_a, v_b, v_c, v_d))));
  reset role;`);
    s = stepMap(log);
  }, 60000);

  // exactly what intentResolver.js carries for a gathering
  const item = (title) => {
    const r = s.rows.data.find((g) => g.title === title);
    return { type: 'gathering', category: r.interest_tag, startsAt: r.scheduled_at, distanceMiles: r.distance_miles };
  };
  const ask = { category: 'Coffee', dateWindow: 'tomorrow' };

  test('the viewer sees all four, each with a real measured distance', () => {
    expect(s.rows.data).toHaveLength(4);
    for (const r of s.rows.data) expect(typeof r.distance_miles).toBe('number');
  });

  test('close coffee tomorrow: activity, time and place all match -> the strong match, in order', () => {
    expect(strongMatchPieces(item('J37 near'), ask)?.map((p) => p.key)).toEqual(['activity', 'time', 'place']);
  });

  test('far, another day, or another activity -> no claim (the plain Nearby Pick stays)', () => {
    expect(strongMatchPieces(item('J37 far'), ask)).toBeNull();
    expect(strongMatchPieces(item('J37 later'), ask)).toBeNull();
    expect(strongMatchPieces(item('J37 games'), ask)).toBeNull();
  });

  test('an ask that never said when makes no claim, even for the close coffee (Nearby never invents WHEN)', () => {
    expect(strongMatchPieces(item('J37 near'), { category: 'Coffee' })).toBeNull();
    expect(strongMatchPieces(item('J37 near'), { category: 'Coffee', dateWindow: 'flexible' })).toBeNull();
  });
});
