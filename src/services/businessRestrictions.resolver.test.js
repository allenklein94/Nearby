// Item 86: a business that DECLARED what it does not accommodate is removed from typed-ask results when the ask conflicts.
// Drives the REAL resolver with its network edges mocked (same harness as datePlaceSearch.test.js).
jest.mock('expo-location', () => ({}));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(async () => ({ coords: { latitude: 33, longitude: -117 } })) }));
jest.mock('./gatherings', () => ({ getNearbyGatherings: jest.fn(async () => []), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })), getGatheringDistances: jest.fn(async () => ({})) }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('./brandOffers', () => ({
  getActiveOffers: jest.fn(async () => []), logBusinessProfileView: jest.fn(), getPartnerWeatherSettings: jest.fn(async () => new Map()),
  getPartnerPriceInfo: jest.fn(async () => new Map()), getPartnerSuitedAges: jest.fn(async () => new Map()), getPartnerOperatingInfo: jest.fn(async () => new Map()), getDeclinedBusinesses: jest.fn(async () => new Map()),
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
import { classifyCreateRequest } from './createAssistant';
import { searchActiveBusinessAvailability } from './businessFulfillment';
import { getPartnerOperatingInfo, getDeclinedBusinesses } from './brandOffers';
import { resolveAsk, toClassification } from '../utils/askResolver';


const now = Date.now();
const posting = (id) => ({
  id: `post-${id}`, partner_id: id, partner_name: id, title: 'Tables open', category: 'Restaurants', subcategory: 'Restaurants', categories: [],
  attributes: [], cuisine: null, distance_miles: 1, remaining_capacity: 30, starts_at: new Date(now - 3600e3).toISOString(),
  ends_at: new Date(now + 5 * 3600e3).toISOString(), price: null,
});

// `aiAttributes` simulates an extractor that inferred attributes the words never said; they must never raise a restriction.
async function ask(text, { declined = new Map(), aiAttributes = null } = {}) {
  const cls = toClassification(resolveAsk(text, null));
  classifyCreateRequest.mockResolvedValue(aiAttributes ? { ...cls, attributes: aiAttributes } : cls);
  searchActiveBusinessAvailability.mockResolvedValue(['plain', 'nokids', 'small'].map(posting));
  getPartnerOperatingInfo.mockResolvedValue(new Map());
  getDeclinedBusinesses.mockReset();
  getDeclinedBusinesses.mockResolvedValue(declined);
  const r = await runIntentSearch(text);
  return { r, ids: r.items.filter((i) => i.type === 'business_availability').map((i) => i.partnerId).sort(), calls: getDeclinedBusinesses.mock.calls };
}

describe('customer intent -> compatibility check -> eligible businesses (item 86)', () => {
  it('ordinary asks never reach the compatibility check', async () => {
    for (const t of ['dinner tonight', 'restaurant tonight', 'nightlife tonight', 'a date tonight', 'dinner with my family tonight']) {
      const { calls, ids } = await ask(t);
      expect([t, calls.length]).toEqual([t, 0]);
      expect(ids).toEqual(['nokids', 'plain', 'small']);
    }
  });
  it('AI-inferred attributes never raise a restriction', async () => {
    const { calls } = await ask('family dinner tonight', { aiAttributes: ['kid_friendly', 'pet_friendly', 'outdoor_seating'] });
    expect(calls.length).toBe(0);
  });
  it('a date\'s assumed 2 people is not a stated party size', async () => {
    const { calls } = await ask('a romantic date tonight with my dog');
    expect(calls[0][1]).toMatchObject({ pets: true, partySize: null });
  });
  it('explicit words send exactly those facts, and the server answer removes only what it names', async () => {
    const { ids, calls, r } = await ask('dinner tonight with my kids for 10 people', { declined: new Map([['nokids', 'children'], ['small', 'group']]) });
    expect(calls[0][0].sort()).toEqual(['nokids', 'plain', 'small']);
    expect(calls[0][1]).toMatchObject({ children: true, partySize: 10, pets: false, walkIn: false });
    expect(ids).toEqual(['plain']);
    expect(r.openEndedNote).toMatch(/Leaving out places that don't take children and places too small for your group/);
  });
  it('a failed lookup keeps everyone', async () => {
    getDeclinedBusinesses.mockRejectedValueOnce(new Error('offline'));
    const text = 'dinner tonight with my dog';
    classifyCreateRequest.mockResolvedValue(toClassification(resolveAsk(text, null)));
    const r = await runIntentSearch(text);
    expect(r.items.filter((i) => i.type === 'business_availability').length).toBe(3);
  });
});
