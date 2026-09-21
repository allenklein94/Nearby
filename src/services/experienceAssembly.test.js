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

describe('context-triggered "Make it a night" (no explicit occasion)', () => {
  const { experienceContextKey } = require('../constants/experienceTemplates');
  const dinner = businessCandidate({ id: 'd1', category: 'Foodie', score: 5 });
  const music = businessCandidate({ id: 'm1', category: 'Music', score: 4 });
  const dessert = businessCandidate({ id: 's1', category: 'Bakeries', score: 3 });
  const ctx = { partyType: 'date', dateWindow: 'tonight' };

  it('maps only planning-window asks with a real who-for signal to a context template', () => {
    expect(experienceContextKey({ partyType: 'date', dateWindow: 'tonight' })).toBe('date_night');
    expect(experienceContextKey({ partyType: 'friends', dateWindow: 'weekend' })).toBe('friends_out');
    expect(experienceContextKey({ attributes: ['kid_friendly'], dateWindow: 'today' })).toBe('family_day');
    expect(experienceContextKey({ partyType: 'date', dateWindow: 'now' })).toBeNull();
    expect(experienceContextKey({ partyType: 'date', dateWindow: 'flexible' })).toBeNull();
    expect(experienceContextKey({ partyType: 'date', dateWindow: null })).toBeNull();
    expect(experienceContextKey({ partyType: 'solo', dateWindow: 'tonight' })).toBeNull();
    expect(experienceContextKey({})).toBeNull();
  });
  it('suggests an experience from real inventory in two or more components, without claiming the flat results', () => {
    const exp = assembleExperience(null, [dinner, music, dessert], ctx);
    expect(exp.title).toBe('✨ Make it a night');
    expect(exp.suggested).toBe(true);
    expect(exp.components.map((c) => c.key)).toEqual(['dinner', 'something_to_do', 'finish_the_night']);
    expect(exp.claimedIds).toEqual([]);
    expect(exp.bundles).toEqual([]);
  });
  it('adds an optional "Stay Over" only when a real stay posting exists, and never counts alone as a night', () => {
    const hotel = businessCandidate({ id: 'h1', category: 'Hotels', score: 4 });
    const withStay = assembleExperience(null, [dinner, hotel], ctx);
    expect(withStay.components.map((c) => c.key)).toEqual(['dinner', 'stay']);
    expect(assembleExperience(null, [hotel], ctx)).toBeNull(); // one part is not an experience
    expect(assembleExperience(null, [dinner, music, dessert], ctx).components.some((c) => c.key === 'stay')).toBe(false);
  });
  it('never forces a component: a missing one is simply absent', () => {
    const exp = assembleExperience(null, [dinner, music], ctx);
    expect(exp.components.map((c) => c.key)).toEqual(['dinner', 'something_to_do']);
  });
  it('shows nothing when only one component has real inventory (that is just the flat list again)', () => {
    expect(assembleExperience(null, [dinner], ctx)).toBeNull();
    expect(assembleExperience(null, [dinner, businessCandidate({ id: 'x', category: 'Foodie' })], ctx)).toBeNull();
  });
  it('an explicit occasion with its own template still wins and behaves exactly as before', () => {
    const exp = assembleExperience('birthday', [dinner, music, dessert], ctx);
    expect(exp.suggested).toBeUndefined();
    expect(exp.title).toBe('✨ Make It a Birthday');
    expect(exp.claimedIds.length).toBeGreaterThan(0);
  });
  it('builds a friends day out and a family day from their own recipes', () => {
    const friends = assembleExperience(null, [
      businessCandidate({ id: 'a', category: 'Bowling' }), businessCandidate({ id: 'f', category: 'Foodie' }),
    ], { partyType: 'friends', dateWindow: 'weekend' });
    expect(friends.title).toBe('✨ Make it a day out');
    expect(friends.components.map((c) => c.key)).toEqual(['activity', 'food']);
    const family = assembleExperience(null, [
      businessCandidate({ id: 'h', category: 'Hiking' }), businessCandidate({ id: 'b', category: 'Brunch' }),
    ], { attributes: ['kid_friendly'], dateWindow: 'today' });
    expect(family.components.map((c) => c.key)).toEqual(['outdoor_fun', 'food']);
  });
  it('is null with no context and no occasion', () => {
    expect(assembleExperience(null, [dinner, music], null)).toBeNull();
    expect(assembleExperience(null, [dinner, music])).toBeNull();
  });
});

describe('perks as an add-on line (never a component)', () => {
  const perk = (o) => ({ type: 'perk', id: 'perk-1', partnerId: 'partner-1', targetTag: 'Foodie', title: '10% off dessert', score: 5, ...o });
  const pool = (perks) => [
    businessCandidate({ id: 'dinner-1', category: 'Foodie', score: 5 }),
    businessCandidate({ id: 'music-1', partnerId: 'partner-2', category: 'Music', score: 4 }),
    ...perks,
  ];
  const dinner = (r) => r.components.find((c) => c.key === 'dinner').items[0];

  it('attaches a targeted perk to the same business item when its tag exactly matches', () => {
    expect(dinner(assembleExperience('date_night', pool([perk()]))).perk).toEqual({ id: 'perk-1', title: '10% off dessert' });
  });
  it('never attaches an untargeted perk, a different business, or a non-matching tag', () => {
    for (const p of [perk({ targetTag: null }), perk({ partnerId: 'partner-9' }), perk({ targetTag: 'Music' })]) {
      expect(dinner(assembleExperience('date_night', pool([p]))).perk).toBeUndefined();
    }
  });
  it('never fills a component, changes order, or lets a perk-only pool form an experience', () => {
    expect(assembleExperience('date_night', [perk()])).toBeNull();
    const withPerk = assembleExperience('date_night', pool([perk({ score: 99 })]));
    const without = assembleExperience('date_night', pool([]));
    expect(withPerk.components.map((c) => c.items.map((i) => i.id))).toEqual(without.components.map((c) => c.items.map((i) => i.id)));
    expect(withPerk.claimedIds).toEqual(without.claimedIds);
  });
  it('does not mutate the flat candidate list', () => {
    const candidates = pool([perk()]);
    assembleExperience('date_night', candidates);
    expect(candidates[0].perk).toBeUndefined();
  });
});

describe('budget-aware assembled night (cheap date tonight)', () => {
  const ask = { partyType: 'date', dateWindow: 'tonight', attributes: [], priceLevel: '$', budgetMax: null };
  const night = (context, extra = []) => assembleExperience(null, [
    gatheringCandidate({ id: 'fancy', category: 'Fine Dining', priceLevel: '$$$', score: 9 }),
    gatheringCandidate({ id: 'cheap', category: 'Restaurants', priceLevel: '$', score: 1 }),
    businessCandidate({ id: 'biz', category: 'Restaurants', matchedAvailability: { price: 40 }, score: 5 }),
    gatheringCandidate({ id: 'music', category: 'Live Music', priceLevel: 'free', score: 1 }),
    ...extra,
  ], context);
  const dinner = (exp) => exp.components.find((c) => c.key === 'dinner').items.map((i) => i.id);

  it('no budget: score order unchanged', () => {
    expect(dinner(night({ ...ask, priceLevel: null }))).toEqual(['fancy', 'biz', 'cheap']);
  });
  it('fitting known price first, unknown stays, over-budget sinks but stays visible', () => {
    expect(dinner(night(ask))).toEqual(['cheap', 'biz', 'fancy']);
  });
  it('a business posting with a price but no per-person flag stays unknown', () => {
    const { budgetFit } = require('../utils/experienceBudget');
    expect(budgetFit({ id: 'biz', matchedAvailability: { price: 40 } }, ask)).toBe(1);
  });
  it('the recipe order Dinner -> Something to Do (-> Finish -> Stay) is preserved under a budget', () => {
    const exp = night(ask, [
      gatheringCandidate({ id: 'ice', category: 'Dessert & Ice Cream', priceLevel: '$' }),
      businessCandidate({ id: 'hotel', partnerId: 'p9', category: 'Hotels' }),
    ]);
    expect(exp.components.map((c) => c.key)).toEqual(['dinner', 'something_to_do', 'finish_the_night', 'stay']);
    expect(exp.suggested).toBe(true);
  });
  it('the price level survives resolver -> assembly -> rendered chip', () => {
    const fs = require('fs');
    const resolver = fs.readFileSync(require.resolve('./intentResolver.js'), 'utf8');
    expect(resolver).toMatch(/priceLevel: classifyResult\.priceLevel \?\? null, budgetMax: classifyResult\.budgetMax/);
    expect(resolver).toMatch(/priceLevel: gathering\.price_level/);
    expect(resolver).toMatch(/assembleExperience\(occasion, deduped, \{[^}]*priceLevel, budgetMax/);
    const { priceChipLabel } = require('../utils/experienceBudget');
    expect(priceChipLabel(night(ask).components[0].items[0])).toBe('$');
    expect(fs.readFileSync(require.resolve('../components/ExperienceComponentList.js'), 'utf8')).toContain('priceChipLabel(item)');
  });
});

describe('date night "Something to Do" includes active and see-something dates', () => {
  it('a bowling gathering and a museum posting can fill it; a birthday celebration is unchanged', () => {
    const cands = [
      gatheringCandidate({ id: 'bowl', category: 'Bowling' }),
      businessCandidate({ id: 'dinner', category: 'Restaurants' }),
      businessCandidate({ id: 'museum', partnerId: 'p2', category: 'Museums' }),
    ];
    const exp = assembleExperience('date_night', cands);
    expect(exp.components.find((c) => c.key === 'something_to_do').items.map((i) => i.id).sort()).toEqual(['bowl', 'museum']);
    const birthday = assembleExperience('birthday', cands);
    expect(birthday.components.map((c) => c.key)).toEqual(['dinner']);
  });
});
