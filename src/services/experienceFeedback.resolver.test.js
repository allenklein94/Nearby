// Owner item 35: the person's latest "How was it?" word reorders typed-ask results through the REAL resolver
// (runIntentSearch -> resolveIntent), network edges mocked. Only what the ask returned is touched.
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
jest.mock('./behaviorSignals', () => ({ recordSearchBehavior: jest.fn(), getMyLearnedAffinity: jest.fn(async () => ({ behavior: {}, maturity: null })) }));
jest.mock('./experienceFeedback', () => ({ getMyExperienceFeedback: jest.fn() }));

import { runIntentSearch } from './intentResolver';
import { getNearbyGatherings } from './gatherings';
import { classifyCreateRequest } from './createAssistant';
import { getMyExperienceFeedback } from './experienceFeedback';
import { experienceFeedbackFromRow, EMPTY_EXPERIENCE_FEEDBACK } from '../utils/experienceFeedback';

const FIXED_NOW = new Date(2026, 8, 30, 15, 0, 0);
jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());
const tonight = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
const g = (id, tag, extra = {}) => ({ id, title: `Plan ${id}`, interest_tag: tag, scheduled_at: tonight, capacity: null, approvedCount: 0, ...extra });

async function search(text, list, feedback) {
  getNearbyGatherings.mockResolvedValue(list);
  getMyExperienceFeedback.mockResolvedValue(feedback);
  classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: null, dateWindow: null, attributes: [] });
  return (await runIntentSearch(text)).items.filter((i) => i.type === 'gathering');
}

describe('experience feedback in typed asks', () => {
  const list = () => [g('a', 'Bowling', { host_id: 'h1' }), g('b', 'Bowling', { host_id: 'h2' })];

  it('Not for me moves that host\'s gathering down; nothing is removed', async () => {
    const plain = await search('something fun', list(), EMPTY_EXPERIENCE_FEEDBACK);
    const first = plain[0].id;
    const other = plain[1].id;
    const hostOfFirst = first === 'a' ? 'h1' : 'h2';
    const items = await search('something fun', list(), experienceFeedbackFromRow({ not_for_me_host_ids: [hostOfFirst] }));
    expect(items.map((i) => i.id)).toEqual([other, first]);
  });

  it('loved moves it up and says why', async () => {
    const plain = await search('something fun', list(), EMPTY_EXPERIENCE_FEEDBACK);
    const last = plain[1].id;
    const items = await search('something fun', list(), experienceFeedbackFromRow({ loved_host_ids: [last === 'a' ? 'h1' : 'h2'] }));
    expect(items[0].id).toBe(last);
    expect(items[0].reasons).toContain('You loved a gathering with this host before');
  });

  it('a failed lookup = the same results in the same order', async () => {
    const plain = await search('something fun', list(), EMPTY_EXPERIENCE_FEEDBACK);
    getMyExperienceFeedback.mockRejectedValueOnce(new Error('down'));
    getNearbyGatherings.mockResolvedValue(list());
    const failed = (await runIntentSearch('something fun')).items.filter((i) => i.type === 'gathering');
    expect(failed.map((i) => [i.id, i.score])).toEqual(plain.map((i) => [i.id, i.score]));
  });
});
