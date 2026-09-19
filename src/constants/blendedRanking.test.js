import { blendedCategoryScore, rankByBlend, forYouBlend, behaviorWeightMap, EXPLICIT_POINTS, BEHAVIOR_MAX_POINTS } from './blendedRanking';

const items = [{ id: 1, interest_tag: 'Yoga' }, { id: 2, interest_tag: 'Coffee' }, { id: 3, interest_tag: 'Hiking' }];
const behavior = { Hiking: 12, Yoga: 0 };

test('brand-new account: explicit wins, behavior is ignored (maturity 0)', () => {
  const ctx = { declared: ['Coffee'], behavior, maturity: 0 };
  expect(rankByBlend(items, ctx).map((i) => i.id)).toEqual([2, 1, 3]);
  expect(blendedCategoryScore('Hiking', ctx)).toBe(0);
});

test('mature account: behavior joins explicit, but never outranks a declared interest on its own', () => {
  const ctx = { declared: ['Coffee'], behavior, maturity: 1 };
  expect(blendedCategoryScore('Hiking', ctx)).toBe(BEHAVIOR_MAX_POINTS);
  expect(blendedCategoryScore('Coffee', ctx)).toBe(EXPLICIT_POINTS);
  expect(rankByBlend(items, ctx).map((i) => i.id)).toEqual([2, 3, 1]);
});

test('declared + behavior stack', () => {
  expect(blendedCategoryScore('Hiking', { declared: ['Hiking'], behavior, maturity: 1 })).toBe(EXPLICIT_POINTS + BEHAVIOR_MAX_POINTS);
});

test('no signals keeps the original order; nothing is dropped', () => {
  expect(rankByBlend(items, { declared: [], behavior: {}, maturity: 1 })).toBe(items);
  expect(rankByBlend(items, { declared: ['Coffee'], behavior, maturity: 0.3 })).toHaveLength(3);
});

test('unknown maturity (null) leaves behavior at full trust, matching the model default', () => {
  expect(blendedCategoryScore('Hiking', { declared: [], behavior, maturity: null })).toBe(BEHAVIOR_MAX_POINTS);
});

test('forYouBlend: new account = declared only; mature adds behavior-only categories', () => {
  expect(forYouBlend(['Coffee'], behavior, 0)).toEqual(['Coffee']);
  expect(forYouBlend(['Coffee'], behavior, 1)).toEqual(['Coffee', 'Hiking']);
});

test('behaviorWeightMap', () => {
  expect(behaviorWeightMap([{ category: 'Coffee', weight: 4 }, { category: null, weight: 9 }])).toEqual({ Coffee: 4 });
});

test('behaviorNudge: dampened for new accounts, full for mature, none without behavior', () => {
  const { behaviorNudge } = require('./blendedRanking');
  expect(behaviorNudge('Hiking', { behavior, maturity: 0 })).toBe(0);
  expect(behaviorNudge('Hiking', { behavior, maturity: 1 })).toBe(BEHAVIOR_MAX_POINTS);
  expect(behaviorNudge('Coffee', { behavior, maturity: 1 })).toBe(0);
});
