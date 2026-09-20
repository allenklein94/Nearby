const fs = require('fs');
const path = require('path');
const { CATEGORY_GROUPS, INTEREST_OPTIONS } = require('./gatheringCategories');
const { canonicalGroupForTag, servedTags, businessServesTag } = require('./categoryMapping');

describe('canonical category mapping', () => {
  test('exact existing matches: a declared leaf tag serves exactly that tag', () => {
    expect(businessServesTag({ category: 'food_drink', subcategory: 'Coffee' }, 'Coffee')).toBe(true);
    expect(businessServesTag({ category: 'activities_recreation', categories: ['Yoga'] }, 'Yoga')).toBe(true);
    expect(businessServesTag({ category: 'x', availabilityCategories: ['Music'] }, 'Music')).toBe(true);
  });

  test('cross-taxonomy: a major-only business serves every tag of its group (food_drink -> Foodie AND Coffee)', () => {
    const biz = { category: 'food_drink' };
    expect(businessServesTag(biz, 'Foodie')).toBe(true);
    expect(businessServesTag(biz, 'Coffee')).toBe(true);
    expect(businessServesTag(biz, 'Wine')).toBe(true);
  });

  test('several gathering tags resolve to one canonical group', () => {
    expect(['Coffee', 'Foodie', 'Brunch', 'Happy Hour'].map(canonicalGroupForTag)).toEqual(Array(4).fill('food_drink'));
  });

  test('no mapping -> no match', () => {
    expect(canonicalGroupForTag('Not A Tag')).toBeNull();
    expect(businessServesTag({ category: 'food_drink' }, 'Yoga')).toBe(false);
    expect(businessServesTag({ category: 'not_a_group' }, 'Coffee')).toBe(false);
    expect(businessServesTag({ category: 'health_personal_care' }, 'Coffee')).toBe(false);
    expect(servedTags({ category: 'home_local_services' })).toEqual([]);
    expect(businessServesTag({ category: 'food_drink' }, null)).toBe(false);
  });

  test('no accidental broad or fuzzy matches', () => {
    const biz = { category: 'food_drink' };
    for (const near of ['food', 'coffee', 'Coffee Shop', 'Food & Drink', 'Cooking Class', 'Restaurants', 'food_drink']) {
      expect(businessServesTag(biz, near)).toBe(false);
    }
    // a group key is never itself a servable tag
    expect(INTEREST_OPTIONS).not.toContain('food_drink');
  });

  test('precision: a declared subcategory / secondary categories are NOT widened to the whole group', () => {
    expect(businessServesTag({ category: 'food_drink', subcategory: 'Wine' }, 'Coffee')).toBe(false);
    expect(businessServesTag({ category: 'food_drink', categories: ['Bakeries'] }, 'Foodie')).toBe(false);
    expect(businessServesTag({ category: 'food_drink', categories: ['Bakeries'] }, 'Bakeries')).toBe(true);
  });

  test('every tag belongs to exactly one group (the mapping is a function, not a relation)', () => {
    const seen = new Map();
    for (const g of CATEGORY_GROUPS) for (const t of g.tags) {
      expect(seen.has(t)).toBe(false);
      seen.set(t, g.key);
    }
  });

  test('SQL seed (category_tag_groups) is identical to CATEGORY_GROUPS', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270118_category_mapping.sql'), 'utf8');
    const body = sql.slice(sql.indexOf('insert into public.category_tag_groups'), sql.indexOf('create or replace function public.business_served_tags'));
    const seeded = [...body.matchAll(/\('((?:[^']|'')+)', '([a-z_]+)'\)/g)].map((m) => [m[1].replace(/''/g, "'"), m[2]]);
    const expected = CATEGORY_GROUPS.flatMap((g) => g.tags.map((t) => [t, g.key]));
    expect(seeded).toEqual(expected);
  });
});
