const fs = require('fs');
const path = require('path');
const { BUSINESS_ATTRIBUTE_OPTIONS, ACCESSIBILITY_ATTRIBUTE_KEYS, FAMILY_ATTRIBUTE_KEYS } = require('./businessAttributes');
const { extractAttributesFromText } = require('./businessAttributeExtraction');
const { GATHERING_FEATURE_KEYS, cleanFeatures, toggleFeature, practicalFacts } = require('../utils/gatheringPractical');
const { applyDeclaredFeatures } = require('./declaredFeatures');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
const attrKeys = BUSINESS_ATTRIBUTE_OPTIONS.map((o) => o.key);

describe('accessibility + family features (items 49/50)', () => {
  it('every accessibility / family key is a real attribute in the one vocabulary', () => {
    [...ACCESSIBILITY_ATTRIBUTE_KEYS, ...FAMILY_ATTRIBUTE_KEYS].forEach((k) => expect(attrKeys).toContain(k));
    GATHERING_FEATURE_KEYS.forEach((k) => expect(attrKeys).toContain(k));
  });
  it('the gathering CHECK lists exactly the client feature keys', () => {
    const mig = read('supabase/migrations/20270198_accessibility_family_features.sql');
    const list = [...mig.match(/features <@ array\[([^\]]*)\]/)[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(list).toEqual([...GATHERING_FEATURE_KEYS].sort());
  });
  it('a business owner\'s plain text finds them, and only when actually said', () => {
    expect(extractAttributesFromText('Step-free entrance, accessible restroom and a kids menu')).toEqual(expect.arrayContaining(['wheelchair_accessible', 'accessible_restroom', 'kid_menu']));
    expect(extractAttributesFromText('Strollers welcome, high chairs available')).toEqual(expect.arrayContaining(['stroller_friendly', 'family_seating']));
    expect(extractAttributesFromText('A cozy coffee shop')).not.toEqual(expect.arrayContaining(['wheelchair_accessible', 'kid_menu', 'stroller_friendly']));
  });
  it('host features are cleaned to the closed list, shown only when declared', () => {
    expect(cleanFeatures(['quiet', 'nonsense', 'quiet'])).toEqual(['quiet']);
    expect(toggleFeature(['quiet'], 'kid_friendly')).toEqual(['quiet', 'kid_friendly']);
    expect(toggleFeature(['quiet'], 'quiet')).toEqual([]);
    expect(practicalFacts({ features: ['wheelchair_accessible'] })).toEqual(['♿ Wheelchair accessible']);
    expect(practicalFacts({})).toEqual([]);
  });
  it('ranking: a declared match lifts a gathering; undeclared is unknown, never removed', () => {
    const list = [{ features: ['kid_friendly'], score: 1 }, { features: [], score: 1 }, { score: 1 }];
    const out = applyDeclaredFeatures(list, ['kid_friendly']);
    expect(out.map((c) => c.score)).toEqual([3, 1, 1]);
    expect(out).toHaveLength(3);
    expect(applyDeclaredFeatures(list, [])).toBe(list);
  });
  it('these are business/venue declarations, never a stored personal preference', () => {
    const { VENUE_PREFERENCE_OPTIONS } = require('./businessAttributes');
    const venue = VENUE_PREFERENCE_OPTIONS.map((o) => o.key);
    ['wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly'].forEach((k) => expect(venue).not.toContain(k));
  });
});
