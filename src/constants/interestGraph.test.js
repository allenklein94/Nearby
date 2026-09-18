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

test('becauseYouLikeCategories: behavior wins, else declared, else empty', () => {
  const { becauseYouLikeCategories } = require('./interestGraph');
  expect(becauseYouLikeCategories(['Yoga', 'Coffee'], ['Music'], [])).toEqual(['Yoga', 'Coffee']);
  expect(becauseYouLikeCategories([], ['Music', 'Hiking'], ['Food'])).toEqual(['Music', 'Hiking', 'Foodie']);
  expect(becauseYouLikeCategories([], [], null)).toEqual([]);
});

test('shouldOfferDiningPrompt: only for food interests with no tastes set and not dismissed', () => {
  const { shouldOfferDiningPrompt } = require('./interestGraph');
  expect(shouldOfferDiningPrompt({ interests: ['Coffee'], cuisinePreferences: [], venuePreferences: [] })).toBe(true);
  expect(shouldOfferDiningPrompt({ interests: ['Hiking'], cuisinePreferences: [], venuePreferences: [] })).toBe(false);
  expect(shouldOfferDiningPrompt({ interests: ['Coffee'], cuisinePreferences: ['thai'], venuePreferences: [] })).toBe(false);
  expect(shouldOfferDiningPrompt({ interests: ['Coffee'], cuisinePreferences: [], venuePreferences: ['quiet'], dismissed: false })).toBe(false);
  expect(shouldOfferDiningPrompt({ interests: ['Coffee'], dismissed: true })).toBe(false);
  expect(shouldOfferDiningPrompt({ interests: null })).toBe(false);
});

describe('ranking helpers', () => {
  const { rankByInterests, orderGroupsByInterests, personalizeQuickOptions } = require('./interestGraph');
  test('rankByInterests is stable and only reorders', () => {
    const items = [{ id: 1, interest_tag: 'Hiking' }, { id: 2, interest_tag: 'Music' }, { id: 3, interest_tag: 'Yoga' }, { id: 4, interest_tag: 'Golf' }];
    expect(rankByInterests(items, ['Music', 'Yoga']).map((x) => x.id)).toEqual([2, 3, 1, 4]);
    expect(rankByInterests(items, []).map((x) => x.id)).toEqual([1, 2, 3, 4]);
    expect(rankByInterests(items, ['Music']).length).toBe(4);
  });
  test('orderGroupsByInterests floats groups with a declared tag', () => {
    const order = orderGroupsByInterests(CATEGORY_GROUPS, ['Hiking']).map((g) => g.key);
    expect(order[0]).toBe('outdoors_nature');
    expect(order.length).toBe(CATEGORY_GROUPS.length);
  });
  test('personalizeQuickOptions ranks, adds capped extras, keeps Something Else last', () => {
    const opts = [{ label: 'Coffee', category: 'Coffee' }, { label: 'Music', category: 'Music' }, { label: 'Something Else', category: null }];
    const out = personalizeQuickOptions(opts, ['Music', 'Yoga', 'Hiking', 'Golf'], () => '•');
    expect(out.map((o) => o.label)).toEqual(['Music', 'Coffee', 'Yoga', 'Hiking', 'Something Else']);
    expect(personalizeQuickOptions(opts, [], () => '•')).toBe(opts);
  });
});
