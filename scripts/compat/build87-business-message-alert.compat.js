// OLD-BUILD COMPATIBILITY CHECK (20270428 customer-message alerts vs build 87). Not a test of THIS tree: it runs only
// against build 87's own code (f9f64988), where business_message_received is an unknown type. To rerun:
//   git worktree add ../b87 f9f64988 && ln -s "$PWD/node_modules" ../b87/node_modules
//   cp scripts/compat/build87-business-message-alert.compat.js ../b87/src/navigation/zzCompat.test.js
//   (cd ../b87 && npx jest src/navigation/zzCompat.test.js)
// Result 2026-11-18: 5/5 pass (no destination, tap + Reply button leave the person where they were, closed-app tap opens
// nothing, open-app banner shown, saved owner_messages choice ignored and kept).
// Item 139: the push-tap / deep-link navigation contract, driven end to end through the REAL pieces: the push handler
// (services/notifications.js routeNotificationTap + handleNotificationResponse + consumePendingNotificationTap), the
// destination table (notificationDestinations.js), openOnTop / linkActionFromState, the pending-entry rules
// (outsideEntry.js), the return trail (returnTrail.js / returnTrailNav.js) and React Navigation's own Stack and Tab routers.
// Only the device edges are stubbed: expo push APIs, the network, and storage (an in-memory map).
const fs = require('fs');
const path = require('path');
const routers = require('@react-navigation/routers');

jest.mock('@react-navigation/native', () => {
  const r = jest.requireActual('@react-navigation/routers');
  const core = jest.requireActual('@react-navigation/core');
  return { StackActions: r.StackActions, CommonActions: r.CommonActions, getActionFromState: core.getActionFromState };
});
jest.mock('expo-notifications', () => ({ setNotificationHandler: jest.fn() }));
jest.mock('expo-device', () => ({ isDevice: false }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
const mockStore = new Map();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k) => (mockStore.has(k) ? mockStore.get(k) : null),
    setItem: async (k, v) => { mockStore.set(k, v); },
    removeItem: async (k) => { mockStore.delete(k); },
  },
}));
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
jest.mock('./RootNavigator', () => ({ navigationRef: {} }));
const mockPostings = new Map();
jest.mock('../services/businessFulfillment', () => ({
  getBusinessAvailabilityById: async (id) => {
    if (id === 'network-down') throw new Error('offline');
    return mockPostings.get(id) ?? null;
  },
}));

const { routeNotificationTap, handleNotificationResponse, consumePendingNotificationTap } = require('../services/notifications');
const { notificationDestination } = require('./notificationDestinations');
const { linkActionFromState } = require('./openOnTop');
const { restoreTrail } = require('./returnTrailNav');
const { takeEntry, keepEntry, PENDING_TTL_MS, resetSeenForTests, parseNearbyUrl } = require('./outsideEntry');
const T = require('./returnTrail');

// The signed-in root stack (a representative subset) and the signed-out one.
const SIGNED_IN = ['MainTabs', 'GatheringDetail', 'ViewProfile', 'Chat', 'BusinessRequestDetail', 'Notices', 'CommunityDetail',
  'AskBusiness', 'BusinessProfile', 'Gatherings', 'GroupPlan', 'BusinessPartnerApply', 'BusinessDashboard'];
const SIGNED_OUT = ['Onboarding', 'Login'];
const TABS = ['Home', 'Discover', 'Create', 'Activity', 'Profile'];
const opts = (names) => ({ routeNames: names, routeParamList: {}, routeGetIdList: {} });

function makeRef({ signedIn = true, routeNames = null } = {}) {
  const names = routeNames ?? (signedIn ? SIGNED_IN : SIGNED_OUT);
  const stack = routers.StackRouter({});
  const tabs = routers.TabRouter({});
  let state = stack.getInitialState(opts(names));
  if (signedIn) state.routes[0] = { ...state.routes[0], state: tabs.getInitialState(opts(TABS)) };
  const ref = {
    isReady: () => true,
    getRootState: () => state,
    getCurrentRoute: () => {
      const top = state.routes[state.index];
      if (top.name !== 'MainTabs') return top;
      return top.state.routes[top.state.index];
    },
    dispatch: (action) => {
      if (action.type === 'SET_PARAMS') {
        const set = (r) => (r.key === action.source ? { ...r, params: { ...r.params, ...action.payload.params } } : r);
        // A tab route (inside the tab host) can be the one refreshed in place, too.
        state = { ...state, routes: state.routes.map((r) => (r.state ? { ...set(r), state: { ...r.state, routes: r.state.routes.map(set) } } : set(r))) };
        return;
      }
      const next = stack.getStateForAction(state, action, opts(names));
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
    back: () => ref.dispatch(routers.StackActions.pop()),
    open: (name, params) => ref.dispatch(routers.StackActions.push(name, params)), // ordinary in-app navigation
    names: () => state.routes.map((r) => r.name),
    top: () => state.routes[state.index],
    tab: () => T.activeTab(state),
    discover: () => state.routes[0].state.routes.find((r) => r.name === 'Discover'),
    signIn: () => { ref.isSignedIn = true; },
  };
  return ref;
}
const tap = (ref, data) => routeNotificationTap(data, ref);
const response = (id, data, body = 'Why you got this') => ({
  actionIdentifier: 'default',
  notification: { date: 1, request: { identifier: id, content: { data, body } } },
});

// Build 87 source (f9f64988) given the payload 20270428 queues: it must neither throw nor move the person.
const { foregroundPresentation } = require('./foregroundPresentation');
const MSG = { type: 'business_message_received', message_id: '11111111-1111-4111-8111-111111111111', partner_id: '22222222-2222-4222-8222-222222222222' };
describe('build 87 + business_message_received', () => {
  test('no destination for the type', async () => { await expect(notificationDestination(MSG)).resolves.toBeNull(); });
  test('a tap (body or the Reply button) leaves the person where they were, no throw', async () => {
    for (const action of ['default', 'nearby_open']) {
      const ref = makeRef(); ref.switchTab('Profile'); const before = JSON.stringify(ref.getRootState());
      const r = response(`m-${action}`, MSG); r.actionIdentifier = action;
      await expect(handleNotificationResponse(r, ref)).resolves.toBeUndefined();
      expect(JSON.stringify(ref.getRootState())).toBe(before);
    }
  });
  test('a tap on a closed / signed-out app is kept and later opens nothing, no throw', async () => {
    const out = makeRef({ signedIn: false }); await tap(out, MSG);
    const ref = makeRef(); const before = JSON.stringify(ref.getRootState());
    await consumePendingNotificationTap(ref); // a throw fails the test
    expect(JSON.stringify(ref.getRootState())).toBe(before);
  });
  test('open app: shown as a normal banner (unknown type = banner, never silenced)', async () => {
    const p = await foregroundPresentation(MSG, { currentRoute: { name: 'BusinessDashboard', params: {} }, claimArrival: async () => false });
    expect(p.behavior.shouldShowBanner ?? p.behavior.shouldShowAlert).toBe(true);
  });
  test('saved choices that include the new owner_messages switch: build 87 ignores it, never drops it, still alerts nothing it shouldn\'t', () => {
    const P = require('../constants/notificationPreferences');
    const saved = ['owner_requests', 'owner_messages'];
    expect(P.isOwnerGroup('owner_messages')).toBe(false); // unknown to build 87: not listed in its Business Notifications card
    expect(P.isMuted('business_opportunity_received', saved)).toBe(true);
    expect(P.isMuted('business_message_received', saved)).toBe(false); // build 87 has no group for the type: nothing it decides
    // Build 87's toggles write ONE group through set_my_notification_group (the server keeps owner_messages); its local
    // list just doesn't show it.
    expect(P.toggleGroup(saved, 'owner_offers', false)).toEqual(['owner_requests', 'owner_offers']);
    const src = fs.readFileSync(path.join(__dirname, '../services/notificationPrefs.js'), 'utf8');
    expect(src).toMatch(/rpc\('set_my_notification_group', \{ group_param: group, enabled_param: enabled \}\)/);
    expect(src).not.toMatch(/notification_mutes\s*:/);
  });
});
