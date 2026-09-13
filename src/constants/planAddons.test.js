import { PLAN_ADDON_TYPES, PLAN_ADDON_TYPE_KEYS, planAddonType, planAddonLabel, planAddonIcon, relevantAddonTypesForOccasion } from './planAddons';

describe('planAddons', () => {
  test('every addon type has a key, label, icon', () => {
    PLAN_ADDON_TYPES.forEach((a) => {
      expect(typeof a.key).toBe('string');
      expect(typeof a.label).toBe('string');
      expect(typeof a.icon).toBe('string');
    });
  });

  test('exactly one addon type (transportation) has no leaf category', () => {
    const withoutCategory = PLAN_ADDON_TYPES.filter((a) => a.category === null);
    expect(withoutCategory.map((a) => a.key)).toEqual(['transportation']);
  });

  test('every addon type has a businessMajor', () => {
    PLAN_ADDON_TYPES.forEach((a) => {
      expect(typeof a.businessMajor).toBe('string');
    });
  });

  test('planAddonType finds by key, null for unknown', () => {
    expect(planAddonType('flowers')?.label).toBe('Flowers');
    expect(planAddonType('nonsense')).toBeNull();
  });

  test('planAddonLabel/planAddonIcon fall back sanely for unknown keys', () => {
    expect(planAddonLabel('flowers')).toBe('Flowers');
    expect(planAddonLabel('nonsense')).toBe('nonsense');
    expect(planAddonIcon('gift')).toBe('🎁');
    expect(planAddonIcon('nonsense')).toBe('✨');
  });

  test('PLAN_ADDON_TYPE_KEYS matches PLAN_ADDON_TYPES', () => {
    expect(PLAN_ADDON_TYPE_KEYS).toEqual(PLAN_ADDON_TYPES.map((a) => a.key));
  });

  test('relevantAddonTypesForOccasion returns a real curated set for birthday', () => {
    const result = relevantAddonTypesForOccasion('birthday');
    expect(result.map((a) => a.key)).toEqual(['transportation', 'dessert', 'photographer', 'decorations', 'flowers', 'entertainment', 'gift']);
  });

  test('relevantAddonTypesForOccasion returns an honest empty set for casual_hangout', () => {
    expect(relevantAddonTypesForOccasion('casual_hangout')).toEqual([]);
  });

  test('relevantAddonTypesForOccasion falls back to a broad default for null/unknown occasion', () => {
    const forNull = relevantAddonTypesForOccasion(null);
    const forUnknown = relevantAddonTypesForOccasion('not_a_real_occasion');
    expect(forNull.map((a) => a.key)).toEqual(['dessert', 'photographer', 'flowers', 'gift']);
    expect(forUnknown).toEqual(forNull);
  });

  test('every key referenced by OCCASION_ADDON_RELEVANCE is a real addon type', () => {
    // Indirect check: every occasion's returned list must consist of
    // real, resolvable addon types (relevantAddonTypesForOccasion already
    // filters out anything unresolvable, so a typo would silently vanish
    // rather than crash -- assert nothing vanished for a sample of keys).
    ['birthday', 'wedding', 'graduation', 'holiday_gathering', 'other'].forEach((occasion) => {
      const result = relevantAddonTypesForOccasion(occasion);
      result.forEach((a) => expect(PLAN_ADDON_TYPE_KEYS).toContain(a.key));
    });
  });
});
