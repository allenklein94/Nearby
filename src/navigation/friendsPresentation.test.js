// People -> Friends is the one canonical Friends surface (owner, 2026-10-04). Entries that start on a tab open it in place;
// entries from a stack screen open the FriendDiscovery presentation on top (the same FriendDiscoveryScreen Discover embeds),
// so Back returns to exactly the screen the person was on. Driven through React Navigation's real Stack router.
const fs = require('fs');
const path = require('path');
const { StackRouter, StackActions, CommonActions } = require('@react-navigation/routers');
const { PRESENTATION_ROUTES, canonicalRoute, isPresentation } = require('./presentationRoutes');

const SRC = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

jest.mock('../services/supabase', () => ({ supabase: {} }));

const ROUTES = ['MainTabs', 'Friends', 'GatheringConfirmation', 'CreateGathering', 'FriendDiscovery', 'GatheringDetail'];
const router = StackRouter({});
const opts = { routeNames: ROUTES, routeParamList: {}, routeGetIdList: {} };
function stack(names) {
  let s = router.getInitialState(opts);
  for (const n of names.slice(1)) s = router.getStateForAction(s, StackActions.push(n, n === 'CreateGathering' ? { draftMarker: 'kept' } : undefined), opts);
  return s;
}
const names = (s) => s.routes.map((r) => r.name);
const nav = (s, name, params) => router.getStateForAction(s, CommonActions.navigate(name, params), opts);
const back = (s) => router.getStateForAction(s, CommonActions.goBack(), opts);

describe('entries that start on a tab open Discover -> People -> Friends in place', () => {
  const { PEOPLE_FRIENDS } = require('../utils/recommendationContext');
  test('the canonical params are People with Friends selected', () => {
    expect(PEOPLE_FRIENDS).toEqual({ initialMode: 'people', initialPeopleSubMode: 'friends' });
  });
  test('recommendation -> people (the intent route table) opens Discover with Friends selected', () => {
    const src = read('constants/intentRoutes.js');
    expect(src).toMatch(/navigation\.navigate\('Discover', \{ initialMode: 'people', initialPeopleSubMode: subMode \?\? 'friends' \}\)/);
    expect(src).toMatch(/surface === ROUTE_SURFACES\.PEOPLE/);
  });
  test('Activity -> people opens Discover with a fresh copy of the Friends params', () => {
    const src = read('screens/ActivityScreen.js');
    expect(src).toMatch(/navigation\.navigate\('Discover', \{ \.\.\.PEOPLE_FRIENDS \}\)/);
    expect(src).not.toMatch(/navigate\('FriendDiscovery'/);
  });
  test('Create -> Meet new people opens Discover with Friends, a fresh params object every tap', () => {
    const src = read('screens/CreateHubScreen.js');
    expect(src).toMatch(/key: 'meetNewPeople', route: 'Discover', params: PEOPLE_FRIENDS/);
    expect(src).toMatch(/action\.params \? \{ \.\.\.action\.params \} : undefined/);
    expect(src).not.toMatch(/'FriendDiscovery'/);
  });
});

describe('entries from a stack screen open the FriendDiscovery presentation on top; Back returns exactly there', () => {
  test.each([
    ['Friends screen', 'screens/FriendsScreen.js', ['MainTabs', 'Friends']],
    ['gathering published', 'screens/GatheringConfirmationScreen.js', ['MainTabs', 'GatheringConfirmation']],
    ['Create invite picker', 'components/FriendInviteSelector.js', ['MainTabs', 'CreateGathering']],
  ])('%s', (_label, file, origin) => {
    expect(read(file)).toMatch(/navigation\.navigate\('FriendDiscovery'\)/);
    const before = stack(origin);
    const opened = nav(before, 'FriendDiscovery');
    expect(names(opened)).toEqual([...origin, 'FriendDiscovery']);
    const returned = back(opened);
    expect(names(returned)).toEqual(origin);
    // the very same origin route (key and params) is still there: nothing was closed or recreated
    expect(returned.routes[returned.routes.length - 1]).toBe(before.routes[before.routes.length - 1]);
    if (origin.includes('CreateGathering')) expect(returned.routes[1].params).toEqual({ draftMarker: 'kept' });
  });

  test('typed-ask people row: its destination is the presentation, and Back returns to the screen it was tapped on', () => {
    const { intentResultDestination } = require('../utils/recommendationContext');
    expect(intentResultDestination({ type: 'friend_discovery' })).toEqual({ kind: 'navigate', screen: 'FriendDiscovery', params: undefined });
    const before = stack(['MainTabs', 'GatheringDetail']);
    const returned = back(nav(before, 'FriendDiscovery'));
    expect(names(returned)).toEqual(['MainTabs', 'GatheringDetail']);
    expect(returned.routes[1]).toBe(before.routes[1]);
  });
});

describe('FriendDiscovery is a presentation of the canonical surface, never its own surface', () => {
  test('registered as a mode presentation of Discover rendering the embedded Friends component', () => {
    expect(isPresentation('FriendDiscovery')).toBe(true);
    expect(PRESENTATION_ROUTES.FriendDiscovery).toEqual({ surface: 'Discover', mode: 'people/friends', component: 'FriendDiscoveryScreen' });
    // a mode presentation does not alias the whole Discover tab, which may be showing another mode
    expect(canonicalRoute('FriendDiscovery')).toBe('FriendDiscovery');
    expect(canonicalRoute('Notices')).toBe('Activity');
  });
  test('Discover embeds that same component for its Friends mode (one implementation)', () => {
    const hub = read('screens/DiscoverHubScreen.js');
    expect(hub).toMatch(/import FriendDiscoveryScreen from '\.\/FriendDiscoveryScreen'/);
    expect(hub).toMatch(/<FriendDiscoveryScreen navigation=\{navigation\} embedded/);
    const nav = read('navigation/RootNavigator.js');
    expect(nav.match(/component=\{FriendDiscoveryScreen\}/g)).toHaveLength(1);
  });
});
