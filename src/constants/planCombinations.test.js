const fs = require('fs');
const path = require('path');
const { PLAN_COMBINATIONS, combinationTemplate, recognizeCombination } = require('./planCombinations');
const { CATEGORY_GROUPS } = require('./gatheringCategories');
const { assembleExperience } = require('../services/experienceAssembly');

const ALL_TAGS = new Set(Object.values(CATEGORY_GROUPS).flatMap((g) => g.tags ?? g));

describe('plan combinations table (item 64)', () => {
  it('names the owner\'s combinations', () => {
    const keys = PLAN_COMBINATIONS.map((c) => c.key);
    for (const k of ['date_night', 'family_day', 'night_out', 'weekend', 'beach_day', 'birthday', 'business_meeting']) expect(keys).toContain(k);
  });
  it('every combination assembles through an EXISTING template with real, disjoint leaf tags', () => {
    for (const c of PLAN_COMBINATIONS) {
      const t = combinationTemplate(c);
      expect(t).not.toBeNull();
      expect(t.template.components.length).toBeGreaterThanOrEqual(2);
      const seen = new Set();
      for (const comp of t.template.components) {
        for (const tag of comp.categories) {
          expect(ALL_TAGS.has(tag) ? tag : `unknown tag ${tag} in ${c.key}`).toBe(tag);
          expect(seen.has(tag) ? `${tag} repeated in ${c.key}` : tag).toBe(tag);
          seen.add(tag);
        }
      }
    }
  });
});

describe('recognizeCombination: deterministic, from the person\'s words and resolved facts', () => {
  const R = (a) => recognizeCombination(a)?.key ?? null;
  it('named outings', () => {
    expect(R({ text: 'a night out tonight', dateWindow: 'tonight' })).toBe('night_out');
    expect(R({ text: 'girls night on friday' })).toBe('night_out');
    expect(R({ text: 'fun weekend plans' })).toBe('weekend');
    expect(R({ text: 'beach day tomorrow' })).toBe('beach_day');
    expect(R({ text: 'client lunch tomorrow' })).toBe('business_meeting');
  });
  it('occasions', () => {
    expect(R({ text: 'my birthday', occasion: 'birthday' })).toBe('birthday');
    expect(R({ text: 'date night', occasion: 'date_night' })).toBe('date_night');
    expect(R({ text: 'lunch with a client', occasion: 'business_meal' })).toBe('business_meeting');
  });
  it('context and listed parts', () => {
    expect(R({ text: 'something with the kids', attributes: ['kid_friendly'], dateWindow: 'weekend' })).toBe('family_day');
    expect(R({ text: 'dinner and drinks tonight', dateWindow: 'tonight' })).toBe('night_out');
    expect(R({ text: 'lunch and a museum tomorrow', dateWindow: 'tomorrow' })).toBe('day_out');
  });
  it('a single-purpose ask is not a combination', () => {
    expect(R({ text: 'coffee' })).toBeNull();
    expect(R({ text: 'dinner' })).toBeNull();
  });
  it('a recognised combination assembles only from real supply (a part with none is dropped)', () => {
    const cands = [
      { type: 'business_availability', id: 'd', partnerId: 'p1', title: 'Dinner', category: 'Restaurants', categories: [], bundleComponents: [], matchedAvailability: {} },
      { type: 'business_availability', id: 'b', partnerId: 'p2', title: 'Bar', category: 'Bars & Lounges', categories: [], bundleComponents: [], matchedAvailability: {} },
    ];
    const exp = assembleExperience(null, cands, { dateWindow: 'tonight', intentRecipe: 'night_out' });
    expect(exp.components.map((c) => c.key)).toEqual(['food', 'drinks']);
    expect(assembleExperience(null, cands, { dateWindow: null, intentRecipe: 'night_out' })).toBeNull();
  });
  it('never uses AI or the network', () => {
    const src = fs.readFileSync(path.join(__dirname, 'planCombinations.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/fetch\(|supabase|functions\.invoke|anthropic/i);
  });
});
