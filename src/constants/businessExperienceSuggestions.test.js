// "Business Story" plan (CLAUDE.md), Phase 6. Unit tests for
// businessExperienceSuggestions.js's one pure function -- same "pure,
// no I/O" test convention as gatheringIndoorOutdoor.test.js/
// intentPatterns.test.js.
const { deriveSignatureExperienceSuggestions } = require('./businessExperienceSuggestions');

describe('deriveSignatureExperienceSuggestions', () => {
  it('returns an empty array when no attributes are given', () => {
    expect(deriveSignatureExperienceSuggestions({})).toEqual([]);
    expect(deriveSignatureExperienceSuggestions()).toEqual([]);
    expect(deriveSignatureExperienceSuggestions({ attributes: [] })).toEqual([]);
  });

  it('ignores attributes with no real derivation rule -- never a fallback suggestion', () => {
    const result = deriveSignatureExperienceSuggestions({ attributes: ['not_a_real_attribute'] });
    expect(result).toEqual([]);
  });

  it('derives a real suggestion for a single known attribute, price_level always unset', () => {
    const result = deriveSignatureExperienceSuggestions({ attributes: ['date_friendly'] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      attribute: 'date_friendly',
      title: 'A Date Here',
      icon: '❤️',
      attributes: ['date_friendly'],
      partyType: 'date',
      priceLevel: null,
    });
    // priority is an internal sort key only -- never leaked to the caller.
    expect(result[0].priority).toBeUndefined();
  });

  it('never sets a priceLevel, on any attribute -- no real signal exists to guess one from', () => {
    const allAttributes = ['date_friendly', 'group_friendly', 'outdoor_seating', 'live_music', 'kid_friendly', 'upscale', 'casual', 'quiet'];
    const result = deriveSignatureExperienceSuggestions({ attributes: allAttributes });
    for (const suggestion of result) {
      expect(suggestion.priceLevel).toBeNull();
    }
  });

  it('sorts by real priority and caps at 4 suggestions', () => {
    const allAttributes = ['quiet', 'casual', 'upscale', 'kid_friendly', 'live_music', 'outdoor_seating', 'group_friendly', 'date_friendly'];
    const result = deriveSignatureExperienceSuggestions({ attributes: allAttributes });
    expect(result).toHaveLength(4);
    // The 4 strongest-priority real attributes, in priority order.
    expect(result.map((s) => s.attribute)).toEqual(['date_friendly', 'group_friendly', 'outdoor_seating', 'live_music']);
  });

  it('flavors title with a real cuisine only for a food_drink business with a set cuisine, on the two eligible attributes', () => {
    const dateResult = deriveSignatureExperienceSuggestions({
      category: 'food_drink',
      attributes: ['date_friendly'],
      cuisine: 'italian',
      cuisineLabel: 'Italian',
    });
    expect(dateResult[0].title).toBe('Italian Date Night');

    const groupResult = deriveSignatureExperienceSuggestions({
      category: 'food_drink',
      attributes: ['group_friendly'],
      cuisine: 'italian',
      cuisineLabel: 'Italian',
    });
    expect(groupResult[0].title).toBe('Italian Get-Together');
  });

  it('does not cuisine-flavor an attribute outside the two eligible ones, even for a food_drink business with a real cuisine', () => {
    const result = deriveSignatureExperienceSuggestions({
      category: 'food_drink',
      attributes: ['live_music'],
      cuisine: 'italian',
      cuisineLabel: 'Italian',
    });
    expect(result[0].title).toBe('Live Music Night');
  });

  it('does not cuisine-flavor a non-food_drink business, even with a cuisine set', () => {
    const result = deriveSignatureExperienceSuggestions({
      category: 'fitness_wellness',
      attributes: ['date_friendly'],
      cuisine: 'italian',
      cuisineLabel: 'Italian',
    });
    expect(result[0].title).toBe('A Date Here');
  });

  it('does not cuisine-flavor a food_drink business with no cuisine set', () => {
    const result = deriveSignatureExperienceSuggestions({
      category: 'food_drink',
      attributes: ['date_friendly'],
      cuisine: null,
      cuisineLabel: null,
    });
    expect(result[0].title).toBe('A Date Here');
  });
});
