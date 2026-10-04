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
  'AskBusiness', 'BusinessProfile', 'Gatherings', 'GroupPlan', 'BusinessPartnerApply'];
const SIGNED_OUT = ['Onboarding', 'Login'];
const TABS = ['Home', 'Discover', 'Create', 'Activity'];
const opts = (names) => ({ routeNames: names, routeParamList: {}, routeGetIdList: {} });

function makeRef({ signedIn = true } = {}) {
  const names = signedIn ? SIGNED_IN : SIGNED_OUT;
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
        state = { ...state, routes: state.routes.map((r) => (r.key === action.source ? { ...r, params: { ...r.params, ...action.payload.params } } : r)) };
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

beforeEach(() => { T.clearTrail(); mockGone.clear(); mockStore.clear(); mockPostings.clear(); resetSeenForTests(); });

describe('1. a push opened from Discover, then Back', () => {
  test('opens the exact gathering on top; Back returns to the same Discover (same mounted route, same params)', async () => {
    const ref = makeRef();
    ref.switchTab('Discover');
    const before = ref.discover();
    await tap(ref, { type: 'gathering_reminder', gathering_id: 'g1', body: 'Starts in 2 hours' });
    expect(ref.names()).toEqual(['MainTabs', 'GatheringDetail']);
    expect(ref.top().params).toMatchObject({ gatheringId: 'g1', notificationReason: 'Starts in 2 hours' });
    ref.back();
    expect(ref.names()).toEqual(['MainTabs']);
    expect(ref.tab()).toBe('Discover');
    expect(ref.discover()).toBe(before); // the very same route object: never re-created, so its screen state survives
  });
});

describe('the offer push ("Coastal Coffee made you an offer")', () => {
  test('opens the request ON that offer, on top of wherever the person was; Back returns there, not Home', async () => {
    const ref = makeRef();
    ref.switchTab('Activity');
    ref.open('ViewProfile', { userId: 'u1' });
    ref.open('Chat', { matchId: 'm1' });
    const chat = ref.top();
    await handleNotificationResponse(response('offer-1', { type: 'business_offer_received', request_id: 'r1', offer_id: 'o1' }, 'Coastal Coffee made you an offer'), ref);
    expect(ref.names()).toEqual(['MainTabs', 'ViewProfile', 'Chat', 'BusinessRequestDetail']);
    expect(ref.top().params).toEqual({ requestId: 'r1', focusOfferId: 'o1', notificationReason: 'Coastal Coffee made you an offer' });
    ref.back();
    expect(ref.top()).toBe(chat);
    ref.back();
    expect(ref.top().name).toBe('ViewProfile');
    ref.back();
    expect(ref.tab()).toBe('Activity');
  });
});

describe('2. a push opened from a gathering detail, then Back', () => {
  test('another gathering opens on top; Back returns to the first one, unchanged', async () => {
    const ref = makeRef();
    ref.open('GatheringDetail', { gatheringId: 'A' });
    const a = ref.top();
    await tap(ref, { type: 'gathering_updated', gathering_id: 'B' });
    expect(ref.names()).toEqual(['MainTabs', 'GatheringDetail', 'GatheringDetail']);
    ref.back();
    expect(ref.top()).toBe(a);
    expect(ref.top().params).toEqual({ gatheringId: 'A' });
  });
});

describe('3. a deep link while another full-screen destination is active', () => {
  test('a warm nearby://gathering link opens on top of Chat; Back returns to Chat', () => {
    const ref = makeRef();
    ref.open('GatheringDetail', { gatheringId: 'A' });
    ref.open('Chat', { matchId: 'm1' });
    // What the linking config produces for the URL (with Home under it, see RootNavigator's initialRouteName).
    const linkState = { index: 1, routes: [{ name: 'MainTabs' }, { name: 'GatheringDetail', params: { gatheringId: 'B' } }] };
    ref.dispatch(linkActionFromState(ref)(linkState, {}));
    expect(ref.names()).toEqual(['MainTabs', 'GatheringDetail', 'Chat', 'GatheringDetail']);
    ref.back();
    expect(ref.top().name).toBe('Chat');
  });
  test('a warm link to the screen already on top refreshes it in place', () => {
    const ref = makeRef();
    ref.open('GatheringDetail', { gatheringId: 'A' });
    const linkState = { index: 1, routes: [{ name: 'MainTabs' }, { name: 'GatheringDetail', params: { gatheringId: 'A' } }] };
    ref.dispatch(linkActionFromState(ref)(linkState, {}));
    expect(ref.names()).toEqual(['MainTabs', 'GatheringDetail']);
  });
});

describe('4. cold start', () => {
  test('the linking config opens a cold-start link with Home underneath, so Back lands on Home', () => {
    const src = fs.readFileSync(path.join(__dirname, 'RootNavigator.js'), 'utf8');
    expect(src).toMatch(/initialRouteName: 'MainTabs',\n\s+screens: \{/);
    const getStateFromPath = jest.requireActual('@react-navigation/core').getStateFromPath;
    const state = getStateFromPath('gathering/abc', { initialRouteName: 'MainTabs', screens: { GatheringDetail: 'gathering/:gatheringId' } });
    expect(state.routes.map((r) => r.name)).toEqual(['MainTabs', 'GatheringDetail']);
  });
  test('a push that launches the app before the signed-in stack exists is kept, then opened exactly once', async () => {
    const out = makeRef({ signedIn: false });
    await tap(out, { type: 'gathering_invite', gathering_id: 'g9' });
    expect(out.names()).toEqual(['Onboarding']); // nothing dispatched to a screen that isn't there
    const ref = makeRef();
    expect(await consumePendingNotificationTap(ref)).toBe(true);
    expect(ref.names()).toEqual(['MainTabs', 'GatheringDetail']);
    expect(ref.top().params.gatheringId).toBe('g9');
    await consumePendingNotificationTap(ref);
    expect(ref.names()).toEqual(['MainTabs', 'GatheringDetail']); // used once
  });
  test('a kept entry older than a day is dropped, never opened on a later launch', async () => {
    const AS = require('@react-native-async-storage/async-storage').default;
    const t0 = 1_000_000;
    await keepEntry(AS, 'k', 'g1', t0);
    expect(await takeEntry(AS, 'k', t0 + PENDING_TTL_MS + 1)).toBeNull();
    await keepEntry(AS, 'k', 'g1', t0);
    expect(await takeEntry(AS, 'k', t0 + 60_000)).toBe('g1');
    mockStore.set('k', 'legacy-gathering-id'); // written by an older app version: honoured once
    expect(await takeEntry(AS, 'k')).toBe('legacy-gathering-id');
  });
  test('links are kept only while signed out; when the signed-in stack is mounted they open at once (no later replay)', () => {
    const src = fs.readFileSync(path.join(__dirname, 'RootNavigator.js'), 'utf8');
    const handler = src.slice(src.indexOf('function handleUrl('), src.indexOf('Linking.getInitialURL()'));
    expect(handler.indexOf('canOpenFromOutside(navigationRef)')).toBeLessThan(handler.indexOf('keepEntry('));
    expect(handler).toMatch(/return;\n\s+\}\n\s+if \(link\.kind === 'gathering'\) keepEntry/);
    expect(src).not.toMatch(/AsyncStorage\.setItem\(PENDING_/);
    expect(parseNearbyUrl('nearby://gathering/abc')).toEqual({ kind: 'gathering', id: 'abc' });
    expect(parseNearbyUrl('nearby://business/p1')).toEqual({ kind: 'business', id: 'p1' });
    expect(parseNearbyUrl('nearby://business-apply')).toEqual({ kind: 'apply' });
    expect(parseNearbyUrl('https://example.com')).toBeNull();
  });
});

describe('5. repeated taps', () => {
  test('the same notification reported twice (listener + launch response) opens once', async () => {
    const ref = makeRef();
    const r = response('n1', { type: 'business_offer_received', request_id: 'r1', offer_id: 'o1' });
    await handleNotificationResponse(r, ref);
    expect(ref.names()).toEqual(['MainTabs', 'BusinessRequestDetail']);
    expect(ref.top().params).toMatchObject({ requestId: 'r1', focusOfferId: 'o1', notificationReason: 'Why you got this' });
    ref.back(); // the person reads it and goes back...
    await handleNotificationResponse(r, ref); // ...then the launch-response copy of the same tap arrives late
    expect(ref.names()).toEqual(['MainTabs']);
    const again = { ...r, notification: { ...r.notification, date: 2 } }; // tapping the notification again later still opens
    await handleNotificationResponse(again, ref);
    expect(ref.names()).toEqual(['MainTabs', 'BusinessRequestDetail']);
  });
  test('two pushes for the same object while it is on top: refreshed in place, never stacked', async () => {
    const ref = makeRef();
    await tap(ref, { type: 'business_offer_received', request_id: 'r1', offer_id: 'o1' });
    await tap(ref, { type: 'business_offer_received', request_id: 'r1', offer_id: 'o2' });
    expect(ref.names()).toEqual(['MainTabs', 'BusinessRequestDetail']);
    expect(ref.top().params.focusOfferId).toBe('o2');
  });
  test('two different postings are two screens (a form is never overwritten by another posting)', async () => {
    const ref = makeRef();
    mockPostings.set('a1', { id: 'a1', partner_name: 'Coastal', title: 'Latte' });
    mockPostings.set('a2', { id: 'a2', partner_name: 'Coastal', title: 'Mocha' });
    await tap(ref, { type: 'recommended_business_availability', availability_id: 'a1', partner_id: 'p1' });
    await tap(ref, { type: 'recommended_business_availability', availability_id: 'a2', partner_id: 'p1' });
    expect(ref.names()).toEqual(['MainTabs', 'AskBusiness', 'AskBusiness']);
    await tap(ref, { type: 'recommended_business_availability', availability_id: 'a2', partner_id: 'p1' });
    expect(ref.names()).toEqual(['MainTabs', 'AskBusiness', 'AskBusiness']);
  });
});

describe('6. an invalid or deleted destination', () => {
  test('a posting that has gone opens that business, never a generic Discover list', async () => {
    const ref = makeRef();
    ref.switchTab('Discover');
    await tap(ref, { type: 'recommended_business_availability', availability_id: 'gone', partner_id: 'p1' });
    expect(ref.names()).toEqual(['MainTabs', 'BusinessProfile']);
    expect(ref.top().params).toEqual({ partnerId: 'p1' });
    await tap(ref, { type: 'recommended_business_availability', availability_id: 'network-down', partner_id: 'p1' });
    expect(ref.names()).toEqual(['MainTabs', 'BusinessProfile']); // same business already on top: refreshed in place
  });
  test('a payload missing the id it needs opens nothing; the person stays where they were', async () => {
    const ref = makeRef();
    ref.open('Chat', { matchId: 'm1' });
    for (const data of [{ type: 'message' }, { type: 'business_offer_received' }, { type: 'group_plan_invite' }, { type: 'birthday' },
      { type: 'recommended_business_availability' }, { type: 'some_future_type', id: 'x' }, null]) {
      await tap(ref, data);
    }
    expect(ref.names()).toEqual(['MainTabs', 'Chat']);
  });
  test('a destination the current stack does not register is never dispatched', async () => {
    const ref = makeRef();
    await tap(ref, { type: 'preference_poll_received' }); // PreferencePolls is not in this test stack
    expect(ref.names()).toEqual(['MainTabs']);
  });
  test('object screens show "isn\'t available anymore" (with Go back) for a deleted/invisible object, never Try again', () => {
    const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'screens', f), 'utf8');
    for (const f of ['BusinessRequestDetailScreen.js', 'GroupPlanScreen.js', 'GroupOccasionPlanScreen.js', 'CommunityDetailScreen.js', 'BusinessProfileScreen.js']) {
      expect(read(f)).toMatch(/<UnavailableState navigation=\{navigation\} \/>/);
    }
    // Already had their own not-available states: GatheringDetail, ViewProfile, SharedNight.
    expect(read('GatheringDetailScreen.js')).toMatch(/notAvailable/);
    expect(read('ViewProfileScreen.js')).toMatch(/profileNotAvailable/);
    expect(read('SharedNightScreen.js')).toMatch(/thisNightIsntSharedWith/);
  });
});

describe('7. a push that switches to a tab, then the person goes back', () => {
  test('Home push with screens open: the screens become the trail; Back reopens them on the same tab host', async () => {
    const ref = makeRef();
    ref.switchTab('Discover');
    ref.open('GatheringDetail', { gatheringId: 'A' });
    ref.open('Chat', { matchId: 'm1' });
    const hostKey = ref.getRootState().routes[0].key;
    await tap(ref, { type: 'group_intent_signal' });
    expect(ref.names()).toEqual(['MainTabs']);
    expect(ref.tab()).toBe('Home');
    expect(T.getTrail().routes.map((r) => r.name)).toEqual(['GatheringDetail', 'Chat']);
    expect(await restoreTrail(ref)).toBe(true);
    expect(ref.names()).toEqual(['MainTabs', 'GatheringDetail', 'Chat']);
    expect(ref.getRootState().routes[0].key).toBe(hostKey); // the same tab host, not a second Home
  });
  test('a screen whose object has since gone is skipped when the trail is restored', async () => {
    const ref = makeRef();
    ref.open('GatheringDetail', { gatheringId: 'A' });
    ref.open('Chat', { matchId: 'm1' });
    await tap(ref, { type: 'group_intent_signal' });
    mockGone.add('gatherings:A');
    await restoreTrail(ref);
    expect(ref.names()).toEqual(['MainTabs', 'Chat']);
  });
});

describe('8. returning to Discover keeps everything the person chose', () => {
  test('push -> detail -> another push -> Back, Back: the same Discover route; its screen never unmounts or resets', async () => {
    const ref = makeRef();
    ref.switchTab('Discover');
    const discover = ref.discover();
    await tap(ref, { type: 'gathering_invite', gathering_id: 'g1' });
    ref.open('ViewProfile', { userId: 'u1' });
    await tap(ref, { type: 'message', match_id: 'm1' });
    expect(ref.names()).toEqual(['MainTabs', 'GatheringDetail', 'ViewProfile', 'Chat']);
    ref.back(); ref.back(); ref.back();
    expect(ref.tab()).toBe('Discover');
    expect(ref.discover()).toBe(discover);
    expect(T.getTrail()).toBeNull(); // no tab switch happened, so nothing was closed and nothing needs restoring
  });
  test('Discover keeps its choices in component state and nothing resets them on refocus (item 138 guards)', () => {
    const d = fs.readFileSync(path.join(__dirname, '..', 'screens', 'DiscoverHubScreen.js'), 'utf8');
    for (const s of ['typeFilter', 'openNowOnly', 'environmentFilter', 'cuisineFilter', 'viewStyle', 'intentSearch']) expect(d).toMatch(new RegExp(`const \\[${s}, set`));
    expect(d).toMatch(/if \(!p \|\| p === appliedParamsRef\.current\) return;/);
  });
});

describe('the audit: every push type has one registered destination', () => {
  const dest = fs.readFileSync(path.join(__dirname, 'notificationDestinations.js'), 'utf8');
  const types = [...dest.matchAll(/case '(\w+)':/g)].map((m) => m[1]);
  const root = fs.readFileSync(path.join(__dirname, 'RootNavigator.js'), 'utf8');
  const registered = new Set([...root.matchAll(/<Stack\.Screen name="(\w+)"/g)].map((m) => m[1]));
  test('88 push types, each handled once', () => {
    expect(types).toHaveLength(88);
    expect(new Set(types).size).toBe(types.length);
  });
  test('every destination a push can produce is a registered signed-in screen', async () => {
    const full = { gathering_id: 'g', match_id: 'm', request_id: 'r', offer_id: 'o', proposal_id: 'p', plan_id: 'pl', partner_id: 'b',
      community_id: 'c', birthday_user_id: 'u', other_user_id: 'u', story_user_id: 'u', owner_id: 'u', target_type: 'gathering', target_id: 't',
      occasion_type: 'birthday', who_for_name: 'Sam', has_recall: false };
    const seen = new Set();
    for (const type of types) {
      const d = await notificationDestination({ type, ...full });
      if (d) { expect(registered.has(d.name)).toBe(true); seen.add(d.name); }
    }
    expect(seen.size).toBeGreaterThanOrEqual(20);
  });
  test('only the two Home pushes and the perk-tier nudge switch tabs; nothing falls back to a generic Discover', () => {
    expect((dest.match(/to\('MainTabs', \{ screen: 'Home' \}\)/g) ?? []).length).toBe(2);
    // Rule 14: the Rewards screen folded into Discover -> Perks, so "Almost at Silver" opens the Perks tab where the tier
    // line now lives. That is the tier's one home, not a fallback; it is the only Discover destination.
    expect(dest.match(/'Discover'/g)).toEqual(["'Discover'"]);
    expect(dest).toMatch(/case 'reward_tier_nudge':[\s\S]{0,200}to\('MainTabs', \{ screen: 'Discover', params: \{ \.\.\.PERKS_TAB \} \}\)/);
  });
});
