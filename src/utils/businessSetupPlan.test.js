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
