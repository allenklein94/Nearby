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
    bundleOccasion: null,
    bundleComponents: [],
    matchedAvailability: {},
    score: 0,
    ...overrides,
  };
}

function gatheringCandidate(overrides) {
  return {
    type: 'gathering',
    id: 'default-gathering-id',
    title: 'Some Gathering',
    subtitle: null,
    category: null,
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

  it('includes a genuinely matching gathering candidate in a component, same as a business_availability candidate', () => {
    const candidates = [
      gatheringCandidate({ id: 'music-gathering-1', category: 'Music', score: 10 }),
      businessCandidate({ id: 'dinner-1', category: 'Foodie', score: 5 }),
    ];
    const result = assembleExperience('date_night', candidates);
    const somethingToDo = result.components.find((c) => c.key === 'something_to_do');
    expect(somethingToDo.items.map((i) => i.id)).toEqual(['music-gathering-1']);
    expect(result.claimedIds.sort()).toEqual(['dinner-1', 'music-gathering-1'].sort());
  });

  it('still ignores candidate types not on the eligible-types list (community/perk/etc.), even one that happens to carry a matching category', () => {
    const candidates = [
      { type: 'community', id: 'c1', score: 10 },
      { type: 'perk', id: 'p1', category: 'Music', score: 10 },
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

  describe('business-side Experience Bundles', () => {
    it('surfaces a real bundle candidate covering >=2 components as its own unit, claimed whole', () => {
      const candidates = [
        businessCandidate({
          id: 'bundle-1', category: 'Foodie', score: 5,
          bundleOccasion: 'date_night', bundleComponents: ['dinner', 'something_to_do', 'finish_the_night'],
        }),
      ];
      const result = assembleExperience('date_night', candidates);
      expect(result.bundles.map((b) => b.id)).toEqual(['bundle-1']);
      expect(result.bundles[0].componentLabels).toEqual(['🍽️ Dinner', '🎵 Something to Do', '🍰 Finish the Night']);
      expect(result.components).toEqual([]);
      expect(result.claimedIds).toEqual(['bundle-1']);
    });

    it('never lets a claimed bundle also compete for a single component under its own category', () => {
      const candidates = [
        businessCandidate({
          id: 'bundle-1', category: 'Foodie', score: 5,
          bundleOccasion: 'date_night', bundleComponents: ['dinner', 'something_to_do'],
        }),
        businessCandidate({ id: 'dinner-2', category: 'Wine', score: 1 }),
      ];
      const result = assembleExperience('date_night', candidates);
      const dinner = result.components.find((c) => c.key === 'dinner');
      expect(dinner.items.map((i) => i.id)).toEqual(['dinner-2']);
    });

    it('does not treat a posting that only ticked one component as a bundle -- it competes normally for that one component instead', () => {
      const candidates = [
        businessCandidate({
          id: 'single-1', category: 'Foodie', score: 5,
          bundleOccasion: 'date_night', bundleComponents: ['dinner'],
        }),
      ];
      const result = assembleExperience('date_night', candidates);
      expect(result.bundles).toEqual([]);
      expect(result.components.find((c) => c.key === 'dinner').items.map((i) => i.id)).toEqual(['single-1']);
    });

    it('ignores a bundle declared for a different occasion than the one being assembled', () => {
      const candidates = [
        businessCandidate({
          id: 'bundle-1', category: 'Foodie', score: 5,
          bundleOccasion: 'celebration', bundleComponents: ['dinner', 'something_fun'],
        }),
      ];
      const result = assembleExperience('date_night', candidates);
      expect(result.bundles).toEqual([]);
      // Falls through to normal per-component matching on its own real category.
      expect(result.components.find((c) => c.key === 'dinner').items.map((i) => i.id)).toEqual(['bundle-1']);
    });

    it('returns a real (non-null) result from bundles alone, even with zero per-component matches', () => {
      const candidates = [
        businessCandidate({
          id: 'bundle-1', category: null, score: 5,
          bundleOccasion: 'family_gathering', bundleComponents: ['food', 'family_fun'],
        }),
      ];
      const result = assembleExperience('family_gathering', candidates);
      expect(result).not.toBeNull();
      expect(result.bundles.map((b) => b.id)).toEqual(['bundle-1']);
      expect(result.components).toEqual([]);
    });
  });
});
