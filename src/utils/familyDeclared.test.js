// Owner item 177 decision 3: the Family & Kids view includes declared family suitability, never inferred.
const fs = require('fs');
const path = require('path');
const { gatheringDeclaresFamily, partnerDeclaresFamily, isFamilyView, FAMILY_GROUP_KEY } = require('./familyDeclared');
const { offerInContext } = require('./cuisineFilter');
const { CATEGORY_GROUPS } = require('../constants/gatheringCategories');

describe('declared family suitability', () => {
  it('the family group key is the real Family & Kids group', () => {
    expect(CATEGORY_GROUPS.find((g) => g.key === FAMILY_GROUP_KEY)?.label).toBe('Family & Kids');
  });
  it('a museum that declared Family-friendly or an age range qualifies', () => {
    expect(partnerDeclaresFamily({ category: 'attractions_things_to_see', subcategory: 'Museums', attributes: ['kid_friendly'] })).toBe(true);
    expect(partnerDeclaresFamily({ subcategory: 'Museums', suited_age_min: 3, suited_age_max: 12 })).toBe(true);
    expect(partnerDeclaresFamily({ subcategory: 'Museums', suited_age_min: 0, suited_age_max: null })).toBe(true); // All ages
    expect(partnerDeclaresFamily({ subcategory: 'Museums', accommodates_party_types: ['family'] })).toBe(true);
  });
  it('the category alone, a name or a description never qualifies', () => {
    expect(partnerDeclaresFamily({ category: 'attractions_things_to_see', subcategory: 'Museums', attributes: ['quiet'] })).toBe(false);
    expect(partnerDeclaresFamily({ name: 'Kids Fun Zone', description: 'great for families', subcategory: 'Zoos' })).toBe(false);
    expect(partnerDeclaresFamily(null)).toBe(false);
    expect(gatheringDeclaresFamily({ interest_tag: 'Museums', title: 'Family day at the museum', features: ['quiet'] })).toBe(false);
  });
  it('a gathering qualifies only by host-declared features, ages or plan kind', () => {
    expect(gatheringDeclaresFamily({ interest_tag: 'Museums', features: ['stroller_friendly'] })).toBe(true);
    expect(gatheringDeclaresFamily({ interest_tag: 'Hiking', suited_age_max: 12 })).toBe(true);
    expect(gatheringDeclaresFamily({ interest_tag: 'Hiking', party_type: 'family' })).toBe(true);
    expect(gatheringDeclaresFamily({ interest_tag: 'Hiking', party_type: 'friends' })).toBe(false);
  });
  it('only the Family & Kids group view widens; a leaf tag view never does', () => {
    expect(isFamilyView({ categoryKey: 'family_kids' })).toBe(true);
    expect(isFamilyView({ categoryKey: null, categoryTags: ['Indoor Play'] })).toBe(false);
    expect(isFamilyView({ categoryKey: 'attractions_things_to_see' })).toBe(false);
  });
});

describe('one business record in two views', () => {
  const museum = { target_interest_tag: null, brand_partners: { category: 'attractions_things_to_see', subcategory: 'Museums', categories: ['Kids Museums'] } };
  it('a secondary category places the same perk under its group', () => {
    const family = CATEGORY_GROUPS.find((g) => g.key === 'family_kids');
    const attractions = CATEGORY_GROUPS.find((g) => g.key === 'attractions_things_to_see');
    expect(offerInContext(museum, { tags: family.tags, groupKey: family.key })).toBe(true);
    expect(offerInContext(museum, { tags: attractions.tags, groupKey: attractions.key })).toBe(true);
  });
});

describe('wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../screens/DiscoverHubScreen.js'), 'utf8');
  it('Discover widens the category view only through the helper, behind isFamilyView', () => {
    expect(src).toMatch(/isFamilyView\(expandedContext\) && gatheringDeclaresFamily\(g\)/);
    expect(src).toMatch(/isFamilyView\(expandedContext\) && partnerDeclaresFamily\(o\.brand_partners\)/);
  });
  it('the helper reads no text, name, review or AI field', () => {
    const helper = fs.readFileSync(path.join(__dirname, 'familyDeclared.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(helper).not.toMatch(/\.(title|name|description|reviews?|interest_tag|category|subcategory)\b/);
  });
  it('perks carry the declared fields the helper reads', () => {
    const svc = fs.readFileSync(path.join(__dirname, '../services/brandOffers.js'), 'utf8');
    expect(svc).toMatch(/brand_partners\([^)]*categories[^)]*suited_age_min, suited_age_max, accommodates_party_types/);
  });
});
