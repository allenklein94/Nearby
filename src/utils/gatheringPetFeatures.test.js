// Owner item 178 decision 4: Pets welcome / Dogs welcome are host-declarable gathering features (migration 20270278).
const fs = require('fs');
const path = require('path');
const { GATHERING_FEATURE_KEYS, cleanFeatures } = require('./gatheringPractical');
const { BUSINESS_ATTRIBUTE_OPTIONS } = require('../constants/businessAttributes');
const { applyDeclaredFeatures } = require('../constants/declaredFeatures');
const { attributesFromAsk } = require('../constants/askFacets');

describe('gathering pet / dog friendly features', () => {
  it('both are gathering features and the same keys businesses declare', () => {
    expect(GATHERING_FEATURE_KEYS).toEqual(expect.arrayContaining(['pet_friendly', 'dog_friendly']));
    const biz = BUSINESS_ATTRIBUTE_OPTIONS.map((o) => o.key);
    expect(biz).toEqual(expect.arrayContaining(['pet_friendly', 'dog_friendly']));
    expect(cleanFeatures(['dog_friendly', 'cat_friendly'])).toEqual(['dog_friendly']);
  });
  it('a dog-friendly ask lifts only a gathering whose host declared it', () => {
    const asked = attributesFromAsk('a dog friendly hike this weekend');
    expect(asked).toEqual(expect.arrayContaining(['dog_friendly']));
    const [declared, dogsTag] = applyDeclaredFeatures([
      { id: 'a', type: 'gathering', score: 0, features: ['dog_friendly'] },
      { id: 'b', type: 'gathering', score: 0, interest_tag: 'Dog Parks', title: 'Dogs welcome!', features: [] },
    ], asked);
    expect(declared.score).toBeGreaterThan(0);
    expect(dogsTag.score).toBe(0); // never inferred from category or title
  });
  it('nothing in app code sets the features from a category, title or AI', () => {
    const files = ['../services/gatherings.js', '../screens/CreateGatheringScreen.js', '../screens/EditGatheringScreen.js', '../services/createAssistant.js'];
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
      expect(src).not.toMatch(/['"](pet|dog)_friendly['"]/);
    }
  });
});
