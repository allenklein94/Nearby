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

describe('item 65: Create asks only what a combination is missing', () => {
  const { planQuestions, planBuildInputs } = require('./planCombinations');
  const { resolveAsk } = require('../utils/askResolver');
  const { ENERGY_LEVELS } = require('./energyLevel');
  const { EXPERIENCE_PARTY_TYPE_OPTIONS } = require('./businessAttributes');
  const { WHEN_PRESETS } = require('../utils/whenPresets');
  const slots = (t) => planQuestions(resolveAsk(t)).questions.map((q) => q.slot);

  it('"Create a date night": partner is implied, asks When and What kind of night', () => {
    const q = planQuestions(resolveAsk('Create a date night'));
    expect(q.combination).toBe('date_night');
    expect(q.answered.who).toBe('date');
    expect(q.questions.map((x) => x.slot)).toEqual(['when', 'kind']);
    expect(q.questions[0].options.map((o) => o.key)).toContain('tonight');
    expect(q.questions[1].prompt).toBe('What kind of night?');
    expect(q.questions[1].options.map((o) => o.key)).toEqual(['low_key', 'romantic', 'active', 'social']);
  });
  it('never asks what the words already said', () => {
    expect(slots('a romantic date night tonight')).toEqual([]);
    expect(slots('a night out with friends tomorrow')).toEqual(['kind']);
    expect(slots('plan a beach day')).toEqual(['who', 'when', 'kind']);
    expect(slots('client lunch tomorrow')).toEqual([]);
    expect(planQuestions(resolveAsk('coffee'))).toBeNull();
  });
  it('every option comes from an existing vocabulary', () => {
    const party = new Set(EXPERIENCE_PARTY_TYPE_OPTIONS.map((o) => o.key));
    const energy = new Set(ENERGY_LEVELS.map((e) => e.key));
    for (const c of PLAN_COMBINATIONS) {
      expect(c.who.length).toBeGreaterThan(0);
      c.who.forEach((k) => expect(party.has(k) ? k : `bad party ${k}`).toBe(k));
      c.kinds.forEach((k) => expect(energy.has(k) ? k : `bad energy ${k}`).toBe(k));
      if (c.kinds.length) expect(c.kindPrompt).toBeTruthy();
    }
    expect(WHEN_PRESETS.map((p) => p.key)).toEqual(expect.arrayContaining(['tonight', 'tomorrow', 'custom']));
  });
  it('answers become the existing engine\'s inputs; no time is assumed', () => {
    expect(planBuildInputs('date_night', { when: 'tonight', kind: 'romantic' }))
      .toEqual({ occasion: 'date_night', partyType: 'date', dateWindow: 'tonight', energies: ['romantic'], intentRecipe: 'date_night' });
    expect(planBuildInputs('night_out', { who: 'friends', when: 'custom', kind: 'nonsense' }))
      .toEqual({ occasion: null, partyType: 'friends', dateWindow: null, energies: [], intentRecipe: 'night_out' });
    expect(planBuildInputs('nope')).toBeNull();
  });
  it('a picked energy reaches the resolver\'s ranking', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/intentResolver.js'), 'utf8');
    expect(src).toMatch(/whoForName = null, energies = \[\] \}/);
    expect(src).toMatch(/applyEnergyToCandidates\(deduped, \[\.\.\.new Set\(\[\.\.\.\(Array\.isArray\(energies\)/);
  });
});
