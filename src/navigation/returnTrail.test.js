// Item 139 follow-up: the return trail, driven through the real React Navigation
// routers (root StackRouter + TabRouter), the real openOnTop and restoreTrail.
const fs = require('fs');
const path = require('path');
const routers = require('@react-navigation/routers');

jest.mock('@react-navigation/native', () => {
  const r = jest.requireActual('@react-navigation/routers');
  return { StackActions: r.StackActions, CommonActions: r.CommonActions, getActionFromState: jest.fn() };
});
const mockGone = new Set();
jest.mock('../services/supabase', () => ({
  supabase: {
    from: (table) => ({
      select: () => ({
        eq: (_c, id) => ({
          maybeSingle: async () => (mockGone.has(`${table}:${id}`) ? { data: null, error: null } : { data: { id }, error: null }),
        }),
      }),
    }),
  },
}));

const { openOnTop } = require('./openOnTop');
const { restoreTrail } = require('./returnTrailNav');
const T = require('./returnTrail');

const ROOT = ['MainTabs', 'GatheringDetail', 'ViewProfile', 'Chat', 'BusinessRequestDetail', 'Notices', 'CommunityDetail'];
const TABS = ['Home', 'Discover', 'Create', 'Activity', 'Profile'];
const opts = (names) => ({ routeNames: names, routeParamList: {}, routeGetIdList: {} });

function makeRef(screens = []) {
  const stack = routers.StackRouter({});
  const tabs = routers.TabRouter({});
  let state = stack.getInitialState(opts(ROOT));
  state.routes[0] = { ...state.routes[0], state: tabs.getInitialState(opts(TABS)) };
  const ref = {
    isReady: () => true,
    getRootState: () => state,
    getCurrentRoute: () => {
      const top = state.routes[state.index];
      if (top.name !== 'MainTabs') return top;
      return top.state.routes[top.state.index];
    },
    dispatch: (action) => {
      if (action.type === 'SET_PARAMS') return;
      const next = stack.getStateForAction(state, action, opts(ROOT));
      if (next) state = next;
      T.noteNavigationState(state);
    },
    navigate: (name, params) => {
      ref.dispatch(routers.CommonActions.navigate(name, params));
      if (name === 'MainTabs' && params?.screen) {
        const host = state.routes[0];
        const tabState = tabs.getStateForAction(host.state, routers.CommonActions.navigate(params.screen), opts(TABS));
        state = { ...state, routes: [{ ...host, state: tabState }, ...state.routes.slice(1)] };
        T.noteNavigationState(state);
      }
    },
    switchTab: (tab) => ref.navigate('MainTabs', { screen: tab }),
    names: () => state.routes.map((r) => r.name),
    tab: () => T.activeTab(state),
    hostKey: () => state.routes[0].key,
  };
  screens.forEach(([name, params]) => openOnTop(ref, name, params));
  return ref;
}

const OPEN = [
  ['GatheringDetail', { gatheringId: 'A' }],
  ['ViewProfile', { userId: 'u1' }],
  ['Chat', { matchId: 'm1' }],
];

beforeEach(() => { T.clearTrail(); mockGone.clear(); });

describe('a push to a tab remembers what it closed', () => {
  test('Discover push with Chat open: tab shows, trail holds the 3 screens, labelled by the last one', () => {
    const ref = makeRef(OPEN);
    openOnTop(ref, 'MainTabs', { screen: 'Discover' });
    expect(ref.names()).toEqual(['MainTabs']);
    expect(ref.tab()).toBe('Discover');
    expect(T.getTrail().routes.map((r) => r.name)).toEqual(['GatheringDetail', 'ViewProfile', 'Chat']);
    expect(T.trailLabelKey(T.getTrail())).toBe('ui.returnTrail.chat');
    const ns = require('../i18n/ui/returnTrail').default;
    expect(ns.en.chat).toBe('Back to Chat');
    expect(ns.es.chat).toBe('Volver al chat');
  });

  test('Back reopens them in order on top of the same tab host; Back again walks them', async () => {
    const ref = makeRef(OPEN);
    const hostKey = ref.hostKey();
    openOnTop(ref, 'MainTabs', { screen: 'Home' });
    expect(await restoreTrail(ref)).toBe(true);
    expect(ref.names()).toEqual(['MainTabs', 'GatheringDetail', 'ViewProfile', 'Chat']);
    expect(ref.hostKey()).toBe(hostKey); // Home/Discover stay mounted, never duplicated
    expect(ref.tab()).toBe('Home');
    expect(T.getTrail()).toBeNull();
    ref.dispatch(routers.StackActions.pop());
    expect(ref.getCurrentRoute().name).toBe('ViewProfile');
  });

  test('at most 10 screens, the ones nearest where the person was', () => {
    const many = Array.from({ length: 14 }, (_, i) => ['GatheringDetail', { gatheringId: `g${i}` }]);
    const ref = makeRef(many);
    openOnTop(ref, 'MainTabs', { screen: 'Discover' });
    const kept = T.getTrail().routes.map((r) => r.params.gatheringId);
    expect(kept).toHaveLength(T.TRAIL_LIMIT);
    expect(kept[0]).toBe('g4');
    expect(kept[9]).toBe('g13');
  });

  test('cold start (nothing open): no trail, no chip', () => {
    const ref = makeRef();
    openOnTop(ref, 'MainTabs', { screen: 'Home' });
    expect(T.getTrail()).toBeNull();
  });

  test('a repeated tab push keeps the same trail and moves it to the new tab', async () => {
    const ref = makeRef(OPEN);
    openOnTop(ref, 'MainTabs', { screen: 'Discover' });
    openOnTop(ref, 'MainTabs', { screen: 'Discover' });
    openOnTop(ref, 'MainTabs', { screen: 'Home' });
    expect(T.getTrail().tab).toBe('Home');
    expect(T.getTrail().routes).toHaveLength(3);
    await restoreTrail(ref);
    expect(ref.names()).toEqual(['MainTabs', 'GatheringDetail', 'ViewProfile', 'Chat']);
  });
});

describe('the trail ends when the person goes anywhere else', () => {
  test('opening a screen (incl. a new detail push) ends it', () => {
    const ref = makeRef(OPEN);
    openOnTop(ref, 'MainTabs', { screen: 'Discover' });
    openOnTop(ref, 'BusinessRequestDetail', { requestId: 'r9' });
    expect(T.getTrail()).toBeNull();
    expect(ref.names()).toEqual(['MainTabs', 'BusinessRequestDetail']);
  });

  test('switching tab ends it', () => {
    const ref = makeRef(OPEN);
    openOnTop(ref, 'MainTabs', { screen: 'Discover' });
    ref.switchTab('Activity');
    expect(T.getTrail()).toBeNull();
  });

  test('signing out ends it (RootNavigator clears on a null session)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'RootNavigator.js'), 'utf8');
    expect(src).toMatch(/if \(!session\) clearTrail\(\)/);
    expect(src).toMatch(/onStateChange=\{noteNavigationState\}/);
  });
});

describe('screens that can no longer be opened are skipped', () => {
  test('a deleted or no-longer-visible gathering is skipped; the rest come back', async () => {
    const ref = makeRef(OPEN);
    openOnTop(ref, 'MainTabs', { screen: 'Home' });
    mockGone.add('gatherings:A');
    await restoreTrail(ref);
    expect(ref.names()).toEqual(['MainTabs', 'ViewProfile', 'Chat']);
  });

  test('nothing left to open: stays on the tab, trail gone', async () => {
    const ref = makeRef([['GatheringDetail', { gatheringId: 'A' }]]);
    openOnTop(ref, 'MainTabs', { screen: 'Home' });
    mockGone.add('gatherings:A');
    expect(await restoreTrail(ref)).toBe(false);
    expect(ref.names()).toEqual(['MainTabs']);
    expect(T.getTrail()).toBeNull();
  });

  test('a screen that no longer exists in the navigator is skipped', () => {
    expect(T.restorableRoutes([{ name: 'A' }, { name: 'B' }], [false, true])).toEqual([{ name: 'B' }]);
  });
});

describe('never traps, never duplicates', () => {
  const chip = fs.readFileSync(path.join(__dirname, '..', 'components', 'ReturnTrailChip.js'), 'utf8');
  test('the chip only answers Back on its own tab while focused and a trail exists, and can be dismissed', () => {
    expect(chip).toMatch(/trail\.tab === tab/);
    expect(chip).toMatch(/!mine \|\| !focused/);
    expect(chip).toMatch(/onPress=\{clearTrail\}/);
    expect(chip).not.toMatch(/tabBar/);
  });
  test('only the tab-destination branch starts a trail; the three tab pushes (two Home, the perk-tier nudge) go through it', () => {
    const top = fs.readFileSync(path.join(__dirname, 'openOnTop.js'), 'utf8');
    expect(top).toMatch(/if \(name === TAB_HOST\) beginTrail/);
    const n = fs.readFileSync(path.join(__dirname, 'notificationDestinations.js'), 'utf8');
    // The availability fallback to Discover was removed (item 139 audit): a gone posting opens its business instead.
    expect((n.match(/to\('MainTabs'/g) ?? []).length).toBe(3);
    // The one Discover push is the perk-tier nudge (rule 14: the tier lives on Perks), never a generic fallback.
    expect(n.match(/screen: 'Discover'/g)).toHaveLength(1);
  });
  test('every label key exists in all 11 languages', () => {
    const ns = require('../i18n/ui/returnTrail').default;
    const keys = Object.keys(ns.en);
    expect(Object.keys(ns)).toHaveLength(11);
    for (const lang of Object.keys(ns)) expect(Object.keys(ns[lang]).sort()).toEqual([...keys].sort());
    for (const name of ['Chat', 'GatheringDetail', 'ViewProfile', 'Notices', 'SomethingNew']) {
      const key = T.trailLabelKey({ routes: [{ name }] }).replace('ui.returnTrail.', '');
      expect(keys).toContain(key);
    }
    expect(chip).not.toMatch(/accessibilityLabel="/);
  });
  test('Home and Discover render the chip', () => {
    const home = fs.readFileSync(path.join(__dirname, '..', 'screens', 'HomeScreen.js'), 'utf8');
    const disc = fs.readFileSync(path.join(__dirname, '..', 'screens', 'DiscoverHubScreen.js'), 'utf8');
    expect(home).toMatch(/<ReturnTrailChip tab="Home" \/>/);
    expect(disc).toMatch(/<ReturnTrailChip tab="Discover" \/>/);
  });
});
