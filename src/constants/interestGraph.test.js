const { ONBOARDING_INTEREST_GROUPS, tagsForGroups, canonicalizeInterests, LEGACY_MONTHLY_LABEL_TO_TAG } = require('./interestGraph');
const { CATEGORY_GROUPS, INTEREST_OPTIONS } = require('./gatheringCategories');

test('onboarding groups are canonical groups with real tags, no personal-exclusions', () => {
  expect(ONBOARDING_INTEREST_GROUPS.length).toBeGreaterThan(5);
  for (const g of ONBOARDING_INTEREST_GROUPS) {
    expect(CATEGORY_GROUPS).toContain(g);
    expect(g.tags.length).toBeGreaterThan(0);
  }
  expect(ONBOARDING_INTEREST_GROUPS.map((g) => g.key)).not.toContain('dating_social');
});

test('tagsForGroups returns only canonical tags of the chosen groups', () => {
  const tags = tagsForGroups(['food_drink']);
  expect(tags).toContain('Coffee');
  expect(tags).not.toContain('Hiking');
  expect(tagsForGroups(null)).toEqual([]);
});

test('every legacy monthly label maps to a real canonical tag', () => {
  for (const tag of Object.values(LEGACY_MONTHLY_LABEL_TO_TAG)) expect(INTEREST_OPTIONS).toContain(tag);
});

test('canonicalizeInterests maps legacy, fixes case, dedupes, drops unknown', () => {
  expect(canonicalizeInterests(['Food', 'coffee', 'Coffee', 'Beach', 'Books'])).toEqual(['Foodie', 'Coffee', 'Reading']);
  expect(canonicalizeInterests(null)).toEqual([]);
});
