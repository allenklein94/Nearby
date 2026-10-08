import { businessPlanPrefill, createFromBusinessParams } from './businessPlanPrefill';

describe('businessPlanPrefill', () => {
  const grove = { name: 'The Grove', latitude: 26.35, longitude: -80.08, subcategory: 'Coffee', categories: ['Breakfast'] };

  test('a perk: "title at business", its tag, its description, the business place', () => {
    const offer = { title: 'Free latte', target_interest_tag: 'Live Music', description: 'Tuesdays', brand_partners: grove };
    expect(businessPlanPrefill({ offer })).toEqual({
      title: 'Free latte at The Grove', category: 'Live Music', description: 'Tuesdays',
      place: { latitude: 26.35, longitude: -80.08, name: 'The Grove' }, businessName: 'The Grove',
    });
  });

  test('a perk with its own coordinates keeps them', () => {
    const offer = { title: 'X', latitude: 1, longitude: 2, brand_partners: grove };
    expect(businessPlanPrefill({ offer }).place).toEqual({ latitude: 1, longitude: 2, name: 'The Grove' });
  });

  test('a perk with no tag falls back to the business\'s declared type (the old MakeAPlan saved NO category)', () => {
    expect(businessPlanPrefill({ offer: { title: 'X', brand_partners: grove } }).category).toBe('Coffee');
  });

  test('a business alone: empty title unless the caller had one, its declared type, no description', () => {
    expect(businessPlanPrefill({ partner: grove })).toMatchObject({ title: '', category: 'Coffee', description: null });
    expect(businessPlanPrefill({ partner: grove, title: 'Our Anniversary' }).title).toBe('Our Anniversary');
  });

  test('secondary declared types are used when there is no primary', () => {
    expect(businessPlanPrefill({ partner: { name: 'B', categories: ['Not A Tag', 'Breakfast'] } }).category).toBe('Breakfast');
  });

  test('business-only and unknown tags never become a gathering activity; nothing declared = no category', () => {
    expect(businessPlanPrefill({ partner: { name: 'Smile', subcategory: 'Dental' } }).category).toBeNull();
    expect(businessPlanPrefill({ partner: { name: 'B', subcategory: 'Made Up' } }).category).toBeNull();
    expect(businessPlanPrefill({ partner: { name: 'B' } }).category).toBeNull();
  });

  test('no coordinates = no place (never invented)', () => {
    expect(businessPlanPrefill({ partner: { name: 'B', subcategory: 'Coffee' } }).place).toBeNull();
  });

  test('nothing given = an empty prefill', () => {
    expect(businessPlanPrefill()).toEqual({ title: '', category: null, description: null, place: null, businessName: null });
  });
});

describe('createFromBusinessParams', () => {
  test('one shape for every entry', () => {
    expect(createFromBusinessParams({ offerId: 'o1' })).toEqual({ fromBusiness: { offerId: 'o1', partnerId: null, title: null } });
    expect(createFromBusinessParams({ partnerId: 'p1', title: 'T' })).toEqual({ fromBusiness: { offerId: null, partnerId: 'p1', title: 'T' } });
    expect(createFromBusinessParams({})).toBeNull();
  });
});
