// 10/10 roadmap Part 8: technical validation. Unit tests for
// gatheringIndoorOutdoor.js's pure functions.
const { CATEGORY_INDOOR_OUTDOOR, isIndoorCategory } = require('./gatheringIndoorOutdoor');

describe('isIndoorCategory', () => {
  it('returns true for a category explicitly marked indoor', () => {
    expect(isIndoorCategory('Coffee')).toBe(true);
    expect(isIndoorCategory('Museums')).toBe(true);
  });

  it('returns false for a category explicitly marked outdoor', () => {
    expect(isIndoorCategory('Hiking')).toBe(false);
  });

  it('returns false (not a guess) for a deliberately unclassified category', () => {
    expect(isIndoorCategory('Sports')).toBe(false);
    expect(isIndoorCategory('Music')).toBe(false);
  });

  it('returns false for an unknown/unset category', () => {
    expect(isIndoorCategory('NotARealTag')).toBe(false);
    expect(isIndoorCategory(null)).toBe(false);
    expect(isIndoorCategory(undefined)).toBe(false);
  });

  it('never marks the same category both indoor and outdoor', () => {
    for (const tag of Object.keys(CATEGORY_INDOOR_OUTDOOR)) {
      expect(['indoor', 'outdoor']).toContain(CATEGORY_INDOOR_OUTDOOR[tag]);
    }
  });
});
