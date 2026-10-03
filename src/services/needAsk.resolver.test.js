// Owner item 162 (2026-10-03, LOCKED): Want vs Need. Drives the REAL resolver (runIntentSearch -> resolveIntent) with its
// network edges mocked. A need (the asked category is a need/service group) orders availability > proximity > reliability >
// personalization, each level a tie-breaker for the one before; a want keeps today's order.
jest.mock('expo-location', () => ({}));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(async () => ({ coords: { latitude: 40.3, longitude: -75.2 } })) }));
jest.mock('./gatherings', () => ({ getNearbyGatherings: jest.fn(async () => []), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })) }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('./brandOffers', () => ({
  getActiveOffers: jest.fn(async () => []), logBusinessProfileView: jest.fn(), getPartnerWeatherSettings: jest.fn(async () => ({})),
  getPartnerPriceInfo: jest.fn(async () => new Map()), getPartnerSuitedAges: jest.fn(async () => ({})), getPartnerOperatingInfo: jest.fn(async () => new Map()),
}));
jest.mock('./businessFulfillment', () => ({
  getConnectedOpenBusinessRequests: jest.fn(async () => []), searchActiveBusinessAvailability: jest.fn(async () => []),
  searchPolicyOnlyBusinesses: jest.fn(async () => []), searchOccasionOfferingBusinesses: jest.fn(async () => []),
  getMyBusinessAffinitySignals: jest.fn(async () => ({})), getPartnerReputations: jest.fn(async () => new Map()),
}));
jest.mock('./preferencePolls', () => ({ getWhoForPreferenceSignals: jest.fn(async () => ({})) }));
jest.mock('./occasionPackages', () => ({ searchOccasionPackages: jest.fn(async () => []), formatOccasionPackageDetail: jest.fn() }));
jest.mock('./homeDashboard', () => ({ getSocialForecast: jest.fn(async () => null) }));
jest.mock('./createAssistant', () => ({ classifyCreateRequest: jest.fn() }));
jest.mock('./intentOutcomes', () => ({ recordIntentSubmission: jest.fn(async () => 'sub-1') }));
jest.mock('./behaviorSignals', () => ({ recordSearchBehavior: jest.fn(), getMyLearnedAffinity: jest.fn(async () => null) }));

import { runIntentSearch } from './intentResolver';
import { searchActiveBusinessAvailability, getMyBusinessAffinitySignals, getPartnerReputations } from './businessFulfillment';
import { classifyCreateRequest } from './createAssistant';
import { askKind, orderNeedResults, needAvailabilityTime, NEED_CAPTION } from '../utils/needAsk';
import { RELIABILITY_MIN_OPPORTUNITIES } from '../utils/reliabilityRecord';

const FIXED_NOW = new Date(2026, 8, 30, 15, 0, 0); // a Wednesday, 3 PM local
jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());
const at = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

// live = a posting open right now (available); later = a posting that starts in 3 hours (not usable now: unknown)
const row = (id, { miles = 1, live = true, category = 'Car Wash' } = {}) => ({
  id, partner_id: `p-${id}`, partner_name: `Biz ${id}`, title: 'Open slots', category,
  distance_miles: miles, starts_at: live ? at(-1) : at(3), ends_at: live ? at(2) : at(6), remaining_capacity: 5,
});
const ESTABLISHED = { total_opportunities: RELIABILITY_MIN_OPPORTUNITIES, completion_rate: 90 };

async function ask(text, category, rows, { followed = [], established = [], dateWindow = 'today' } = {}) {
  searchActiveBusinessAvailability.mockResolvedValue(rows);
  getMyBusinessAffinitySignals.mockResolvedValue({ followedPartnerIds: new Set(followed.map((id) => `p-${id}`)) });
  getPartnerReputations.mockResolvedValue(new Map(established.map((id) => [`p-${id}`, ESTABLISHED])));
  classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category, dateWindow, attributes: [] });
  const out = await runIntentSearch(text);
  return { ids: out.items.filter((i) => i.type === 'business_availability').map((i) => i.id), out };
}

describe('classification: from the resolved category only, never the word "need"', () => {
  it('a need group category is a NEED; "I need coffee" / "I need a drink" stay WANT', () => {
    expect(askKind({ category: 'Car Wash' })).toBe('need');
    expect(askKind({ category: 'Plumbing' })).toBe('need');
    expect(askKind({ category: 'Grooming' })).toBe('need');
    expect(askKind({ category: 'Coffee' })).toBe('want');
    expect(askKind({ category: 'Bars & Lounges' })).toBe('want');
    expect(askKind({ category: null })).toBe('want');
  });

  it('a need ask shows the caption and records ask_kind; a want does neither', async () => {
    const need = await ask('I need a car wash today', 'Car Wash', [row('a')]);
    expect(need.out.openEndedNote).toContain(NEED_CAPTION);
    expect(need.out.audit.interpretation.ask_kind).toBe('need');
    const want = await ask('I need coffee', 'Coffee', [row('a', { category: 'Coffee' })]);
    expect(want.out.openEndedNote ?? '').not.toContain(NEED_CAPTION);
    expect(want.out.audit.interpretation.ask_kind).toBe('want');
  });
});

describe('need ordering: strictly availability > proximity > reliability > personalization', () => {
  it('availability decides first: an open-now place beats a closer, followed, established one that is not usable now', async () => {
    const { ids } = await ask('I need a car wash today', 'Car Wash', [row('near', { miles: 0.5, live: false }), row('open', { miles: 8 })], { followed: ['near'], established: ['near'] });
    expect(ids).toEqual(['open', 'near']);
  });

  it('availability tied: proximity decides; reliability and personalization cannot override a measured distance', async () => {
    const { ids } = await ask('I need a car wash today', 'Car Wash', [row('far', { miles: 6 }), row('near', { miles: 3 })], { followed: ['far'], established: ['far'] });
    expect(ids).toEqual(['near', 'far']);
  });

  it('availability and proximity tied: reliability decides over personalization', async () => {
    const { ids } = await ask('I need a car wash today', 'Car Wash', [row('liked', { miles: 3 }), row('reliable', { miles: 3 })], { followed: ['liked'], established: ['reliable'] });
    expect(ids).toEqual(['reliable', 'liked']);
  });

  it('only when everything before is tied does personalization decide', async () => {
    const { ids } = await ask('I need a car wash today', 'Car Wash', [row('other', { miles: 3 }), row('liked', { miles: 3 })], { followed: ['liked'] });
    expect(ids).toEqual(['liked', 'other']);
  });

  it('nothing is removed: the same results as without need ordering', async () => {
    const rows = [row('a', { miles: 4 }), row('b', { miles: 1, live: false }), row('c', { miles: 2 })];
    const { ids } = await ask('I need a car wash today', 'Car Wash', rows);
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('a failed reliability lookup = everyone neutral, never an error', async () => {
    getPartnerReputations.mockRejectedValueOnce(new Error('down'));
    searchActiveBusinessAvailability.mockResolvedValue([row('far', { miles: 6 }), row('near', { miles: 3 })]);
    getMyBusinessAffinitySignals.mockResolvedValue({});
    classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: 'Car Wash', dateWindow: 'today', attributes: [] });
    const out = await runIntentSearch('I need a car wash today');
    expect(out.items.filter((i) => i.type === 'business_availability').map((i) => i.id)).toEqual(['near', 'far']);
  });

  it('a want ask keeps today\'s order (a followed place can still lead a closer one)', async () => {
    const { ids } = await ask('somewhere for a drink', 'Bars & Lounges', [row('near', { miles: 0.5, category: 'Bars & Lounges' }), row('liked', { miles: 6, category: 'Bars & Lounges' })], { followed: ['liked'], dateWindow: null });
    expect(ids[0]).toBe('liked');
  });
});

describe('orderNeedResults (the rule, buckets reuse existing ones)', () => {
  const ent = (c) => c.entity;
  const now = new Date();
  const open = { kind: 'business', posting: { startsAt: at(-1), endsAt: at(1), remainingCapacity: 3 } };
  it('unknown distance sorts after every measured distance; full ties keep the existing order', () => {
    const items = [{ id: 'x', entity: open }, { id: 'y', entity: open, distanceMiles: 9 }, { id: 'z', entity: open, distanceMiles: 9 }];
    expect(orderNeedResults(items, { toEntity: ent, at: now, reputations: new Map() }).map((c) => c.id)).toEqual(['y', 'z', 'x']);
  });
  it('a time window with no specific time (tonight, tomorrow, weekend) leaves availability tied for everyone', () => {
    expect(needAvailabilityTime('today', now)).toBe(now);
    expect(needAvailabilityTime(null, now)).toBe(now);
    expect(needAvailabilityTime('tonight', now)).toBeNull();
    expect(needAvailabilityTime('tomorrow', now)).toBeNull();
  });
});
