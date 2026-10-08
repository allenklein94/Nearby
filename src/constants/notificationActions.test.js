// Item 140: every notification has one direct next action, and its label is true to where the tap goes.
const fs = require('fs');
const path = require('path');

const mockCategories = [];
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: async (id, actions) => { mockCategories.push({ id, actions }); },
}));
jest.mock('expo-device', () => ({ isDevice: false }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} } }));
jest.mock('../services/supabase', () => ({ supabase: {} }));
jest.mock('../navigation/RootNavigator', () => ({ navigationRef: {} }));
jest.mock('../services/businessFulfillment', () => ({ getBusinessAvailabilityById: async (id) => ({ id, partner_name: 'Coastal', title: 'Latte' }) }));

const { NOTIFICATION_ACTION_BY_TYPE, NOTIFICATION_ACTION_KEYS, categoryIdFor } = require('./notificationActions');
const { notificationDestination } = require('../navigation/notificationDestinations');
const { registerNotificationActions } = require('../services/notifications');
const actionsNs = require('../i18n/ui/notificationActions').default;

const destSrc = fs.readFileSync(path.join(__dirname, '..', 'navigation', 'notificationDestinations.js'), 'utf8');
const PUSH_TYPES = [...destSrc.matchAll(/case '(\w+)':/g)].map((m) => m[1]);
const FULL = { gathering_id: 'g', match_id: 'm', request_id: 'r', offer_id: 'o', proposal_id: 'p', plan_id: 'pl', partner_id: 'b',
  availability_id: 'a', community_id: 'c', birthday_user_id: 'u', other_user_id: 'u', story_user_id: 'u', owner_id: 'u',
  target_type: 'gathering', target_id: 't', occasion_type: 'birthday', who_for_name: 'Sam', has_recall: false };

// What each label promises: the screens its tap may open.
const ACTION_OPENS = {
  view_plan: ['GatheringDetail', 'BusinessRequestDetail', 'GroupPlan', 'GroupOccasionPlan', 'DateProposal', 'SharedNight'],
  view_offer: ['BusinessRequestDetail', 'GroupPlan'],
  review_request: ['BusinessRequestDetail', 'BusinessDashboard'],
  view_gathering: ['GatheringDetail'],
  view_invite: ['GatheringDetail', 'GroupPlan', 'GroupOccasionPlan'],
  view_attendees: ['GatheringDetail'],
  reply: ['Chat'], open_chat: ['Chat'], view_notices: ['Notices'],
  see_details: ['AskBusiness', 'BusinessProfile', 'GatheringDetail', 'CommunityDetail'],
  browse_gatherings: ['Gatherings'], find_something_else: ['Gatherings', 'Communities'],
  view_friend_request: ['Friends'], view_friends: ['Friends'], view_profile: ['ViewProfile'],
  start_planning: ['CelebrateSomething', 'Occasions', 'MainTabs'], plan_visit: ['CreateGathering'],
  view_progress: ['Momentum', 'MainTabs'], open_dashboard: ['BusinessDashboard'], view_application: ['MyBusinessApplication'],
  view_business: ['BusinessProfile'], view_opportunities: ['BusinessDashboard'], view_your_offers: ['BusinessDashboard'],
  view_booking: ['BusinessDashboard'], view_community: ['CommunityDetail'], see_ideas: ['MainTabs'],
  view_proposal: ['DateProposal'], answer_question: ['PreferencePolls'],
};

describe('every notification has one next action', () => {
  test('every push type the app handles has an action, and nothing else does', () => {
    expect(PUSH_TYPES).toHaveLength(88);
    expect(Object.keys(NOTIFICATION_ACTION_BY_TYPE).sort()).toEqual([...PUSH_TYPES].sort());
    for (const a of Object.values(NOTIFICATION_ACTION_BY_TYPE)) expect(NOTIFICATION_ACTION_KEYS).toContain(a);
    expect(new Set(Object.values(NOTIFICATION_ACTION_BY_TYPE))).toEqual(new Set(NOTIFICATION_ACTION_KEYS)); // no unused labels
  });
  test('each label is true to where the tap goes', async () => {
    for (const type of PUSH_TYPES) {
      const dest = await notificationDestination({ type, ...FULL });
      expect(dest).not.toBeNull();
      expect({ type, opens: ACTION_OPENS[NOTIFICATION_ACTION_BY_TYPE[type]].includes(dest.name) }).toEqual({ type, opens: true });
    }
  });
  test('the owner\'s examples', () => {
    expect(NOTIFICATION_ACTION_BY_TYPE.gathering_approved).toBe('view_plan'); // Claude accepted your gathering -> View Plan
    expect(NOTIFICATION_ACTION_BY_TYPE.business_offer_received).toBe('view_offer'); // Coastal Coffee made you an offer -> View Offer
    expect(NOTIFICATION_ACTION_BY_TYPE.gathering_reminder).toBe('view_plan'); // Your event starts soon -> View Plan
    expect(NOTIFICATION_ACTION_BY_TYPE.business_request_all_declined).toBe('review_request');
    expect(categoryIdFor('business_offer_received')).toBe('nearby_view_offer');
    expect(categoryIdFor('no_such_type')).toBeNull();
  });
  test('labels are navigation, never a state change made from the lock screen', () => {
    for (const label of Object.values(actionsNs.en)) expect(label).not.toMatch(/\b(Accept|Join|Pay|Vote|Confirm|Book|Decline|Cancel|RSVP)\b/);
  });
  test('every label exists in all 11 languages', () => {
    expect(Object.keys(actionsNs)).toHaveLength(11);
    for (const lang of Object.keys(actionsNs)) {
      expect(Object.keys(actionsNs[lang]).sort()).toEqual([...NOTIFICATION_ACTION_KEYS].sort());
      for (const v of Object.values(actionsNs[lang])) expect(v.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('"You\'re approved" opens the plan', () => {
  test('with the gathering id it opens GatheringDetail; an older push with only a chat id still opens the chat', async () => {
    expect(await notificationDestination({ type: 'gathering_approved', gathering_id: 'g1', match_id: 'm1', body: "You're in." }))
      .toEqual({ name: 'GatheringDetail', params: { gatheringId: 'g1', notificationReason: "You're in." } });
    expect(await notificationDestination({ type: 'gathering_approved', match_id: 'm1' })).toEqual({ name: 'Chat', params: { matchId: 'm1' } });
    expect(await notificationDestination({ type: 'gathering_approved' })).toBeNull();
  });
  test('the server sends gathering_id and no longer promises a chat', () => {
    const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20270256_gathering_approved_opens_plan.sql'), 'utf8');
    expect(sql).toMatch(/'type', 'gathering_approved', 'gathering_id', new\.gathering_id, 'match_id', new\.match_id/);
    expect(sql.split('\n').filter((l) => !l.startsWith('--')).join('\n')).not.toMatch(/Start chatting/);
  });
});

describe('the button on the notification', () => {
  test('the app registers one category per action, one button each, labelled in the person\'s language', async () => {
    mockCategories.length = 0;
    await registerNotificationActions('es');
    expect(mockCategories).toHaveLength(NOTIFICATION_ACTION_KEYS.length);
    const offer = mockCategories.find((c) => c.id === 'nearby_view_offer');
    expect(offer.actions).toEqual([{ identifier: 'open', buttonTitle: 'Ver oferta', options: { opensAppToForeground: true } }]);
    mockCategories.length = 0;
    await registerNotificationActions('en');
    expect(mockCategories.find((c) => c.id === 'nearby_view_plan').actions[0].buttonTitle).toBe('View Plan');
  });
  test('send-push sets categoryId from an identical copy of the table', () => {
    const ts = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'functions', 'send-push', 'index.ts'), 'utf8');
    const block = ts.slice(ts.indexOf('const NOTIFICATION_ACTION_BY_TYPE = {'), ts.indexOf('};', ts.indexOf('const NOTIFICATION_ACTION_BY_TYPE = {')));
    const deno = Object.fromEntries([...block.matchAll(/(\w+): '(\w+)'/g)].map((m) => [m[1], m[2]]));
    expect(deno).toEqual(NOTIFICATION_ACTION_BY_TYPE);
    expect(ts).toMatch(/categoryId: `nearby_\$\{NOTIFICATION_ACTION_BY_TYPE\[data\?\.type\]\}`/);
  });
  test('tapping the button is handled exactly like tapping the notification (no per-button routing)', () => {
    const n = fs.readFileSync(path.join(__dirname, '..', 'services', 'notifications.js'), 'utf8');
    const handler = n.slice(n.indexOf('export function handleNotificationResponse'), n.indexOf('// Call once, high in the component tree'));
    expect(handler).not.toMatch(/actionIdentifier/);
  });
});
