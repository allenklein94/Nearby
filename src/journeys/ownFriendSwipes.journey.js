// 20270433: a person can read who THEY swiped on in Friends (from_user, to_user of their own rows), so Friends > Crossed
// Paths (getFriendCrossedPaths, build 87's exact query) leaves them out; the person swiped on can never see it. Real
// `authenticated` role + JWT claims, one rolled-back transaction. State-aware: before 0433 the read is refused (the bug).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin v_res := null; ${stmt}; v_out := coalesce(v_res, '"ok"'::jsonb);
  exception when others then v_out := jsonb_build_object('code', sqlstate); end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}

d('journey: your own Friends swipes exclude people from Crossed Paths, and stay invisible to who you swiped on', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_a', 'v_b', 'v_c'])}
      v_res jsonb; v_out jsonb;`, `
  ${actorsSql({ people: ['v_a', 'v_b', 'v_c'] })}
  insert into friend_discovery_swipes (from_user, to_user, direction) values (v_a, v_b, 'like'), (v_a, v_c, 'pass'), (v_b, v_c, 'like');
  log := log || jsonb_build_array(jsonb_build_object('step', 'fixed', 'ok', true, 'data',
    to_jsonb(to_regclass('public.friend_discovery_swipes') is not null and exists (select 1 from pg_policy where polname = 'Read your own friend swipes'))));
  -- build 87's exact query (services/friendDiscovery.js getFriendCrossedPaths)
  ${as('own', 'v_a', `select coalesce(jsonb_agg(to_user order by to_user::text), '[]') into v_res from friend_discovery_swipes where from_user = v_a`)}
  -- the person liked (v_b) asks for swipes about them, and for everything
  ${as('as_target', 'v_b', `select coalesce(jsonb_agg(from_user), '[]') into v_res from friend_discovery_swipes where to_user = v_b`)}
  ${as('everything', 'v_c', `select to_jsonb(count(*)) into v_res from friend_discovery_swipes`)}
  ${as('direction', 'v_a', `select coalesce(jsonb_agg(direction), '[]') into v_res from friend_discovery_swipes where from_user = v_a`)}
  ${as('insert', 'v_a', `insert into friend_discovery_swipes (from_user, to_user, direction) values (v_a, v_a, 'like')`)}
  ${as('update', 'v_a', `update friend_discovery_swipes set direction = 'pass' where from_user = v_a`)}
  ${as('delete', 'v_a', `delete from friend_discovery_swipes where from_user = v_a`)}
  log := log || jsonb_build_array(jsonb_build_object('step', 'rows_after', 'ok', true, 'data', to_jsonb((select count(*) from friend_discovery_swipes where from_user = v_a))));
`);
    s = stepMap(log);
  }, 60000);
  const data = (k) => s[k].data;
  const fixed = () => data('fixed') === true;

  test("build 87's own-swipes read returns exactly who you swiped on (before 0433: refused, the bug)", () => {
    if (!fixed()) { expect(data('own').code).toBe('42501'); return; }
    expect(data('own')).toHaveLength(2);
  });
  test('the person you swiped on sees nothing; nobody reads other people\'s swipes', () => {
    if (!fixed()) return expect(data('as_target').code).toBe('42501');
    expect(data('as_target')).toEqual([]);
    expect(data('everything')).toBe(0); // v_c wrote no swipes: it sees none, though two are about it
  });
  test('direction (like or pass) stays unreadable; no client insert, update or delete', () => {
    expect(data('direction').code).toBe('42501');
    for (const k of ['insert', 'update', 'delete']) expect(data(k).code).toBe('42501');
    expect(data('rows_after')).toBe(2);
  });
});
