import { searchBusinessTypes } from './businessTypeSearch';
import { CATEGORY_GROUPS, subcategoryOptionsFor } from '../constants/gatheringCategories';

describe('business type search', () => {
  it('"coffee" suggests Food & Drink -> Coffee first', () => {
    const r = searchBusinessTypes('Coffee');
    expect(r[0]).toMatchObject({ category: 'food_drink', subcategory: 'Coffee', pathLabel: 'Food & Drink → Coffee' });
  });
  it('every result is a real major + a tag that belongs to it', () => {
    for (const q of ['bar', 'yoga', 'dent', 'car', 'pilates', 'hotel', 'photo']) {
      for (const r of searchBusinessTypes(q, 20)) {
        expect(CATEGORY_GROUPS.some((g) => g.key === r.category)).toBe(true);
        if (r.subcategory) expect(subcategoryOptionsFor(r.category)).toContain(r.subcategory);
      }
    }
  });
  it('business-only tags are findable here (a dentist can say so)', () => {
    expect(searchBusinessTypes('dental')[0]).toMatchObject({ category: 'health_personal_care', subcategory: 'Dental' });
  });
  it('a major can be picked by name, too short or unknown text finds nothing', () => {
    expect(searchBusinessTypes('food')[0].category).toBe('food_drink');
    expect(searchBusinessTypes('c')).toEqual([]);
    expect(searchBusinessTypes('zzzzqq')).toEqual([]);
    expect(searchBusinessTypes(null)).toEqual([]);
  });
});
