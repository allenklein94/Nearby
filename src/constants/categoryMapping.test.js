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
    expect(servedTags({ category: 'health_personal_care' })).not.toContain('Dental');
    expect(servedTags({ category: 'home_local_services' })).toContain('Plumbing');
    expect(businessServesTag({ category: 'food_drink' }, null)).toBe(false);
  });

  test('no accidental broad or fuzzy matches', () => {
    const biz = { category: 'food_drink' };
    for (const near of ['food', 'coffee', 'Coffee Shop', 'Food & Drink', 'Cooking Class', 'Restaurant', 'food_drink']) {
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

  test('SQL seed + the later tag migrations (20270177-20270187) together equal CATEGORY_GROUPS (no drift either way)', () => {
    const dir = path.join(__dirname, '../../supabase/migrations');
    const rowsOf = (file, from, to) => {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const body = sql.slice(sql.indexOf(from), to ? sql.indexOf(to) : undefined);
      return [...body.matchAll(/\('((?:[^']|'')+)', '([a-z_]+)'(?:, (?:true|false))?\)/g)].map((m) => [m[1].replace(/''/g, "'"), m[2]]);
    };
    const base = rowsOf('20270118_category_mapping.sql', 'insert into public.category_tag_groups', 'create or replace function public.business_served_tags');
    const later = [
      ...rowsOf('20270177_category_tags_broad_taxonomy.sql', 'insert into public.category_tag_groups'),
      ...rowsOf('20270178_stay_getaway_subcategories.sql', 'insert into public.category_tag_groups'),
      ...rowsOf('20270179_education_health_subcategories.sql', 'insert into public.category_tag_groups'),
      ...rowsOf('20270180_business_only_category_tags.sql', 'insert into public.category_tag_groups'),
      ...rowsOf('20270181_attractions_water_subcategories.sql', 'insert into public.category_tag_groups'),
      ...rowsOf('20270183_hobby_tags.sql', 'insert into public.category_tag_groups'),
      ...rowsOf('20270184_camera_shops_tag.sql', 'insert into public.category_tag_groups'),
      ...rowsOf('20270187_breakfast_pastries_tags.sql', 'insert into public.category_tag_groups'),
    ];
    const key = (r) => `${r[1]}::${r[0]}`;
    const expected = CATEGORY_GROUPS.flatMap((g) => [...g.tags, ...(g.businessOnlyTags ?? [])].map((t) => [t, g.key]));
    expect([...base, ...later].map(key).sort()).toEqual(expected.map(key).sort());
    // the original seed keeps its exact order within the file
    expect(base.map(key)).toEqual(expected.filter((r) => base.some((b) => key(b) === key(r))).map(key));
  });
});
