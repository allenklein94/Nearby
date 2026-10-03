// Owner item 156 Gap 1 (2026-10-03, LOCKED): the learned category affinity lifts typed-ask results, strictly subordinate to the
// ask. Drives the REAL resolver (runIntentSearch -> resolveIntent) with its network edges mocked.
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
jest.mock('./behaviorSignals', () => ({ recordSearchBehavior: jest.fn(), getMyLearnedAffinity: jest.fn() }));

import { runIntentSearch } from './intentResolver';
import { getNearbyGatherings } from './gatherings';
import { classifyCreateRequest } from './createAssistant';
import { getMyLearnedAffinity } from './behaviorSignals';
import { applyLearnedAffinity, askStatesConstraint } from '../utils/learnedAffinity';
import { HISTORY_TIEBREAK } from '../constants/sessionIntent';
import { BEHAVIOR_MAX_POINTS, EXPLICIT_POINTS } from '../constants/blendedRanking';

const FIXED_NOW = new Date(2026, 8, 30, 15, 0, 0);
jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());
const tonight = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
const g = (id, tag, extra = {}) => ({ id, title: `Plan ${id}`, interest_tag: tag, scheduled_at: tonight, capacity: null, approvedCount: 0, ...extra });
const MATURE = { behavior: { Bowling: 12 }, maturity: 1 };

async function search(text, list, learned, dateWindow = 'tonight') {
  getNearbyGatherings.mockResolvedValue(list);
  getMyLearnedAffinity.mockResolvedValue(learned);
  classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: null, dateWindow, attributes: [] });
  return (await runIntentSearch(text)).items.filter((i) => i.type === 'gathering');
}

describe('learned affinity in typed asks', () => {
  it('lifts a result the ask already returned, with "Based on your recent activity"', async () => {
    const items = await search('something to do tonight', [g('art', 'Art Galleries'), g('bowl', 'Bowling')], MATURE);
    expect(items[0].id).toBe('bowl');
    expect(items[0].reasons).toContain('Based on your recent activity: Bowling');
  });

  it('never adds anything: the same results come back, with or without learning', async () => {
    const list = [g('art', 'Art Galleries'), g('cafe', 'Coffee')];
    const without = await search('something to do tonight', list, { behavior: {}, maturity: null });
    const withIt = await search('something to do tonight', list, { behavior: { Bowling: 12, Hiking: 12 }, maturity: 1 });
    expect(withIt.map((i) => i.id).sort()).toEqual(without.map((i) => i.id).sort());
  });

  it('stays below a declared interest', async () => {
    const items = await search('something to do tonight', [g('bowl', 'Bowling'), g('art', 'Art Galleries', { matchesYourInterests: true })], MATURE);
    expect(items[0].id).toBe('art');
    expect(BEHAVIOR_MAX_POINTS).toBeLessThan(EXPLICIT_POINTS);
  });

  it('a stated mood ("something quiet") makes it a tie-breaker only', async () => {
    const items = await search('something quiet tonight', [g('bowl', 'Bowling'), g('read', 'Coffee', { features: ['quiet'] })], MATURE);
    expect(items[0].id).toBe('read');
  });

  it('failed lookup / unknown maturity = identical results', async () => {
    const list = [g('art', 'Art Galleries'), g('bowl', 'Bowling')];
    getMyLearnedAffinity.mockRejectedValueOnce(new Error('down'));
    getNearbyGatherings.mockResolvedValue(list);
    classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: null, dateWindow: 'tonight', attributes: [] });
    const failed = (await runIntentSearch('something to do tonight')).items.filter((i) => i.type === 'gathering');
    const none = await search('something to do tonight', list, { behavior: { Bowling: 12 }, maturity: null });
    expect(failed.map((i) => [i.id, i.score])).toEqual(none.map((i) => [i.id, i.score]));
  });
});

describe('any explicit stated constraint makes learned affinity a tie-breaker only (owner, 2026-10-03, LOCKED)', () => {
  // the learned category is Bowling (indoor); an outdoor ask would remove it, so that case learns Hiking instead
  const lift = async (text, dateWindow, tag = 'Bowling') => {
    const list = [g('bowl', tag), g('art', 'Beaches')];
    const withIt = await search(text, list, { behavior: { [tag]: 12 }, maturity: 1 }, dateWindow);
    const without = await search(text, list, { behavior: {}, maturity: null }, dateWindow);
    const score = (items) => items.find((i) => i.id === 'bowl').score;
    return score(withIt) - score(without);
  };

  it('no constraint stated: the full learned lift', async () => {
    expect(await lift('something to do', null)).toBe(BEHAVIOR_MAX_POINTS);
  });

  it.each([
    ['a time', 'something to do tonight', 'tonight', 'Bowling'],
    ['a budget', 'something to do under $30', null, 'Bowling'],
    ['an environment', 'something to do outdoors', null, 'Hiking'],
    ['a vibe', 'somewhere casual', null, 'Bowling'],
    ['a mood', 'somewhere quiet', null, 'Bowling'],
  ])('%s caps it at the tie-break', async (_, text, dw, tag) => {
    expect(await lift(text, dw, tag)).toBe(HISTORY_TIEBREAK);
  });

  it('it still breaks a tie, and the reason still names the category', async () => {
    const items = await search('something to do tonight', [g('art', 'Art Galleries'), g('bowl', 'Bowling')], MATURE);
    expect(items[0].id).toBe('bowl');
    expect(items[0].reasons).toContain('Based on your recent activity: Bowling');
  });

  it('never outweighs a result that meets the stated constraint', async () => {
    // learned Bowling; "quiet" is met only by the café that declared it
    const items = await search('somewhere quiet tonight', [g('bowl', 'Bowling'), g('read', 'Coffee', { features: ['quiet'] })], MATURE);
    expect(items[0].id).toBe('read');
  });

  it('askStatesConstraint: words or explicit picks only; who-with alone is not a constraint', () => {
    expect(askStatesConstraint('something fun')).toBe(false);
    expect(askStatesConstraint('something fun with my friends')).toBe(false);
    expect(askStatesConstraint('something fun', { budgetMax: 25 })).toBe(true);
    expect(askStatesConstraint('something fun', { openNowChip: true })).toBe(true);
    expect(askStatesConstraint('something fun', { narrowGroup: 'activities_recreation' })).toBe(true);
    expect(askStatesConstraint('no alcohol please')).toBe(true);
    expect(askStatesConstraint('with my dog')).toBe(true);
  });
});

describe('applyLearnedAffinity (the rule)', () => {
  it('constrained = capped at the tie-break, history recorded as the capped amount', () => {
    const [c] = applyLearnedAffinity([{ category: 'Coffee', score: 0 }], { behavior: { Coffee: 12 }, maturity: 1 }, { constrained: true });
    expect(c.score).toBe(HISTORY_TIEBREAK);
    expect(c.historyScore).toBe(HISTORY_TIEBREAK);
  });
  it('maturity scales and caps the lift; history is recorded for session intent', () => {
    const [half] = applyLearnedAffinity([{ category: 'Coffee', score: 0 }], { behavior: { Coffee: 12 }, maturity: 0.5 });
    expect(half.score).toBe(BEHAVIOR_MAX_POINTS * 0.5);
    expect(half.historyScore).toBe(BEHAVIOR_MAX_POINTS * 0.5);
    const [capped] = applyLearnedAffinity([{ category: 'Coffee', score: 0 }], { behavior: { Coffee: 40 }, maturity: 1 });
    expect(capped.score).toBe(BEHAVIOR_MAX_POINTS);
  });
  it('untouched when nothing learned, no category, or maturity unknown', () => {
    const list = [{ category: 'Coffee', score: 1 }, { category: null, score: 1 }];
    expect(applyLearnedAffinity(list, { behavior: {}, maturity: 1 })).toBe(list);
    expect(applyLearnedAffinity(list, { behavior: { Coffee: 12 }, maturity: null })).toBe(list);
    expect(applyLearnedAffinity(list, null)).toBe(list);
    expect(applyLearnedAffinity(list, { behavior: { Coffee: 12 }, maturity: 1 })[1]).toBe(list[1]);
  });
});

describe('scope guard', () => {
  const fs = require('fs');
  const path = require('path');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
  it('only consumer ranking reads it: the typed-ask resolver and Home (item 158), never routing, sponsored, eligibility or business code', () => {
    const users = walk(path.join(__dirname, '..')).filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f))
      .filter((f) => /applyLearnedAffinity\(|getMyLearnedAffinity\(/.test(fs.readFileSync(f, 'utf8')));
    expect(users.map((f) => path.relative(path.join(__dirname, '..'), f)).sort())
      .toEqual(['services/behaviorSignals.js', 'services/homeDashboard.js', 'services/intentResolver.js', 'utils/learnedAffinity.js']);
  });
  it('nothing outside the trigger writes a redeem event, and the client cannot', () => {
    const src = fs.readFileSync(path.join(__dirname, 'behaviorSignals.js'), 'utf8');
    expect(src).not.toMatch(/'redeem'/);
  });
});
