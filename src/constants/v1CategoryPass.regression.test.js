// Item 168 (V1 category pass, migration 20270294): the rules the pass adds that no older test covers. Customer-only categories
// (item 185) never reach a business, a business keeps at most five secondary categories (item 186), and every group-based path
// that reached the moved fitness tags before the Sports & Fitness split still reaches them (owner decision D6, structural only).
import { CATEGORY_GROUPS, isCustomerOnlyTag, subcategoryOptionsFor, businessTagOptions, toggleSecondaryCategory, MAX_SECONDARY_CATEGORIES } from './gatheringCategories';
import { servedTags } from './categoryMapping';
import { detectIntentRoute } from './intentRoutes';
import { skillContext } from './skillLevel';

describe('item 168: V1 category set', () => {
  it('has 19 groups: Sports & Fitness split out, Stay & Getaway folded into Travel & Getaways', () => {
    const keys = CATEGORY_GROUPS.map((g) => g.key);
    expect(keys).toHaveLength(19);
    expect(keys).toContain('sports_fitness');
    expect(keys).not.toContain('stay_getaway');
    expect(CATEGORY_GROUPS.find((g) => g.key === 'travel_experiences').label).toBe('Travel & Getaways');
    expect(CATEGORY_GROUPS.find((g) => g.key === 'arts_culture_learning').label).toBe('Arts, Culture & Events');
  });

  it('customer-only categories are never offered to, or served by, a business (item 185)', () => {
    const customerOnly = CATEGORY_GROUPS.flatMap((g) => g.customerOnlyTags ?? []).sort();
    expect(customerOnly).toEqual(['Couples', 'Date Night', 'Dating', 'Double Date', 'First Date', 'Group Hangouts', 'Make New Friends']);
    for (const t of customerOnly) expect(isCustomerOnlyTag(t)).toBe(true);
    expect(subcategoryOptionsFor('dating_social').some(isCustomerOnlyTag)).toBe(false);
    expect(businessTagOptions().some(isCustomerOnlyTag)).toBe(false);
    // a tagless Dating & Social business serves its group minus the customer-only tags; a declared tag still wins
    const served = servedTags({ category: 'dating_social' });
    expect(served).toContain('Speed Dating');
    expect(served.some(isCustomerOnlyTag)).toBe(false);
  });

  it('a business keeps at most five secondary categories (item 186); removing one always works', () => {
    expect(MAX_SECONDARY_CATEGORIES).toBe(5);
    let list = [];
    for (const t of ['Coffee', 'Tea', 'Brunch', 'Bakeries', 'Wine', 'Breweries']) list = toggleSecondaryCategory(list, t);
    expect(list).toEqual(['Coffee', 'Tea', 'Brunch', 'Bakeries', 'Wine']);
    expect(toggleSecondaryCategory(list, 'Tea')).toEqual(['Coffee', 'Brunch', 'Bakeries', 'Wine']);
  });

  it('D6: paths that reached gyms, yoga and tennis before the split still reach them', () => {
    expect(detectIntentRoute('I want to work out').route.groups).toEqual(expect.arrayContaining(['activities_recreation', 'sports_fitness']));
    expect(detectIntentRoute('play some tennis').route.groups).toEqual(expect.arrayContaining(['activities_recreation', 'sports_fitness']));
    expect(skillContext({ tag: 'Climbing' })).not.toBeNull();
    expect(skillContext({ tag: 'Yoga' })).not.toBeNull();
  });
});
