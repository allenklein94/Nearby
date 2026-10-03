// Unified ranking, surface 1 of 5 (typed search: Home, Discover, Surprise Me, Celebrate). The REAL resolver (network edges
// mocked, the typedAskAudit.resolver.test.js harness) orders results by the canonical framework in constants/signalPriority.js:
// a signal in a stronger tier always beats any amount of a weaker one; within a tier points add. Each case below is one the old
// additive score got the other way round.
jest.mock('expo-location', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000001') }));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn(async () => ({ data: null, error: null })) } }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(async () => ({ coords: { latitude: 34, longitude: -118 } })) }));
jest.mock('./gatherings', () => ({ getNearbyGatherings: jest.fn(), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })) }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('./brandOffers', () => ({
  getActiveOffers: jest.fn(async () => []), logBusinessProfileView: jest.fn(), getPartnerWeatherSettings: jest.fn(async () => ({})),
  getPartnerPriceInfo: jest.fn(async () => new Map()), getPartnerSuitedAges: jest.fn(async () => new Map()), getPartnerOperatingInfo: jest.fn(async () => new Map()),
  getDeclinedBusinesses: jest.fn(async () => []),
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
jest.mock('./behaviorSignals', () => ({ recordSearchBehavior: jest.fn(), getMyLearnedAffinity: jest.fn(async () => ({ behavior: {}, maturity: null })) }));

import { resolveIntent } from './intentResolver';
import { getNearbyGatherings } from './gatherings';
import { searchActiveBusinessAvailability, getConnectedOpenBusinessRequests, searchPolicyOnlyBusinesses } from './businessFulfillment';
import { getPartnerOperatingInfo } from './brandOffers';
import { compareRanked, SIGNAL_TIERS } from '../constants/signalPriority';

const inDays = (d, h = 19) => { const t = new Date(); t.setDate(t.getDate() + d); t.setHours(h, 0, 0, 0); return t.toISOString(); };
const g = (id, extra = {}) => ({
  id, title: `Gathering ${id}`, interest_tag: 'Live Music', scheduled_at: inDays(3), capacity: null, approvedCount: 0, distanceMiles: 5, ...extra,
});
const posting = (id, extra = {}) => ({
  id, partner_id: `p-${id}`, partner_name: `Biz ${id}`, title: 'Space tonight', category: 'Live Music', distance_miles: 5,
  starts_at: inDays(0, 1), ends_at: inDays(3, 23), attributes: [], ...extra,
});
const ids = (r) => r.items.map((i) => i.id);

beforeEach(() => {
  getNearbyGatherings.mockResolvedValue([]);
  searchActiveBusinessAvailability.mockResolvedValue([]);
  getConnectedOpenBusinessRequests.mockResolvedValue([]);
  searchPolicyOnlyBusinesses.mockResolvedValue([]);
  getPartnerOperatingInfo.mockResolvedValue(new Map());
});

describe('typed search follows the one ranking hierarchy', () => {
  it('1 explicit intent beats 6 a declared interest (the old sum ranked the interest first)', async () => {
    getNearbyGatherings.mockResolvedValue([
      g('interest', { matchesYourInterests: true }),
      g('asked', { genre: 'rock' }),
    ]);
    const r = await resolveIntent({ category: 'Live Music', dateWindow: null, rawText: 'a rock show' });
    expect(ids(r)).toEqual(['asked', 'interest']);
    const [asked, interest] = r.items;
    expect(interest.score).toBeGreaterThan(asked.score); // the additive score would have put it first
  });

  it('2 a stated requirement beats 5 time and 6 interest together', async () => {
    getNearbyGatherings.mockResolvedValue([
      g('today-and-mine', { interest_tag: 'Pickleball', matchesYourInterests: true, scheduled_at: inDays(0, 23) }),
      g('beginner', { interest_tag: 'Pickleball', skill_level: 'beginner' }),
    ]);
    const r = await resolveIntent({ category: 'Pickleball', dateWindow: null, rawText: 'beginner pickleball' });
    expect(ids(r)).toEqual(['beginner', 'today-and-mine']);
  });

  it('3 a friend asking for the same thing beats 4 a live business posting', async () => {
    searchActiveBusinessAvailability.mockResolvedValue([posting('ready', { distance_miles: 0.5 })]);
    getConnectedOpenBusinessRequests.mockResolvedValue([{ id: 'friend', requester_id: 'u2', requester_display_name: 'Sam', raw_text: 'live music?' }]);
    const r = await resolveIntent({ category: 'Live Music', dateWindow: null, rawText: 'live music' });
    expect(ids(r)).toEqual(['friend', 'ready']);
  });

  it('4 something that can actually happen beats 6 an interest: a full gathering sinks below one with room', async () => {
    getNearbyGatherings.mockResolvedValue([
      g('full-but-mine', { matchesYourInterests: true, capacity: 2, approvedCount: 5 }),
      g('room'),
    ]);
    const r = await resolveIntent({ category: 'Live Music', dateWindow: null, rawText: 'live music' });
    expect(ids(r)).toEqual(['room', 'full-but-mine']);
  });

  it('7 business opportunity (may be able to help) never outranks 4 confirmed availability, even when closer', async () => {
    searchActiveBusinessAvailability.mockResolvedValue([posting('confirmed', { category: null, distance_miles: 9 })]);
    searchPolicyOnlyBusinesses.mockResolvedValue([{ partner_id: 'p-policy', partner_name: 'Near', distance_miles: 0.2 }]);
    const r = await resolveIntent({ category: null, dateWindow: null, rawText: 'something' });
    expect(ids(r)).toEqual(['confirmed', 'p-policy']);
  });

  it('within a tier points add: two asked qualities beat one', async () => {
    getNearbyGatherings.mockResolvedValue([
      g('one', { genre: 'rock' }),
      g('two', { genre: 'rock', format: 'concert' }),
    ]);
    const r = await resolveIntent({ category: 'Live Music', dateWindow: null, rawText: 'a rock concert' });
    expect(ids(r)).toEqual(['two', 'one']);
  });

  it('a stated dietary need still moves the order though the audit never records it', async () => {
    searchActiveBusinessAvailability.mockResolvedValue([posting('plain', { category: 'Restaurants' }), posting('vegan', { category: 'Restaurants' })]);
    getPartnerOperatingInfo.mockResolvedValue(new Map([['p-vegan', { id: 'p-vegan', dietary_options: ['vegan'] }], ['p-plain', { id: 'p-plain' }]]));
    const r = await resolveIntent({ category: 'Restaurants', dateWindow: null, rawText: 'vegan dinner' });
    expect(ids(r)).toEqual(['vegan', 'plain']);
    for (const row of r.items) expect(r.audit.trace.signalsFor(row).map((s) => s.code)).not.toContain('dietary');
    expect(r.items[0].rankVector[SIGNAL_TIERS.constraint - 1]).toBeGreaterThan(0);
  });

  it('every result carries its tier vector, and the list is in compareRanked order', async () => {
    getNearbyGatherings.mockResolvedValue([g('a'), g('b', { genre: 'rock' }), g('c', { matchesYourInterests: true })]);
    const r = await resolveIntent({ category: 'Live Music', dateWindow: null, rawText: 'rock tonight' });
    for (const it of r.items) expect(it.rankVector).toHaveLength(10);
    expect([...r.items].sort(compareRanked).map((i) => i.id)).toEqual(ids(r));
  });
});
