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
    // Item 187: the summary is the plan (Activity / Purpose / Time / People), never the business group.
    expect(inferredSummary(inf).map((r) => [r.label, r.value])).toEqual([
      ['Activity', 'Coffee'], ['Purpose', 'Friends'], ['Time', 'Tonight'],
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
    expect(screen).toMatch(/ui\.gatheringForm\.fromWhatYouSaid'/);
    // The When step still validates a picked, future time before moving on.
    expect(screen).toMatch(/stepKey === 'when' && \(!whenPreset/);
  });
  it('does not ask for energy, commitment, occasion, activity or attributes at creation', () => {
    const params = createParamsFromInference(null, 'Coffee tonight with some friends');
    expect(Object.keys(params).sort()).toEqual([
      'inferredFromText', 'inferredSummary', 'quickStartCategory', 'quickStartInvite', 'quickStartPartySize', 'quickStartPartyType', 'quickStartTitle', 'quickStartWhenPreset',
    ]); // quickStartInvite (item 109) is not a question about the plan: "with some friends" opens the friend picker step
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

// Owner decision (2026-09-26, item 80 follow-up, LOCKED): ONE party-size parser (partySizeFromText) serves typed discovery,
// business routing and Create Gathering's "Planning for N?"; the number is TOTAL people, the same semantics as capacity, and
// nothing downstream adds the host again. Arbitrary numbers are never a party size.
describe('party size: one shared parser, total people, no arbitrary numbers', () => {
  const { resolveAsk, createParamsFromAsk } = require('./askResolver');
  const { capacityForPartySize } = require('./gatheringStructure');
  it.each([
    ['12 guests', 12], ['dinner for 12', 12], ['party of 12', 12], ['a 20-person birthday', 20], ['table for 8', 8],
    ['group of 6', 6], ['4 people', 4], ['me and 3 friends', 4], ['for 1', 1], ['for 2', 2],
  ])('%s -> %i total people', (t, n) => expect(partySizeFromText(t)).toBe(n));
  it.each(['for 2 hours', 'for 5 PM', 'for 5pm', 'for $30', 'under $50', 'in 2 hours', 'at 5', 'at 7:30', 'for 10 minutes', 'top 5 bars', 'route 66 diner', 'for 2026'])(
    '%s is not a party size', (t) => expect(partySizeFromText(t)).toBeNull());
  it('the person\'s words beat an AI number', () => {
    expect(resolveAsk('birthday dinner for 12', { partySize: 8 }).group.partySize).toBe(12);
  });
  it('Create Gathering gets the same number and uses it as the total (never +1)', () => {
    const ask = resolveAsk('birthday dinner for 12 tonight', null);
    const params = createParamsFromAsk(ask);
    expect(params.quickStartPartySize).toBe(12);
    expect(capacityForPartySize(params.quickStartPartySize)).toEqual({ option: '10+', custom: 12, size: 12 });
    expect(capacityForPartySize(partySizeFromText('4 guests')).option).toBe('2-4');
  });
  it('there is exactly one party-size parser', () => {
    const fs = require('fs'); const path = require('path');
    const src = path.join(__dirname, '..');
    const defs = fs.readdirSync(src, { recursive: true }).filter((f) => /\.js$/.test(f) && !/test\.js$/.test(f))
      .filter((f) => /function\s+\w*[pP]artySize\w*FromText\b/.test(fs.readFileSync(path.join(src, f), 'utf8')));
    expect(defs.map((f) => f.split(path.sep).join('/'))).toEqual(['utils/gatheringInference.js']);
  });
});

describe('item 187: "From what you said" describes the plan, not the taxonomy', () => {
  const layers = (text, ai = null) => createParamsFromAsk(resolveAsk(text, ai), text).inferredSummary;

  it('never shows a category/group row, a derived "To do" row or anything outside the four', () => {
    for (const text of ['Coffee tonight with some friends', 'dinner for 4 tonight', 'pickleball tomorrow with my family', 'first date coffee']) {
      const rows = layers(text);
      expect(rows.every((r) => ['activity', 'purpose', 'time', 'people'].includes(r.layer))).toBe(true);
      expect(rows.map((r) => r.value)).not.toContain('Food & Drink');
    }
  });

  it('Activity is the canonical stored tag, unchanged', () => {
    const rows = layers('Coffee tonight with some friends');
    expect(rows.find((r) => r.layer === 'activity')).toMatchObject({ key: 'Coffee', value: 'Coffee' });
  });

  it('a date keeps Coffee as the activity; the date is only the purpose', () => {
    const rows = layers('first date coffee');
    expect(rows.find((r) => r.layer === 'activity').key).toBe('Coffee');
    expect(rows.find((r) => r.layer === 'purpose').key).toBe('date');
  });

  it('People only from a stated number', () => {
    expect(layers('coffee for 4 tonight').find((r) => r.layer === 'people')).toMatchObject({ key: 4, value: '4' });
    for (const text of ['coffee tonight', 'birthday dinner tonight', 'family outing tomorrow', 'coffee with my girlfriend']) {
      expect(layers(text).find((r) => r.layer === 'people')).toBeUndefined();
    }
  });

  it('an AI "2 for a date" is never shown as People nor suggested as capacity', () => {
    const text = 'coffee with my girlfriend tonight';
    const params = createParamsFromAsk(resolveAsk(text, { category: 'Coffee', partySize: 2 }), text);
    expect(params.inferredSummary.find((r) => r.layer === 'people')).toBeUndefined();
    expect(params.quickStartPartySize).toBeNull();
  });

  it('no Purpose row when nothing said who it is for', () => {
    expect(layers('pickleball tonight').find((r) => r.layer === 'purpose')).toBeUndefined();
  });

  it('Create labels the first-step picker Activity and renders only the four rows', () => {
    const src = read('screens/CreateGatheringScreen.js');
    expect(src).toContain("t('ui.gatheringForm.activityLabel')");
    expect(src).not.toContain("t('gatherings.categoryLabel')");
    expect(src).toContain("const SUMMARY_LAYERS = ['activity', 'purpose', 'time', 'people'];");
    expect(src).not.toMatch(/\{r\.label\}/);
  });
});
