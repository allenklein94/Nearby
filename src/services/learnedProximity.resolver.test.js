// Item 137 through the REAL typed-ask resolver (network edges mocked, the learned profile supplied): the learned part only
// reorders eligible results, per category, never applies when the words state a distance or way of travelling, and changes
// nothing for someone with nothing learned.
jest.mock('expo-location', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000001') }));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn(async () => ({ data: null, error: null })) } }));
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
jest.mock('./learnedProximity', () => ({ getMyLearnedProximity: jest.fn(async () => ({})) }));

import { runIntentSearch } from './intentResolver';
import { getNearbyGatherings } from './gatherings';
import { classifyCreateRequest } from './createAssistant';
import { getMyLearnedProximity } from './learnedProximity';
import { learnProximity } from '../utils/learnedProximity';
import { recordTypedAsk } from './typedAskAudit';
import { supabase } from './supabase';

const soon = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
const g = (id, tag, miles) => ({ id, title: `G ${id}`, interest_tag: tag, scheduled_at: soon, capacity: null, approvedCount: 0, distanceMiles: miles });
const trips = (category, miles) => miles.map((m, i) => ({ category, trip_miles: m, event_type: 'join', created_at: new Date(Date.UTC(2026, 8, 1 + i)).toISOString() }));
const COFFEE_WALKER = learnProximity(trips('Coffee', [0.3, 0.4, 0.5, 0.4]));
const DINNER_DRIVER = learnProximity(trips('Restaurants', [15, 18, 20, 16]));

async function ask(text, list, learned, category) {
  getNearbyGatherings.mockResolvedValue(list);
  getMyLearnedProximity.mockResolvedValue(learned);
  classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category, dateWindow: null, attributes: [] });
  const r = await runIntentSearch(text);
  return r.items.filter((i) => i.type === 'gathering');
}
const scores = (items) => Object.fromEntries(items.map((i) => [i.id, i.score]));

describe('typed asks with a learned proximity', () => {
  const COFFEE = [g('far', 'Coffee', 6), g('mid', 'Coffee', 1.5), g('near', 'Coffee', 0.4)];

  it('a coffee walker: the close cafe gains, the far one sinks; same results either way', async () => {
    const base = scores(await ask('coffee', COFFEE, {}, 'Coffee'));
    const items = await ask('coffee', COFFEE, COFFEE_WALKER, 'Coffee');
    const s = scores(items);
    expect(Object.keys(s).sort()).toEqual(Object.keys(base).sort());
    expect(s.near - base.near).toBe(1);
    expect(s.mid - base.mid).toBe(0);
    expect(s.far - base.far).toBe(-1);
    expect(items[0].id).toBe('near');
  });

  it('dinner habits never touch coffee', async () => {
    expect(scores(await ask('coffee', COFFEE, DINNER_DRIVER, 'Coffee'))).toEqual(scores(await ask('coffee', COFFEE, {}, 'Coffee')));
  });

  it('a dinner driver: a usual-distance restaurant gains, but never passes a closer one on this alone', async () => {
    const DINNER = [g('far', 'Restaurants', 17), g('close', 'Restaurants', 1)];
    const items = await ask('restaurant', DINNER, DINNER_DRIVER, 'Restaurants');
    const s = scores(items);
    const base = scores(await ask('restaurant', DINNER, {}, 'Restaurants'));
    expect(s.far - base.far).toBe(1);
    expect(s.close - base.close).toBe(1); // a closer one is also within the usual trip
    expect(items[0].id).toBe('close');
  });

  it.each([
    ['coffee within walking distance'],
    ['coffee, I\'m walking'],
    ['coffee, willing to drive a bit'],
  ])('"%s": the words control distance, learning is off', async (text) => {
    expect(scores(await ask(text, COFFEE, COFFEE_WALKER, 'Coffee'))).toEqual(scores(await ask(text, COFFEE, {}, 'Coffee')));
  });

  it('the learned step is in the audit trail with its delta, and the deltas still explain each score', async () => {
    getNearbyGatherings.mockResolvedValue(COFFEE);
    getMyLearnedProximity.mockResolvedValue(COFFEE_WALKER);
    classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: 'Coffee', dateWindow: null, attributes: [] });
    const r = await runIntentSearch('coffee');
    supabase.rpc.mockClear();
    recordTypedAsk('discover', r);
    const payload = supabase.rpc.mock.calls.find((c) => c[0] === 'record_typed_ask_snapshot')[1].snapshot;
    const row = (id) => payload.results.find((x) => x.result_id === id);
    expect(row('near').signals).toEqual(expect.arrayContaining([{ code: 'learned_proximity', delta: 1 }]));
    expect(row('far').signals).toEqual(expect.arrayContaining([{ code: 'learned_proximity', delta: -1 }]));
    expect(row('mid').signals.map((x) => x.code)).not.toContain('learned_proximity');
    for (const x of payload.results) expect(x.signals.reduce((a, y) => a + y.delta, 0)).toBeCloseTo(x.score, 3);
    // the person's trips themselves are never in the snapshot
    expect(JSON.stringify(payload)).not.toMatch(/typicalMiles|trip_miles/);
  });

  it('a failed lookup changes nothing', async () => {
    getMyLearnedProximity.mockRejectedValueOnce(new Error('offline'));
    getNearbyGatherings.mockResolvedValue(COFFEE);
    classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: 'Coffee', dateWindow: null, attributes: [] });
    const r = await runIntentSearch('coffee');
    expect(scores(r.items.filter((i) => i.type === 'gathering'))).toEqual(scores(await ask('coffee', COFFEE, {}, 'Coffee')));
  });
});
