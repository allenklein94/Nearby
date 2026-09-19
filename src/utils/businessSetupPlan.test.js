import { buildSetupPlan } from './businessSetupPlan';
import { OFFERED_OCCASION_KEYS } from '../constants/businessAttributes';

const result = {
  category: 'food_drink', subcategory: null, cuisine: 'italian',
  attributes: ['outdoor_seating', 'date_friendly', 'group_friendly', 'live_music'],
  priorityOccasions: ['birthday'], categories: [], offeredOccasions: ['birthday', 'date_night'], partyTypes: ['groups', 'date'],
};

describe('buildSetupPlan', () => {
  it('reads the understood items back as one summary line', () => {
    const plan = buildSetupPlan({ category: 'food_drink' }, result);
    expect(plan.understood).toBe(true);
    expect(plan.summary).toContain('Italian');
    expect(plan.summary).toContain('Live Music');
  });
  it('fills an empty profile (category, cuisine, lists, occasions, party types)', () => {
    const plan = buildSetupPlan({}, result);
    expect(plan.patch.profile).toMatchObject({ category: 'food_drink', cuisine: 'italian' });
    expect(plan.patch.profile.attributes).toEqual(expect.arrayContaining(['outdoor_seating', 'live_music']));
    expect(plan.patch.offeredOccasions).toEqual(['birthday', 'date_night']);
    expect(plan.patch.partyTypes).toEqual(['groups', 'date']);
  });
  it('is additive: never removes or overwrites what the owner already set', () => {
    const partner = { category: 'entertainment_nightlife', cuisine: 'french', attributes: ['quiet'], offered_occasions: ['anniversary'], accommodates_party_types: ['solo'] };
    const plan = buildSetupPlan(partner, result);
    expect(plan.patch.profile.category).toBe('entertainment_nightlife');
    expect(plan.patch.profile.cuisine).toBe('french');
    expect(plan.patch.profile.attributes).toEqual(expect.arrayContaining(['quiet', 'outdoor_seating']));
    expect(plan.patch.offeredOccasions).toEqual(expect.arrayContaining(['anniversary', 'birthday']));
    expect(plan.patch.partyTypes).toEqual(expect.arrayContaining(['solo', 'groups']));
  });
  it('uses the subcategory only when it belongs to the final category', () => {
    expect(buildSetupPlan({}, { ...result, subcategory: 'Brunch' }).patch.profile.subcategory).toBe('Brunch');
    expect(buildSetupPlan({ category: 'shopping' }, { ...result, subcategory: 'Brunch' }).patch.profile?.subcategory ?? null).toBeNull();
  });
  it('only sets a cuisine for a food_drink business', () => {
    expect(buildSetupPlan({ category: 'shopping' }, result).patch.profile?.cuisine ?? null).toBeNull();
  });
  it('reports no changes when everything is already in the profile', () => {
    const partner = { category: 'food_drink', cuisine: 'italian', attributes: result.attributes, offered_occasions: result.offeredOccasions, accommodates_party_types: result.partyTypes };
    const plan = buildSetupPlan(partner, result);
    expect(plan.hasChanges).toBe(false);
    expect(plan.understood).toBe(true);
    expect(plan.chips.every((c) => !c.isNew)).toBe(true);
  });
  it('understands nothing from an empty answer and never invents anything', () => {
    const plan = buildSetupPlan({}, { category: null, attributes: [], cuisine: null, offeredOccasions: [], partyTypes: [], categories: [] });
    expect(plan).toMatchObject({ understood: false, hasChanges: false, summary: '' });
  });
  it('drops any occasion outside the offerable six, even if the server sent one', () => {
    const plan = buildSetupPlan({}, { ...result, offeredOccasions: ['birthday', 'baby_shower'] });
    expect(plan.patch.offeredOccasions).toEqual(['birthday']);
    plan.patch.offeredOccasions.forEach((o) => expect(OFFERED_OCCASION_KEYS).toContain(o));
  });
});

describe('Edit: owner-confirmed exclusions', () => {
  it('saves only what was left checked, while every understood chip is still shown', () => {
    const plan = buildSetupPlan({}, result, ['occ:birthday', 'attr:live_music', 'party:groups']);
    expect(plan.patch.offeredOccasions).toEqual(['date_night']);
    expect(plan.patch.profile.attributes).not.toContain('live_music');
    expect(plan.patch.partyTypes).toEqual(['date']);
    expect(plan.chips.find((c) => c.key === 'occ:birthday')).toMatchObject({ excluded: true });
    expect(plan.chips.find((c) => c.key === 'attr:outdoor_seating').excluded).toBe(false);
  });
  it('excluding the category also drops its subcategory and cuisine (they only make sense together)', () => {
    const plan = buildSetupPlan({}, { ...result, subcategory: 'Brunch' }, ['cat:food_drink']);
    expect(plan.patch.profile?.category ?? null).toBeNull();
    expect(plan.patch.profile?.subcategory ?? null).toBeNull();
    expect(plan.patch.profile?.cuisine ?? null).toBeNull();
  });
  it('excluding everything new leaves nothing to save', () => {
    const keys = buildSetupPlan({}, result).chips.map((c) => c.key);
    expect(buildSetupPlan({}, result, keys).hasChanges).toBe(false);
  });
});

// The saved values are the same fields the existing matching already reads: no new matching path.
describe('confirmed values feed existing matching', () => {
  const { occasionBonus, accommodatesPartyTypeBonus } = require('../services/intentResolverScoring');
  const { scoreBusinessOpportunity } = require('../services/businessOpportunityScoring');
  const plan = buildSetupPlan({}, result);
  const row = { offered_occasions: plan.patch.offeredOccasions, accommodates_party_types: plan.patch.partyTypes };
  it('a consumer occasion ask matches an explicitly offered occasion', () => {
    expect(occasionBonus(row, 'birthday')).toBeGreaterThan(0);
    expect(occasionBonus(row, 'graduation')).toBe(0);
  });
  it('a consumer party type matches the supported group-size capability', () => {
    expect(accommodatesPartyTypeBonus(row, 'groups')).toBeGreaterThan(0);
    expect(accommodatesPartyTypeBonus(row, 'solo')).toBe(0);
  });
  it('the business-side opportunity score credits an offered occasion', () => {
    const withOffer = scoreBusinessOpportunity({ requestOccasion: 'birthday', businessOfferedOccasions: plan.patch.offeredOccasions });
    const without = scoreBusinessOpportunity({ requestOccasion: 'birthday', businessOfferedOccasions: [] });
    expect(withOffer.score).toBeGreaterThan(without.score);
  });
});
