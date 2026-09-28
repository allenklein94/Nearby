// Item 132 (owner rules, 2026-09-28): activities reach gatherings through the REAL typed-ask resolver (network edges mocked).
jest.mock('expo-location', () => ({}));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(async () => null) }));
jest.mock('./gatherings', () => ({ getNearbyGatherings: jest.fn(), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })) }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('./brandOffers', () => ({
  getActiveOffers: jest.fn(async () => []), logBusinessProfileView: jest.fn(), getPartnerWeatherSettings: jest.fn(async () => ({})),
  getPartnerPriceInfo: jest.fn(async () => new Map()), getPartnerSuitedAges: jest.fn(async () => ({})), getPartnerOperatingInfo: jest.fn(async () => ({})),
}));
jest.mock('./businessFulfillment', () => ({
  getConnectedOpenBusinessRequests: jest.fn(async () => []), searchActiveBusinessAvailability: jest.fn(async () => []),
  searchPolicyOnlyBusinesses: jest.fn(async () => []), searchOccasionOfferingBusinesses: jest.fn(async () => []),
  getMyBusinessAffinitySignals: jest.fn(async () => ({})),
}));
jest.mock('./preferencePolls', () => ({ getWhoForPreferenceSignals: jest.fn(async () => ({})) }));
jest.mock('./occasionPackages', () => ({ searchOccasionPackages: jest.fn(async () => []), formatOccasionPackageDetail: jest.fn() }));
jest.mock('./homeDashboard', () => ({ getSocialForecast: jest.fn(async () => null) }));
jest.mock('./createAssistant', () => ({ classifyCreateRequest: jest.fn() }));
jest.mock('./intentOutcomes', () => ({ recordIntentSubmission: jest.fn(async () => 'sub-1') }));

import { runIntentSearch } from './intentResolver';
import { getNearbyGatherings } from './gatherings';
import { classifyCreateRequest } from './createAssistant';

const later = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(); // not today: no same-day lift muddies the comparison
const g = (id, extra = {}) => ({ id, title: `Plan ${id}`, interest_tag: 'Hiking', scheduled_at: later, capacity: null, approvedCount: 0, ...extra });

async function ask(text, list) {
  getNearbyGatherings.mockResolvedValue(list);
  classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: null, dateWindow: null, attributes: [] });
  const r = await runIntentSearch(text);
  return Object.fromEntries(r.items.filter((i) => i.type === 'gathering').map((i) => [i.id, i]));
}
const fit = (item) => (item.baseSignals ?? []).find((s) => s.code === 'base_activity_fit')?.delta ?? 0;

describe('Meet a friend', () => {
  const LIST = [
    g('friends_plan', { party_type: 'friends' }),            // explicit friends plan, category unrelated
    g('coffee', { interest_tag: 'Coffee' }),                  // compatible: a coffee gathering
    g('brunch_groups', { interest_tag: 'Brunch', party_type: 'groups' }), // compatible by category
    g('hike', {}),                                            // no fit
  ];
  it('an explicit friends plan is preferred over a merely compatible gathering; neither is hidden', async () => {
    const items = await ask('I want to meet a friend', LIST);
    expect(fit(items.friends_plan)).toBe(3);
    expect(fit(items.coffee)).toBe(2);
    expect(fit(items.brunch_groups)).toBe(2);
    expect(fit(items.hike)).toBe(0);
    expect(items.hike).toBeDefined(); // ranking only
    expect(items.friends_plan.subtitle).toBe('A friends plan, good for meeting a friend');
    expect(items.coffee.subtitle).toBe('Good for meeting a friend');
    expect(items.friends_plan.score).toBeGreaterThan(items.coffee.score);
  });
  it('a friends plan is never inferred from attendees or profiles', async () => {
    const items = await ask('I want to meet a friend', [g('crowd', { approvedAttendees: [{ user_id: 'friend-1' }], host: { interests: ['Coffee'] } })]);
    expect(fit(items.crowd)).toBe(0);
  });
});

describe('Hang out as a group', () => {
  it('a friends plan is explicit, a groups plan compatible, anything else no fit', async () => {
    const items = await ask('looking for a group hangout', [g('friends', { party_type: 'friends' }), g('groups', { party_type: 'groups' }), g('solo', { party_type: 'solo' })]);
    expect(fit(items.friends)).toBe(3);
    expect(fit(items.groups)).toBe(2);
    expect(fit(items.solo)).toBe(0);
  });
});

describe('Grab a coffee', () => {
  it('any Coffee gathering, regardless of plan type, with no friends preference', async () => {
    const items = await ask('I want to grab a coffee', [g('c1', { interest_tag: 'Coffee' }), g('c2', { interest_tag: 'Coffee', party_type: 'friends' }), g('c3', { interest_tag: 'Coffee', party_type: 'new_people' })]);
    expect([fit(items.c1), fit(items.c2), fit(items.c3)]).toEqual([2, 2, 2]);
  });
});

describe('First date', () => {
  it('never matches a gathering, even a date plan with a romantic feel', async () => {
    const items = await ask('first date ideas', [g('date', { interest_tag: 'Coffee', party_type: 'date', features: ['quiet'] })]);
    expect(fit(items.date)).toBe(0);
  });
});

// Matching vs creating (owner, LOCKED): discovery surfaces EXISTING gatherings; a new one is created only when the person
// chooses "Create it yourself" (that opens the Create screen; publishing there is the only call to createGathering).
describe('matching never creates a gathering', () => {
  const fs = require('fs');
  const path = require('path');
  const SRC = path.join(__dirname, '..');
  it.each(['services/intentResolver.js', 'services/surpriseMe.js', 'services/homeRecommendations.js', 'constants/activityLayer.js', 'services/askRefine.js'])('%s never calls createGathering', (f) => {
    expect(fs.readFileSync(path.join(SRC, f), 'utf8')).not.toMatch(/\bcreateGathering\s*\(/);
  });
  it('"Create it yourself" only navigates to the Create screen', () => {
    const src = fs.readFileSync(path.join(SRC, 'services/createAssistant.js'), 'utf8');
    expect(src).not.toMatch(/\bcreateGathering\s*\(/);
    expect(src).toMatch(/navigate\('CreateGathering'/);
  });
});
