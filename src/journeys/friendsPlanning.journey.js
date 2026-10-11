// Owner item 41 (2026-10-11): "{count} of your friends are already making plans" -- the friends-planning query, live. The
// viewer A reads, as the app does (authenticated, RLS), friends' gatherings created in the last 3 days with each host's name
// and photo; Jest then applies the REAL client rule (selectFriendsActivity: the window, applyGatheringVisibilityFilters, one
// plan per friend, max 3) and getHomeInsight to the very rows the database returned. One rolled-back transaction.
//   B (friend) hosts: recent Everyone (1 day), old (4 days), Link-only, invite_only. C (friend) hosts: Friends-only (1 day).
// Not covered here (device only): the moment's look, and tapping "See gatherings" on a phone (its destination is unit-tested).
// homeDashboard's app-side imports, stubbed (only its pure helpers run here)
jest.mock('../services/supabase', () => ({ supabase: {} }));
jest.mock('../services/proximity', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'x' }));
jest.mock('expo-location', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('../services/friends', () => ({ getMyFriends: jest.fn() }));
jest.mock('../services/communities', () => ({ getMyCommunities: jest.fn() }));
jest.mock('../services/userLocation', () => ({ getUserLocation: jest.fn(), requireUserLocation: jest.fn() }));
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
const { selectFriendsActivity, getHomeInsight, friendsActivitySince } = require('../services/homeDashboard');

const d = hasToken ? describe : describe.skip;
const as = (who) => `perform set_config('request.jwt.claims', json_build_object('sub', ${who}, 'role', 'authenticated')::text, true); set local role authenticated;`;
const asOwner = 'reset role;';
const g = (host, title, created, extra = '') => `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, created_at${extra ? `, ${extra.split('=')[0]}` : ''})
    values (${host}, '${title}', now() + interval '2 days', 40.3, -75.2, 'Pickleball', 'journey', 10, ${title.includes('invite') ? "'invite_only'" : title.includes('friends') ? "'friends'" : "'everyone'"}, now() - interval '${created}'${extra ? `, ${extra.split('=')[1]}` : ''});`;

d('journey: friends are making plans - the 3-day window, visibility, one per friend, names and photos readable', () => {
  let s; let ids;
  beforeAll(async () => {
    const people = await runSql(`select id from profiles order by created_at limit 3;`);
    ids = { a: people[0].id, b: people[1].id, c: people[2].id };
    const log = await runJourney(`v_a uuid := '${ids.a}'; v_b uuid := '${ids.b}'; v_c uuid := '${ids.c}';`, `
  delete from friendships where (user_a, user_b) in ((v_a, v_b), (v_b, v_a), (v_a, v_c), (v_c, v_a));
  delete from blocks where blocker_id in (v_a, v_b, v_c) and blocked_id in (v_a, v_b, v_c);
  insert into friendships (user_a, user_b, status, requested_by) values (v_a, v_b, 'accepted', v_a), (v_a, v_c, 'accepted', v_a);
  ${g('v_b', 'J41 recent', '1 day')}
  ${g('v_b', 'J41 old', '4 days')}
  ${g('v_b', 'J41 link', '2 hours', 'discoverable=false')}
  ${g('v_b', 'J41 invite', '3 hours')}
  ${g('v_c', 'J41 friends', '1 day')}

  -- as A, the app's own read: friends' gatherings since ${'3 days'}, with the host's name and photo
  ${as('v_a')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'rows', 'ok', true, 'data', (
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'host_id', x.host_id, 'interest_tag', x.interest_tag,
      'created_at', x.created_at, 'visibility', x.visibility, 'community_id', x.community_id, 'women_only', x.women_only,
      'discoverable', x.discoverable, 'profiles', (select jsonb_build_object('display_name', p.display_name, 'photo_url', p.photo_url) from profiles p where p.id = x.host_id))
      order by x.created_at desc), '[]'::jsonb)
    from gatherings x
    where x.host_id in (v_b, v_c) and x.title like 'J41 %' and x.created_at >= now() - interval '3 days')));
  ${asOwner}`);
    s = stepMap(log);
  }, 90000);

  const ctx = () => ({ excludedHostIds: new Set(), isWoman: false, friendIds: new Set([ids.b, ids.c]), communityIds: new Set() });
  const titles = (rows) => rows.map((r) => r.title).sort();

  test('the 3-day window: the 4-day-old plan never comes back; the query\'s bound matches the client\'s', () => {
    expect(titles(s.rows.data)).toEqual(['J41 friends', 'J41 invite', 'J41 link', 'J41 recent']);
    expect(Date.parse(friendsActivitySince()) - Date.now()).toBeGreaterThan(-(3 * 86400000 + 60000));
  });
  test('the client gate drops invite_only and Link-only (RLS returns them); one plan per friend', () => {
    const picked = selectFriendsActivity(s.rows.data, { visibilityContext: ctx() });
    expect(titles(picked)).toEqual(['J41 friends', 'J41 recent']);
  });
  test('a friend\'s Friends-only plan needs the friendship: without it, gone', () => {
    const picked = selectFriendsActivity(s.rows.data, { visibilityContext: { ...ctx(), friendIds: new Set([ids.b]) } });
    expect(titles(picked)).toEqual(['J41 recent']);
  });
  test('a blocked host: gone', () => {
    const picked = selectFriendsActivity(s.rows.data, { visibilityContext: { ...ctx(), excludedHostIds: new Set([ids.b]) } });
    expect(titles(picked)).toEqual(['J41 friends']);
  });
  test('the line: "2 of your friends", one face per friend with the host\'s readable name, "See gatherings" -> exactly those two', () => {
    const friendsActivity = selectFriendsActivity(s.rows.data, { visibilityContext: ctx() });
    const r = getHomeInsight({ friendsActivity });
    expect(r.text).toBe('2 of your friends are already making plans.');
    expect(r.people.map((p) => p.id).sort()).toEqual([ids.b, ids.c].sort());
    for (const row of friendsActivity) expect(row.profiles).not.toBeNull(); // the host's profile row is readable by a friend
    expect(r.cta.destination.items.map((it) => it.gathering.id).sort()).toEqual(friendsActivity.map((x) => x.id).sort());
    for (const it of r.cta.destination.items) expect(it.destination.screen).toBe('GatheringDetail');
  });
});
