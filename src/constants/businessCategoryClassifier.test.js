// "Business Profile Phase 1" addendum. Unit tests for
// businessCategoryClassifier.js's one pure function.
const { classifyBusinessCategory } = require('./businessCategoryClassifier');

describe('classifyBusinessCategory', () => {
  it('returns null when there is no real text to classify', () => {
    expect(classifyBusinessCategory({})).toBeNull();
    expect(classifyBusinessCategory()).toBeNull();
    expect(classifyBusinessCategory({ name: '', description: '' })).toBeNull();
  });

  it('returns null when no category has any real keyword match', () => {
    expect(classifyBusinessCategory({ name: 'Xyzzy Plugh', description: 'a place' })).toBeNull();
  });

  it('classifies a clear food_drink name correctly', () => {
    const result = classifyBusinessCategory({ name: 'Coastal Coffee', description: 'A relaxed coastal coffee spot.' });
    expect(result).not.toBeNull();
    expect(result.category).toBe('food_drink');
    expect(result.matchedKeywords).toContain('coffee');
  });

  it('classifies a clear fitness_wellness name correctly', () => {
    const result = classifyBusinessCategory({ name: 'Downtown Yoga Studio', description: 'A wellness space.' });
    expect(result.category).toBe('fitness_wellness');
  });

  it('classifies using description text, not just the name', () => {
    const result = classifyBusinessCategory({ name: 'The Corner Spot', description: 'A cozy neighborhood restaurant with a full bar.' });
    expect(result.category).toBe('food_drink');
  });

  it('returns null on a genuine tie between two equally-matched categories', () => {
    // "studio" alone appears in fitness_wellness, arts_entertainment, and
    // professional_services keyword lists -- a real, deliberately
    // ambiguous word with no other disambiguating keyword present.
    const result = classifyBusinessCategory({ name: 'The Studio', description: '' });
    expect(result).toBeNull();
  });

  it('breaks a tie in favor of the category with strictly more real keyword hits', () => {
    const result = classifyBusinessCategory({ name: 'The Yoga Studio', description: 'A calm gym and wellness space.' });
    expect(result.category).toBe('fitness_wellness');
  });
});
