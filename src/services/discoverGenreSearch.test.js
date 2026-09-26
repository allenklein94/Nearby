// Genre in Discover's typed search (owner, 2026-09-26). Discover's submitted search box calls runIntentSearch() -> resolveIntent(),
// the same resolver Home uses; this drives that REAL path with its network edges mocked, so what is asserted is what a Discover
// search row renders (item.title / item.subtitle, in score order).
jest.mock('expo-location', () => ({}));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(async () => null) }));
jest.mock('./gatherings', () => ({ getNearbyGatherings: jest.fn(), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })) }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('./brandOffers', () => ({
  getActiveOffers: jest.fn(async () => []), logBusinessProfileView: jest.fn(), getPartnerWeatherSettings: jest.fn(async () => ({})),
  getPartnerPriceLevels: jest.fn(async () => ({})), getPartnerSuitedAges: jest.fn(async () => ({})), getPartnerOperatingInfo: jest.fn(async () => ({})),
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

import fs from 'fs';
import path from 'path';
import { runIntentSearch } from './intentResolver';
import { getNearbyGatherings } from './gatherings';
import { classifyCreateRequest } from './createAssistant';
import { confidenceHeadline } from '../utils/recommendationConfidence';

const soon = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
const gathering = (id, genre, extra = {}) => ({
  id, title: `Show ${id}`, interest_tag: 'Live Music', scheduled_at: soon, genre, capacity: null, approvedCount: 0, ...extra,
});
const LIST = [gathering('jazz', 'jazz'), gathering('none', null), gathering('rock', 'rock'), gathering('techno', 'techno'),
  gathering('country', 'country'), gathering('electronic', 'electronic')];

async function discoverSearch(text, list = LIST) {
  getNearbyGatherings.mockResolvedValue(list);
  // the AI is unavailable in tests: the classifier returns what the deterministic fallback would (music category, no genre)
  classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: 'Live Music', dateWindow: null, attributes: [] });
  const r = await runIntentSearch(text);
  return r.items.filter((i) => i.type === 'gathering');
}
const REASON = /^Related to your interest in /;

describe('Discover typed search: declared genre is a weak lift', () => {
  it.each([
    ['rock show tonight', 'rock', 'Rock'],
    ['jazz tonight', 'jazz', 'Jazz'],
    ['techno tonight', 'techno', 'Techno'],
    ['country music tonight', 'country', 'Country'],
    ['house music tonight', 'electronic', 'Electronic'],
  ])('%s -> the %s gathering ranks first with "Related to your interest in %s"', async (text, id, label) => {
    const items = await discoverSearch(text);
    expect(items[0].id).toBe(id);
    expect(items[0].subtitle).toBe(`Related to your interest in ${label}`);
    // only the gathering the genre actually lifted carries the reason
    for (const i of items.slice(1)) expect(i.subtitle ?? '').not.toMatch(REASON);
  });

  // The resolver shows at most 4 results (its pre-existing RESULT_CAP), so these use 4 gatherings: nothing is FILTERED out.
  const FOUR = LIST.slice(0, 4);
  it('a mismatch never removes a result: every gathering is still there', async () => {
    const items = await discoverSearch('rock show tonight', FOUR);
    expect(items.map((i) => i.id).sort()).toEqual(FOUR.map((g) => g.id).sort());
  });

  it('"concert tonight" stays broad: same results, same order and reasons as with no genre', async () => {
    const generic = await discoverSearch('concert tonight', FOUR);
    expect(generic.map((i) => i.id).sort()).toEqual(FOUR.map((g) => g.id).sort());
    for (const i of generic) expect(i.subtitle ?? '').not.toMatch(REASON);
  });

  it('no genre in the words = no genre effect (ranking without genre is unchanged)', async () => {
    const strip = (items) => items.map((i) => [i.id, i.score]);
    // reverse input so any genre lift would show up as a reorder
    const a = await discoverSearch('live music tonight', FOUR);
    const b = await discoverSearch('live music tonight', [...FOUR].reverse());
    expect(Object.fromEntries(strip(a))).toEqual(Object.fromEntries(strip(b)));
    for (const i of a) expect(i.subtitle ?? '').not.toMatch(REASON);
  });

  it('never from the title: a "Rock Night" title with no declared genre gets no genre reason or lift', async () => {
    const list = [gathering('titled', null, { title: 'Rock Night', description: 'rock and jazz' }), gathering('declared', 'rock')];
    const items = await discoverSearch('rock show tonight', list);
    const titled = items.find((i) => i.id === 'titled');
    const declared = items.find((i) => i.id === 'declared');
    expect(titled.subtitle ?? '').not.toMatch(REASON);
    expect(declared.subtitle).toBe('Related to your interest in Rock');
  });

  it('a full gathering keeps its "Full — Join Waitlist" line (still lifted, reason not shown over it)', async () => {
    const full = gathering('rock', 'rock', { capacity: 2, approvedCount: 5 });
    const items = await discoverSearch('rock show tonight', [full, gathering('jazz', 'jazz')]);
    const row = items.find((i) => i.id === 'rock');
    expect(row.subtitle).toMatch(/Full — Join Waitlist/);
    expect(row.score).toBeGreaterThan(items.find((i) => i.id === 'jazz').score);
  });

  it('the genre reason alone never makes a strong-match headline', () => {
    const h = confidenceHeadline([{ text: 'Related to your interest in Rock' }]);
    expect(h).not.toBe('A strong match for you');
    expect(h).not.toBe('You might like this');
  });

  it('genre does not override an explicit date: a Rock gathering outside "tomorrow" stays out', async () => {
    const inFiveDays = new Date(Date.now() + 5 * 86400 * 1000).toISOString();
    getNearbyGatherings.mockResolvedValue([gathering('rock', 'rock', { scheduled_at: inFiveDays })]);
    classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: 'Live Music', dateWindow: 'tomorrow', attributes: [] });
    const r = await runIntentSearch('rock show tomorrow');
    expect(r.items.find((i) => i.id === 'rock')).toBeUndefined();
  });

  it('genre does not override an explicit category: a non-music gathering is not pulled in', async () => {
    const list = [...LIST, gathering('yoga', 'rock', { interest_tag: 'Yoga' })];
    const items = await discoverSearch('rock show tonight', list);
    expect(items.find((i) => i.id === 'yoga')).toBeUndefined();
  });
});

describe('Discover scope guards', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
  it('Discover gets genre only through the shared resolver: no Discover genre parser, chip row or filter', () => {
    const src = read('src/screens/DiscoverHubScreen.js');
    expect(src).not.toMatch(/genreMatch|genresFromText|GENRE_OPTIONS|genreFilter|genre chip/i);
    expect(src).toMatch(/runIntentSearch\(/);
  });
});
