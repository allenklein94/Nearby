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
  getPartnerPriceInfo: jest.fn(async () => new Map()), getPartnerSuitedAges: jest.fn(async () => new Map()), getPartnerOperatingInfo: jest.fn(async () => new Map()),
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
import { getPartnerOperatingInfo, getPartnerPriceInfo } from './brandOffers';
import { resolveAsk, toClassification } from '../utils/askResolver';


const now = Date.now();
const posting = (id, name) => ({
  id: `post-${id}`, partner_id: id, partner_name: name, title: 'Tables open', category: 'Restaurants', subcategory: 'Restaurants', categories: [],
  attributes: [], cuisine: null, distance_miles: 1, remaining_capacity: 30, starts_at: new Date(now - 3600e3).toISOString(),
  ends_at: new Date(now + 5 * 3600e3).toISOString(), price: null,
});
const PARTNERS = {
  plain: { id: 'plain', name: 'Plain Bistro', attributes: [], not_accommodated: [] },
  bar: { id: 'bar', name: 'Late Bar', attributes: [], not_accommodated: ['adults_21_plus'] },
  nokids: { id: 'nokids', name: 'Quiet Room', attributes: [], not_accommodated: ['no_children'] },
  nopets: { id: 'nopets', name: 'Clean Cafe', attributes: [], not_accommodated: ['no_pets'] },
  small: { id: 'small', name: 'Tiny Table', attributes: [], not_accommodated: [], max_group_size: 6 },
  indoor: { id: 'indoor', name: 'Indoor Hall', attributes: [], not_accommodated: [], weather_setting: 'indoor' },
  booked: { id: 'booked', name: 'Booked Only', attributes: [], not_accommodated: [], booking_mode: 'reservation_required' },
};

async function ask(text, only = Object.keys(PARTNERS)) {
  classifyCreateRequest.mockResolvedValue(toClassification(resolveAsk(text, null)));
  searchActiveBusinessAvailability.mockResolvedValue(only.map((id) => posting(id, PARTNERS[id].name)));
  getPartnerOperatingInfo.mockResolvedValue(new Map(Object.entries(PARTNERS)));
  const r = await runIntentSearch(text);
  return { r, ids: r.items.filter((i) => i.type === 'business_availability').map((i) => i.partnerId).sort() };
}

describe('businesses that do not accommodate something are left out of conflicting asks (item 86)', () => {
  it('a plain ask keeps everyone', async () => {
    const { ids, r } = await ask('dinner tonight', ['plain', 'bar', 'nokids', 'nopets']);
    expect(ids).toEqual(['bar', 'nokids', 'nopets', 'plain']);
    expect((await ask('dinner tonight', ['small', 'indoor', 'booked'])).ids).toEqual(['booked', 'indoor', 'small']);
    expect(r.openEndedNote ?? '').not.toMatch(/Leaving out places/);
  });
  it('kids: no-children and 21+ businesses are removed, and the caption says so', async () => {
    const { ids, r } = await ask('dinner tonight with my kids', ['plain', 'bar', 'nokids', 'nopets']);
    expect(ids).not.toContain('bar');
    expect(ids).not.toContain('nokids');
    expect(ids).toContain('plain');
    expect(r.openEndedNote).toMatch(/Leaving out places that don't take children/);
  });
  it('"no kids" is not a children ask', async () => {
    const { ids } = await ask('dinner tonight, no kids', ['plain', 'nokids']);
    expect(ids).toContain('nokids');
  });
  it('a dog removes the no-pets business only', async () => {
    const { ids } = await ask('dinner tonight with my dog', ['plain', 'nokids', 'nopets']);
    expect(ids).not.toContain('nopets');
    expect(ids).toContain('nokids');
  });
  it('a party of 10 removes a business whose largest group is 6', async () => {
    const { ids } = await ask('dinner tonight for 10 people', ['plain', 'small']);
    expect(ids).not.toContain('small');
    expect(ids).toContain('plain');
  });
  it('outside removes the indoor-only business', async () => {
    const { ids } = await ask('dinner outside tonight', ['plain', 'indoor']);
    expect(ids).not.toContain('indoor');
  });
  it('"walk in" removes a reservation-required business', async () => {
    const { ids, r } = await ask('somewhere to walk in for dinner tonight', ['plain', 'booked']);
    expect(ids).not.toContain('booked');
    expect(r.openEndedNote).toMatch(/places that need a booking first/);
  });
});
