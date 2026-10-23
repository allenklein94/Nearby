// Owner (2026-10-23): a search respects the day the words state. A named weekday ("pickleball Friday") or an explicit date
// ("coffee November 4") keeps only gatherings on that local day, the way "tomorrow" keeps tomorrow's (resolveGatherings via
// statedWhenDay, the WHEN chip's own rule); a removed or changed WHEN goes back to the chosen window; an unreadable date
// ("11/4", "Friday, November 6" when Nov 6 is not a Friday) filters nothing. Real resolver over a fixed set of gatherings.
jest.mock('expo-location', () => ({}));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./behaviorSignals', () => ({ recordSearchBehavior: jest.fn(), getMyLearnedAffinity: jest.fn(async () => ({ behavior: {}, maturity: null })) }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(async () => ({ coords: { latitude: 40.3, longitude: -75.2 } })) }));
jest.mock('./gatherings', () => ({ getNearbyGatherings: jest.fn(), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })) }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('./brandOffers', () => ({
  getActiveOffers: jest.fn(async () => []), logBusinessProfileView: jest.fn(), getPartnerWeatherSettings: jest.fn(async () => ({})),
  getPartnerPriceInfo: jest.fn(async () => new Map()), getPartnerSuitedAges: jest.fn(async () => new Map()),
  getPartnerOperatingInfo: jest.fn(async () => new Map()), getDeclinedBusinesses: jest.fn(async () => new Map()),
}));
jest.mock('./businessFulfillment', () => ({
  getConnectedOpenBusinessRequests: jest.fn(async () => []), searchActiveBusinessAvailability: jest.fn(async () => []),
  searchPolicyOnlyBusinesses: jest.fn(async () => []), searchOccasionOfferingBusinesses: jest.fn(async () => []),
  getMyBusinessAffinitySignals: jest.fn(async () => ({ followedPartnerIds: new Set(), pastPartnerIds: new Set(), declaredInterests: [] })),
}));
jest.mock('./preferencePolls', () => ({ getWhoForPreferenceSignals: jest.fn(async () => ({ cuisineKeys: [], venueKeys: [] })) }));
jest.mock('./occasionPackages', () => ({ searchOccasionPackages: jest.fn(async () => []), formatOccasionPackageDetail: jest.fn() }));
jest.mock('./homeDashboard', () => ({ getSocialForecast: jest.fn(async () => null) }));
jest.mock('./createAssistant', () => ({ classifyCreateRequest: jest.fn() }));
jest.mock('./intentOutcomes', () => ({ recordIntentSubmission: jest.fn(async () => 'sub-1') }));
jest.mock('./travelTime', () => ({ getTravelTimes: jest.fn(async () => null) }));

const { resolveClassifiedAsk } = require('./intentResolver');
const { getNearbyGatherings } = require('./gatherings');
const { getConnectedOpenBusinessRequests } = require('./businessFulfillment');
const { resolveAsk, toClassification } = require('../utils/askResolver');
const { removeUnderstoodPiece, changeUnderstoodPiece } = require('../utils/askUnderstood');

const NOW = new Date(2026, 8, 30, 15, 0, 0); // Wednesday Sep 30 2026, 3 PM local
const on = (m, d, h) => new Date(2026, m - 1, d, h, 0, 0).toISOString();
const GATHERINGS = [
  ['g-thu', on(10, 1, 18)], ['g-fri', on(10, 2, 18)], ['g-sat', on(10, 3, 10)], ['g-sun', on(10, 4, 10)],
  ['g-nextwed', on(10, 7, 18)], ['g-nov4', on(11, 4, 18)],
].map(([id, when]) => ({ id, title: `Coffee ${id}`, interest_tag: 'Coffee', scheduled_at: when, distanceMiles: 1, capacity: null, approvedCount: 0 }));

const ask = (text) => toClassification(resolveAsk(text, null), text);
const ids = async (c, text) => (await resolveClassifiedAsk(c, text)).items.filter((i) => i.type === 'gathering').map((i) => i.id).sort();

beforeAll(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask', 'clearTimeout', 'clearInterval'] });
  getNearbyGatherings.mockResolvedValue(GATHERINGS);
});
afterAll(() => jest.useRealTimers());

describe('a stated day keeps that day', () => {
  test('bare weekdays with no time: "coffee friday", "coffee saturday", "coffee next wednesday"', async () => {
    expect(await ids(ask('coffee friday'), 'coffee friday')).toEqual(['g-fri']);
    expect(await ids(ask('coffee saturday'), 'coffee saturday')).toEqual(['g-sat']); // was the whole weekend
    expect(await ids(ask('coffee next wednesday'), 'coffee next wednesday')).toEqual(['g-nextwed']);
  });
  test('an explicit date: "coffee november 4", "coffee on the 4th of november"', async () => {
    expect(await ids(ask('coffee november 4'), 'coffee november 4')).toEqual(['g-nov4']);
    expect(await ids(ask('coffee on the 4th of november'), 'coffee on the 4th of november')).toEqual(['g-nov4']);
  });
  test('the same day reaches friends\' open requests', async () => {
    getConnectedOpenBusinessRequests.mockClear();
    await resolveClassifiedAsk(ask('coffee friday'), 'coffee friday');
    expect(getConnectedOpenBusinessRequests).toHaveBeenCalledWith(expect.objectContaining({ dateStart: '2026-10-02', dateEnd: '2026-10-02' }));
  });
});

describe('unchanged where no single day is stated', () => {
  test('this weekend, Saturday or Sunday, tomorrow and no day keep their windows', async () => {
    expect(await ids(ask('coffee this weekend'), 'coffee this weekend')).toEqual(['g-sat', 'g-sun']);
    expect(await ids(ask('coffee saturday or sunday'), 'coffee saturday or sunday')).toEqual(['g-sat', 'g-sun']);
    expect(await ids(ask('coffee tomorrow'), 'coffee tomorrow')).toEqual(['g-thu']);
    expect((await ids(ask('coffee'), 'coffee')).length).toBeGreaterThan(2); // several days kept (results are capped at 4)
  });
  test('an unreadable or contradicting date filters nothing: "11/4", "friday november 5" (Nov 5 is a Thursday)', async () => {
    expect((await ids(ask('coffee 11/4'), 'coffee 11/4')).length).toBeGreaterThan(2); // several days kept (results are capped at 4)
    expect((await ids(ask('coffee friday november 5'), 'coffee friday november 5')).length).toBeGreaterThan(2); // several days kept (results are capped at 4)
  });
});

describe('correcting the day on the chip', () => {
  test('removing WHEN drops the day; changing it to Tomorrow uses Tomorrow', async () => {
    const t = 'coffee friday';
    expect((await ids(removeUnderstoodPiece(ask(t), 'when'), t)).length).toBeGreaterThan(2); // several days kept (results are capped at 4)
    expect(await ids(changeUnderstoodPiece(ask(t), 'when', 'tomorrow', t), t)).toEqual(['g-thu']);
  });
  test('"coffee friday" changed straight to Saturday keeps only Saturday (owner 2026-10-23)', async () => {
    const t = 'coffee friday';
    expect(await ids(changeUnderstoodPiece(ask(t), 'when', '2026-10-03', t), t)).toEqual(['g-sat']);
    expect(await ids(changeUnderstoodPiece(ask(t), 'when', '2026-10-01', t), t)).toEqual(['g-thu']);
    getConnectedOpenBusinessRequests.mockClear();
    await resolveClassifiedAsk(changeUnderstoodPiece(ask(t), 'when', '2026-10-03', t), t);
    expect(getConnectedOpenBusinessRequests).toHaveBeenCalledWith(expect.objectContaining({ dateStart: '2026-10-03', dateEnd: '2026-10-03' }));
  });
  test('"coffee saturday" changed to This weekend widens to both days', async () => {
    const t = 'coffee saturday';
    expect(await ids(changeUnderstoodPiece(ask(t), 'when', 'weekend', t), t)).toEqual(['g-sat', 'g-sun']);
  });
});
