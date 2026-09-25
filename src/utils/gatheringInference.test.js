const fs = require('fs');
const path = require('path');
const {
  inferGatheringFromText, groupFromText, whenPresetFromText, partySizeFromText, titleFromText,
  inferredSummary,
} = require('./gatheringInference');
const { resolveAsk, toClassification, createParamsFromAsk } = require('./askResolver');
const deterministicClassification = (t) => toClassification(resolveAsk(t));
const createParamsFromInference = (_inf, t) => createParamsFromAsk(resolveAsk(t), t);
const { canSkipWhatStep, startAfterWhatStep } = require('./gatheringStructure');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('item 61: the owner example', () => {
  it('"Coffee tonight with some friends" infers category, subcategory, group, time and activity', () => {
    const inf = inferGatheringFromText('Coffee tonight with some friends');
    expect(inf).toMatchObject({
      tag: 'Coffee', categoryKey: 'food_drink', categoryLabel: 'Food & Drink',
      partyType: 'friends', whenPreset: 'tonight', activities: ['meet_a_friend'], title: 'Coffee with some friends',
    });
    expect(inferredSummary(inf).map((r) => [r.label, r.value])).toEqual([
      ['Category', 'Food & Drink'], ['What', 'Coffee'], ['Who', 'Friends'], ['When', 'Tonight'], ['To do', 'Meet friends'],
    ]);
  });
});

describe('each layer only from the person\'s own words', () => {
  it('group', () => {
    expect(groupFromText('dinner with my girlfriend')).toBe('date');
    expect(groupFromText('park day with the kids')).toBe('family');
    expect(groupFromText('drinks with coworkers')).toBe('coworkers');
    expect(groupFromText('want to meet new people')).toBe('new_people');
    expect(groupFromText('hike alone')).toBe('solo');
    expect(groupFromText('coffee')).toBeNull();
  });
  it('time is only an existing preset chip, and only when said', () => {
    expect(whenPresetFromText('yoga right now')).toBe('now');
    expect(whenPresetFromText('coffee tomorrow')).toBe('tomorrow');
    expect(whenPresetFromText('coffee this weekend')).toBeNull();
    expect(whenPresetFromText('coffee at 7')).toBeNull();
  });
  it('party size only from a stated number', () => {
    expect(partySizeFromText('hike with 3 friends')).toBe(4);
    expect(partySizeFromText('dinner for 6 people')).toBe(6);
    expect(partySizeFromText('dinner with friends')).toBeNull();
  });
  it('title is their words minus timing, never invented', () => {
    expect(titleFromText('Coffee tonight with some friends')).toBe('Coffee with some friends');
    expect(titleFromText('tonight')).toBeNull();
  });
  it('no recognised category = no title, no category, nothing to skip', () => {
    const inf = inferGatheringFromText('something with coworkers tomorrow');
    expect(inf.tag).toBeNull();
    expect(inf.title).toBeNull();
    expect(createParamsFromInference(null, 'something with coworkers tomorrow').inferredFromText).toBe(false);
  });
  it('never infers a business-only (clinical) tag for a gathering', () => {
    expect(inferGatheringFromText('dentist visit').tag).not.toBe('Dental');
  });
});

describe('merging with the AI classifier (resolveAsk)', () => {
  it('AI keeps title/category/stated size; rules fill the gaps; time never comes from the AI dateWindow', () => {
    const r = resolveAsk('coffee with some friends, five of us', { intent: 'gathering', title: 'Coffee catch-up', category: 'Coffee', partySize: 5, dateWindow: 'weekend' });
    expect(r).toMatchObject({ title: 'Coffee catch-up', subcategory: 'Coffee', group: { partyType: 'friends', partySize: 5 }, time: { dateWindow: null, whenPreset: null } });
  });
  it('an AI category that is not a real consumer tag falls back to the rules', () => {
    expect(resolveAsk('coffee', { category: 'Nonsense' }).subcategory).toBe('Coffee');
  });
});

describe('Create flow: ask only what is missing', () => {
  it('title + category known -> start after What (still reachable), When is never skipped', () => {
    const params = createParamsFromInference(null, 'Coffee tonight with some friends');
    expect(params).toMatchObject({ quickStartCategory: 'Coffee', quickStartPartyType: 'friends', quickStartWhenPreset: 'tonight', inferredFromText: true });
    expect(startAfterWhatStep(params)).toBe(true);
    expect(canSkipWhatStep(params)).toBe(false);
    const screen = read('screens/CreateGatheringScreen.js');
    expect(screen).toMatch(/startAfterWhatStep\(route\.params\) \? 1 : 0/);
    expect(screen).toMatch(/quickStartPartyType/);
    expect(screen).toMatch(/From what you said/);
    // The When step still validates a picked, future time before moving on.
    expect(screen).toMatch(/stepKey === 'when' && \(!whenPreset/);
  });
  it('does not ask for energy, commitment, occasion, activity or attributes at creation', () => {
    const params = createParamsFromInference(null, 'Coffee tonight with some friends');
    expect(Object.keys(params).sort()).toEqual([
      'inferredFromText', 'inferredSummary', 'quickStartCategory', 'quickStartPartySize', 'quickStartPartyType', 'quickStartTitle', 'quickStartWhenPreset',
    ]);
  });
});

describe('works without the AI', () => {
  it('deterministic classification', () => {
    expect(deterministicClassification('Coffee tonight with some friends')).toMatchObject({
      intent: 'gathering', category: 'Coffee', partyType: 'friends', dateWindow: 'tonight', deterministic: true,
    });
    expect(deterministicClassification('help me figure this out').intent).toBe('unclear');
  });
  it('the classifier falls back only on a service failure, never on a 4xx', () => {
    const src = read('services/createAssistant.js');
    expect(src).toMatch(/const deterministicClassification = \(text\) => toClassification\(resolveAsk\(text\)\);/);
    expect(src).toMatch(/catch \(_e\) \{\s*return deterministicClassification\(text\);/);
    expect(src).toMatch(/response\.status >= 500\) return deterministicClassification\(text\)/);
    expect(src).not.toMatch(/status >= 400\) return deterministic/);
  });
  it('the module never calls a network or AI service', () => {
    const src = read('utils/gatheringInference.js').replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/fetch\(|supabase|anthropic/i);
  });
});
