// Intent engine vision -- cross-category "Experiences" assembly, first
// increment (2026-09-10). Pure function, no I/O -- same testing shape as
// intentResolverScoring.test.js.
const { assembleExperience } = require('./experienceAssembly');

function businessCandidate(overrides) {
  return {
    type: 'business_availability',
    id: 'default-id',
    partnerId: 'partner-1',
    title: 'Some Business has availability',
    subtitle: null,
    category: null,
    subcategory: null,
    categories: [],
    matchedAvailability: {},
    score: 0,
    ...overrides,
  };
}

describe('assembleExperience', () => {
  it('returns null for an occasion with no defined template', () => {
    expect(assembleExperience('casual_hangout', [businessCandidate({ id: 'a', category: 'Foodie' })])).toBeNull();
    expect(assembleExperience(null, [businessCandidate({ id: 'a', category: 'Foodie' })])).toBeNull();
  });

  it('returns null when there are no candidates at all', () => {
    expect(assembleExperience('date_night', [])).toBeNull();
    expect(assembleExperience('date_night', null)).toBeNull();
  });

  it('assembles real components from genuinely matching candidates, using each candidate\'s own already-computed score to rank within a component', () => {
    const candidates = [
      businessCandidate({ id: 'dinner-1', category: 'Foodie', score: 5 }),
      businessCandidate({ id: 'dinner-2', category: 'Wine', score: 9 }),
      businessCandidate({ id: 'music-1', category: 'Music', score: 3 }),
      businessCandidate({ id: 'dessert-1', category: 'Bakeries', score: 2 }),
    ];
    const result = assembleExperience('date_night', candidates);
    expect(result.title).toBe('✨ Your Date Night');
    expect(result.occasion).toBe('date_night');
    const dinner = result.components.find((c) => c.key === 'dinner');
    expect(dinner.items.map((i) => i.id)).toEqual(['dinner-2', 'dinner-1']);
    const somethingToDo = result.components.find((c) => c.key === 'something_to_do');
    expect(somethingToDo.items.map((i) => i.id)).toEqual(['music-1']);
    const finishTheNight = result.components.find((c) => c.key === 'finish_the_night');
    expect(finishTheNight.items.map((i) => i.id)).toEqual(['dessert-1']);
    expect(result.claimedIds.sort()).toEqual(['dessert-1', 'dinner-1', 'dinner-2', 'music-1'].sort());
  });

  it('drops a component with no genuine matching inventory instead of forcing one in -- a recipe, not a rigid itinerary', () => {
    const candidates = [businessCandidate({ id: 'dinner-1', category: 'Foodie', score: 5 })];
    const result = assembleExperience('date_night', candidates);
    expect(result.components.map((c) => c.key)).toEqual(['dinner']);
  });

  it('returns null when not a single component found real matching inventory', () => {
    const candidates = [businessCandidate({ id: 'unrelated-1', category: 'Hiking', score: 5 })];
    expect(assembleExperience('date_night', candidates)).toBeNull();
  });

  it('never double-claims the same candidate across two components', () => {
    // A candidate whose own subcategory/categories happen to span two
    // components' category lists is claimed by whichever component is
    // processed first (template order), never both.
    const candidates = [
      businessCandidate({ id: 'both', category: 'Foodie', categories: ['Music'], score: 5 }),
    ];
    const result = assembleExperience('date_night', candidates);
    const allItemIds = result.components.flatMap((c) => c.items.map((i) => i.id));
    expect(allItemIds).toEqual(['both']);
    expect(result.components.find((c) => c.key === 'something_to_do')).toBeUndefined();
  });

  it('ignores non-business_availability candidate types (business_availability-only this pass)', () => {
    const candidates = [
      { type: 'gathering', id: 'g1', score: 10 },
      businessCandidate({ id: 'dinner-1', category: 'Foodie', score: 5 }),
    ];
    const result = assembleExperience('date_night', candidates);
    expect(result.components.map((c) => c.key)).toEqual(['dinner']);
  });

  it('caps each component at 3 items', () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      businessCandidate({ id: `dinner-${i}`, category: 'Foodie', score: i })
    );
    const result = assembleExperience('date_night', candidates);
    expect(result.components.find((c) => c.key === 'dinner').items.length).toBe(3);
  });
});
