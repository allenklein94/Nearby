import { blendedCategoryScore, forYouBlend, behaviorWeightMap, EXPLICIT_POINTS, BEHAVIOR_MAX_POINTS } from './blendedRanking';

const behavior = { Hiking: 12, Yoga: 0 };

test('brand-new account: explicit wins, behavior is ignored (maturity 0)', () => {
  const ctx = { declared: ['Coffee'], behavior, maturity: 0 };
  expect(blendedCategoryScore('Hiking', ctx)).toBe(0);
});

test('mature account: behavior joins explicit, but never outranks a declared interest on its own', () => {
  const ctx = { declared: ['Coffee'], behavior, maturity: 1 };
  expect(blendedCategoryScore('Hiking', ctx)).toBe(BEHAVIOR_MAX_POINTS);
  expect(blendedCategoryScore('Coffee', ctx)).toBe(EXPLICIT_POINTS);
});

test('declared + behavior stack', () => {
  expect(blendedCategoryScore('Hiking', { declared: ['Hiking'], behavior, maturity: 1 })).toBe(EXPLICIT_POINTS + BEHAVIOR_MAX_POINTS);
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

describe('broad group interest', () => {
  const { blendedCategoryScore, broadGroupNudge, EXPLICIT_POINTS, BROAD_GROUP_POINTS } = require('./blendedRanking');
  const { CATEGORY_GROUPS } = require('./gatheringCategories');
  const g = CATEGORY_GROUPS.find((x) => x.tags.length > 1);
  const [t1, t2] = g.tags;
  it('group-only is weak, a declared tag is stronger, no group is nothing', () => {
    expect(blendedCategoryScore(t1, { declaredGroups: [g.key] })).toBe(BROAD_GROUP_POINTS);
    expect(blendedCategoryScore(t1, { declared: [t1], declaredGroups: [g.key] })).toBe(EXPLICIT_POINTS);
    expect(blendedCategoryScore(t2, { declared: [t1], declaredGroups: [g.key] })).toBe(BROAD_GROUP_POINTS);
    expect(blendedCategoryScore(t1, {})).toBe(0);
    expect(BROAD_GROUP_POINTS).toBeLessThan(EXPLICIT_POINTS);
  });
  it('discover nudge skips already-declared tags', () => {
    expect(broadGroupNudge(t1, { declaredGroups: [g.key] })).toBe(BROAD_GROUP_POINTS);
    expect(broadGroupNudge(t1, { declared: [t1], declaredGroups: [g.key] })).toBe(0);
  });
});
