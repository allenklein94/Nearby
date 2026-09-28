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
// The full ranked list (the shown list is capped), captured as it reaches plan assembly.
jest.mock('./experienceAssembly', () => {
  const real = jest.requireActual('./experienceAssembly');
  return { ...real, assembleExperience: jest.fn((...args) => real.assembleExperience(...args)) };
});

import { runIntentSearch } from './intentResolver';
import { classifyCreateRequest } from './createAssistant';
import { searchActiveBusinessAvailability } from './businessFulfillment';
import { getPartnerOperatingInfo, getDeclinedBusinesses } from './brandOffers';
import { resolveAsk, toClassification } from '../utils/askResolver';
import { askBusinessParamsFromAsk } from './askToBusiness';
import { assembleExperience } from './experienceAssembly';

// Item 130: "probably a group" lifts businesses that DECLARED they take groups; it is never a headcount, filter or penalty.
const now = Date.now();
const posting = (id) => ({
  id: `post-${id}`, partner_id: id, partner_name: id, title: 'Tables open', category: 'Restaurants', subcategory: 'Restaurants', categories: [],
  attributes: [], cuisine: null, distance_miles: 1, remaining_capacity: 30, starts_at: new Date(now - 3600e3).toISOString(),
  ends_at: new Date(now + 5 * 3600e3).toISOString(), price: null,
});
const PARTNERS = new Map([
  ['plain', { id: 'plain', attributes: [] }],
  ['groupy', { id: 'groupy', attributes: ['group_friendly'] }],
  ['takes', { id: 'takes', attributes: [], accommodates_party_types: ['groups'] }],
  ['big', { id: 'big', attributes: [], max_group_size: 40 }],
  ['small', { id: 'small', attributes: [], max_group_size: 4 }],
]);

async function ask(text) {
  const cls = toClassification(resolveAsk(text, null));
  classifyCreateRequest.mockResolvedValue(cls);
  searchActiveBusinessAvailability.mockResolvedValue([...PARTNERS.keys()].map(posting));
  getPartnerOperatingInfo.mockResolvedValue(PARTNERS);
  getDeclinedBusinesses.mockReset();
  getDeclinedBusinesses.mockResolvedValue(new Map());
  assembleExperience.mockClear();
  const r = await runIntentSearch(text);
  const ranked = assembleExperience.mock.calls[0]?.[1] ?? [];
  const score = Object.fromEntries(ranked.filter((i) => i.type === 'business_availability').map((i) => [i.partnerId, i.score]));
  return { r, cls, score, calls: getDeclinedBusinesses.mock.calls };
}

describe('"probably a group" (item 130)', () => {
  it("a daughter's birthday lifts businesses that declared groups by 1, and nobody else moves or disappears", async () => {
    const { score, cls } = await ask("dinner tonight for my daughter's birthday");
    expect(cls.partySize).toBeNull();
    expect(Object.keys(score).sort()).toEqual(['big', 'groupy', 'plain', 'small', 'takes']);
    for (const id of ['groupy', 'takes', 'big']) expect([id, score[id] - score.plain]).toEqual([id, 1]);
    expect(score.small).toBe(score.plain); // a small declared max is never penalized on a guess
  });

  it('never becomes a party size anywhere: not in the compatibility check, not in the business request', async () => {
    const { calls, cls } = await ask("dinner tonight for my daughter's birthday");
    for (const c of calls) expect(c[1].partySize).toBeNull();
    const params = askBusinessParamsFromAsk({ classifyResult: cls, typedText: "dinner tonight for my daughter's birthday" });
    expect(params.prefillPartySize).toBeNull();
    expect(JSON.stringify(params)).not.toMatch(/likely/i);
  });

  it('a stated number takes the explicit path: "birthday dinner for 6" is 6, and a max of 4 sinks as before', async () => {
    const { score, cls } = await ask('birthday dinner tonight for 6');
    expect(cls.partySize).toBe(6);
    expect(score.small).toBeLessThan(score.plain);
    expect(score.groupy).toBe(score.plain); // no likely-group lift on top of the real number
  });

  it('one-on-one occasions never become a group', async () => {
    for (const t of ['birthday dinner tonight with my wife', 'anniversary dinner tonight', 'dinner tonight']) {
      const { score } = await ask(t);
      expect([t, score.groupy]).toEqual([t, score.plain]);
    }
  });
});
