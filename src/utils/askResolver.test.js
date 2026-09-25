const fs = require('fs');
const path = require('path');
const { resolveAsk, toClassification, createParamsFromAsk, dateWindowFromText, priceLevelFromText, budgetMaxFromText, aiOccasionSupported } = require('./askResolver');
const { ONTOLOGY_KEYS } = require('../constants/nearbyOntology');

const SRC = path.join(__dirname, '..');

describe('one structured result, ontology-shaped', () => {
  it('the owner example resolves fully from words alone', () => {
    const r = resolveAsk('Coffee tonight with some friends');
    expect(r).toMatchObject({
      category: { key: 'food_drink', label: 'Food & Drink' }, subcategory: 'Coffee',
      group: { partyType: 'friends', partySize: null }, time: { dateWindow: 'tonight', whenPreset: 'tonight' },
      activities: ['meet_a_friend'], occasion: null, budget: { priceLevel: null, budgetMax: null }, usedAi: false,
    });
    expect(r.sources).toMatchObject({ subcategory: 'words', partyType: 'words', dateWindow: 'words' });
  });
  it('covers the ontology layers a request can carry (the rest are supply-side)', () => {
    const r = resolveAsk('x');
    for (const k of ['category', 'subcategory', 'activities', 'attributes', 'occasion', 'group', 'time', 'budget']) expect(r).toHaveProperty(k);
    expect(ONTOLOGY_KEYS).toEqual(expect.arrayContaining(['category', 'subcategory', 'activity', 'tags', 'occasion', 'group', 'time', 'budget']));
  });
  it('missing stays missing', () => {
    const r = resolveAsk('something');
    expect(r).toMatchObject({ subcategory: null, category: null, occasion: null, group: { partyType: null, partySize: null }, time: { dateWindow: null, whenPreset: null }, activities: [], plan: null });
  });
});

describe('the AI enhances, the words decide the facts', () => {
  it('drops an AI time the words do not say', () => {
    expect(resolveAsk('dinner with friends', { dateWindow: 'tonight' }).time.dateWindow).toBeNull();
    expect(resolveAsk('dinner with friends', { dateWindow: 'flexible' }).time.dateWindow).toBeNull();
  });
  it('drops an AI occasion the words do not support, keeps a supported one', () => {
    expect(resolveAsk('dinner with my wife', { occasion: 'date_night' }).occasion).toBeNull();
    expect(resolveAsk('dinner for my promotion', { occasion: 'promotion' }).occasion).toBe('promotion');
    expect(resolveAsk('dinner', { occasion: 'other' }).occasion).toBeNull();
    expect(aiOccasionSupported('not_a_key', 'birthday')).toBe(false);
  });
  it('group comes from the words, never an AI guess', () => {
    expect(resolveAsk('coffee', { partyType: 'friends' }).group.partyType).toBeNull();
    expect(resolveAsk('coffee with my parents', { partyType: 'family' }).group.partyType).toBe('family');
  });
  it('an AI headcount needs a number in the words (or a couple = 2)', () => {
    expect(resolveAsk('coffee with friends', { partySize: 6 }).group.partySize).toBeNull();
    expect(resolveAsk('coffee with six friends', { partySize: 7 }).group.partySize).toBe(7);
    expect(resolveAsk('dinner with my wife', { partySize: 2 }).group.partySize).toBe(2);
  });
  it('an AI budget needs a figure; price level only from price words', () => {
    expect(resolveAsk('dinner', { budgetMax: 50, priceLevel: '$$$' }).budget).toEqual({ priceLevel: null, budgetMax: null });
    expect(resolveAsk('cheap dinner under $30', { budgetMax: 30 }).budget).toEqual({ priceLevel: '$', budgetMax: 30 });
  });
  it('classification fields (category, cuisine, attributes, title, intent) are the AI\'s to enhance', () => {
    const r = resolveAsk('somewhere nice for pasta', { intent: 'unclear', category: 'Restaurants', cuisine: 'italian', attributes: ['upscale'], title: 'Pasta night' });
    expect(r).toMatchObject({ intent: 'unclear', subcategory: 'Restaurants', cuisine: 'italian', title: 'Pasta night' });
    expect(r.attributes).toContain('upscale');
  });
  it('with or without the AI, the same keys come back', () => {
    const a = toClassification(resolveAsk('Coffee tonight with some friends'));
    const b = toClassification(resolveAsk('Coffee tonight with some friends', { intent: 'gathering', category: 'Coffee' }));
    expect(Object.keys(a).filter((k) => k !== 'deterministic').sort()).toEqual(Object.keys(b).sort());
    expect(a).toMatchObject({ deterministic: true, category: 'Coffee', dateWindow: 'tonight' });
    expect(b.deterministic).toBeUndefined();
  });
});

describe('word rules', () => {
  it('time buckets', () => {
    expect(['right now', 'tonight', 'tomorrow', 'this weekend', 'saturday', 'today', 'friday', 'later'].map(dateWindowFromText))
      .toEqual(['now', 'tonight', 'tomorrow', 'weekend', 'weekend', 'today', null, null]);
  });
  it('budget', () => {
    expect(['free', 'cheap', 'reasonably priced', 'fancy', 'nice'].map(priceLevelFromText)).toEqual(['free', '$', '$$', '$$$', null]);
    expect(budgetMaxFromText('under $40')).toBe(40);
    expect(budgetMaxFromText('$25 max')).toBe(25);
    expect(budgetMaxFromText('40 people')).toBeNull();
  });
});

describe('every entry point uses the one resolver', () => {
  const read = (p) => fs.readFileSync(path.join(SRC, p), 'utf8');
  it('the classifier returns the resolved result, the routes prefill from it', () => {
    const ca = read('services/createAssistant.js');
    expect(ca).toMatch(/return toClassification\(resolveAsk\(text, result\)\);/);
    expect(read('screens/CreateHubScreen.js')).toMatch(/createParamsFromAsk\(result\.structured \?\? resolveAsk\(typedText, result\)/);
  });
  it('no screen builds its own Create prefill from a raw classifier reply', () => {
    for (const f of ['screens/HomeScreen.js', 'screens/DiscoverHubScreen.js', 'screens/CelebrateSomethingScreen.js', 'screens/CreateHubScreen.js', 'services/createAssistant.js']) {
      expect(read(f)).not.toMatch(/navigate\('CreateGathering', \{ quickStartTitle: result\.title/);
    }
  });
  it('the Create prefill never asks for the old questionnaire fields', () => {
    const p = createParamsFromAsk(resolveAsk('Coffee tonight with some friends'), 'x');
    expect(Object.keys(p).join()).not.toMatch(/energy|commitment|occasion|activit|attribute/i);
  });
  it('pure: no network, AI or storage', () => {
    const mod = read('utils/askResolver.js').replace(/^\s*\/\/.*$/gm, '');
    expect(mod).not.toMatch(/fetch\(|supabase|anthropic|AsyncStorage/i);
  });
});
