// Owner item 114: session intent. A person who LOVES nightlife (declared interest) says "I want something quiet tonight": the quiet
// plan must lead, not the nightlife one. Drives the REAL resolver (runIntentSearch -> resolveIntent) with its network edges mocked.
jest.mock('expo-location', () => ({}));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(async () => null) }));
jest.mock('./gatherings', () => ({ getNearbyGatherings: jest.fn(), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })) }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('./brandOffers', () => ({
  getActiveOffers: jest.fn(async () => []), logBusinessProfileView: jest.fn(), getPartnerWeatherSettings: jest.fn(async () => ({})),
  getPartnerPriceInfo: jest.fn(async () => new Map()), getPartnerSuitedAges: jest.fn(async () => ({})), getPartnerOperatingInfo: jest.fn(async () => new Map()),
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
import { searchActiveBusinessAvailability, getMyBusinessAffinitySignals } from './businessFulfillment';
import { classifyCreateRequest } from './createAssistant';
import { getUserLocation } from './userLocation';
import { applySessionIntent, sessionIntentFromText, conflictsWithSessionIntent, HISTORY_TIEBREAK } from '../constants/sessionIntent';

// A FIXED local clock (item 118 follow-up): every relative time below ("now + 3 h" = this evening) is computed from it, so the
// suite gives the same result at any hour and in any timezone. Only Date is faked; real timers keep async mocks running.
const FIXED_NOW = new Date(2026, 8, 30, 15, 0, 0); // a Wednesday, 3 PM local
jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());
const tonight = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
// matchesYourInterests = the gathering matches a declared interest (the person loves nightlife)
const g = (id, tag, extra = {}) => ({ id, title: `Plan ${id}`, interest_tag: tag, scheduled_at: tonight, capacity: null, approvedCount: 0, ...extra });
const NIGHTLIFE = g('club', 'Nightclubs', { matchesYourInterests: true });
const QUIET = g('books', 'Coffee', { features: ['quiet'] });

async function search(text, list, businesses = [], affinity = {}) {
  getNearbyGatherings.mockResolvedValue(list);
  searchActiveBusinessAvailability.mockResolvedValue(businesses);
  getMyBusinessAffinitySignals.mockResolvedValue(affinity);
  getUserLocation.mockResolvedValue(businesses.length ? { coords: { latitude: 40.3, longitude: -75.2 } } : null);
  classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: null, dateWindow: 'tonight', attributes: [] });
  return (await runIntentSearch(text)).items;
}

describe('explicit current intent beats historical preference', () => {
  it('loves nightlife + "I want something quiet tonight" -> the quiet plan leads', async () => {
    const items = await search('I want something quiet tonight', [NIGHTLIFE, QUIET]);
    const ids = items.filter((i) => i.type === 'gathering').map((i) => i.id);
    expect(ids[0]).toBe('books');
    expect(ids).toContain('club'); // never removed, only ranked below
  });

  it('with no session intent the declared interest still counts in full (nightlife leads)', async () => {
    const items = await search('something to do tonight', [QUIET, NIGHTLIFE]);
    expect(items.filter((i) => i.type === 'gathering')[0].id).toBe('club');
  });

  it('a lively bar the person follows and has booked does not outrank a quiet place they have never been', async () => {
    const row = (id, partner, attributes) => ({ id, partner_id: partner, partner_name: `Biz ${id}`, title: 'Tables tonight', category: 'Bars & Lounges',
      attributes, distance_miles: 1, starts_at: null, ends_at: null, remaining_capacity: 10 });
    const items = await search('somewhere quiet for a drink tonight', [], [row('lively', 'p1', ['lively']), row('calm', 'p2', ['quiet'])],
      { followedPartnerIds: new Set(['p1']), pastPartnerIds: new Set(['p1']), declaredInterests: [] });
    const biz = items.filter((i) => i.type === 'business_availability').map((i) => i.id);
    expect(biz[0]).toBe('calm');
    expect(biz).toContain('lively');
  });
});

describe('the rule itself', () => {
  const c = (extra) => ({ score: 10, historyScore: 5, ...extra });
  it('no session intent = untouched', () => {
    const list = [c({ category: 'Nightclubs' })];
    expect(applySessionIntent(list, sessionIntentFromText('dinner tonight'))).toBe(list);
  });
  it('a conflicting result keeps no history; others keep only a tie-breaker', () => {
    const intent = sessionIntentFromText('something quiet');
    const [clash, other] = applySessionIntent([c({ category: 'Nightclubs' }), c({ category: 'Museums' })], intent);
    expect(clash.score).toBe(5);
    expect(other.score).toBe(10 - 5 + HISTORY_TIEBREAK);
  });
  it('a declared opposite vibe is a conflict; an undeclared one is not', () => {
    const intent = sessionIntentFromText('nothing too lively');
    expect(conflictsWithSessionIntent({ attributes: ['lively'] }, intent)).toBe(true);
    expect(conflictsWithSessionIntent({ attributes: ['quiet'] }, intent)).toBe(false);
    expect(conflictsWithSessionIntent({}, intent)).toBe(false);
  });
  it('a session intent is words only and never stored', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../constants/sessionIntent.js'), 'utf8');
    expect(src).not.toMatch(/supabase|AsyncStorage|profiles/);
  });
});
