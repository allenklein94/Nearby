// 10/10 roadmap Part 8: technical validation. Unit tests for
// gatheringIndoorOutdoor.js's pure functions.
const { CATEGORY_INDOOR_OUTDOOR, isIndoorCategory, isOutdoorCategory } = require('./gatheringIndoorOutdoor');

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

describe('isOutdoorCategory', () => {
  it('returns true for a category explicitly marked outdoor', () => {
    expect(isOutdoorCategory('Hiking')).toBe(true);
    expect(isOutdoorCategory('Outdoors')).toBe(true);
  });

  it('returns false for a category explicitly marked indoor', () => {
    expect(isOutdoorCategory('Coffee')).toBe(false);
  });

  it('returns false (not a guess) for a deliberately unclassified category', () => {
    expect(isOutdoorCategory('Sports')).toBe(false);
    expect(isOutdoorCategory('Music')).toBe(false);
  });

  it('returns false for an unknown/unset category', () => {
    expect(isOutdoorCategory('NotARealTag')).toBe(false);
    expect(isOutdoorCategory(null)).toBe(false);
    expect(isOutdoorCategory(undefined)).toBe(false);
  });

  it('is never true for the same category isIndoorCategory is true for', () => {
    for (const tag of Object.keys(CATEGORY_INDOOR_OUTDOOR)) {
      expect(isIndoorCategory(tag) && isOutdoorCategory(tag)).toBe(false);
    }
  });
});
