// Item 61 regression tests (owner decision, 2026-09-25): explicit time words only, AI-vs-rules precedence, and the
// service-failure fallback, exercised through the real classify + routing functions.
jest.mock('./supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } },
  functionUrl: (n) => `https://example.test/${n}`,
}));
const fs = require('fs');
const path = require('path');
const { classifyCreateRequest, routeClassifiedIntentToCreation } = require('./createAssistant');
const { whenPresetFromText, inferGatheringFromText } = require('../utils/gatheringInference');

function nav() {
  const calls = [];
  return { calls, navigate: (screen, params) => calls.push({ screen, params }) };
}
function mockFetch(status, body) {
  global.fetch = jest.fn(async () => ({ ok: status < 400, status, json: async () => body }));
}
afterEach(() => { delete global.fetch; });

describe('time only from explicit words', () => {
  it('"tonight" selects the existing Tonight control', () => {
    expect(whenPresetFromText('coffee tonight')).toBe('tonight');
  });
  it('"today" and "this weekend" fill no time (no control exists for them)', () => {
    expect(whenPresetFromText('coffee today')).toBeNull();
    expect(whenPresetFromText('coffee this weekend')).toBeNull();
  });
  it('"dinner with friends" does NOT infer tonight', () => {
    expect(whenPresetFromText('dinner with friends')).toBeNull();
    expect(inferGatheringFromText('dinner with friends').whenPreset).toBeNull();
  });
  it('the Tonight value stays editable on the When step (the same preset chips + picker)', () => {
    const screen = fs.readFileSync(path.join(__dirname, '../screens/CreateGatheringScreen.js'), 'utf8');
    expect(screen).toMatch(/setWhenPreset\(preset\)/); // prefill uses the chip state
    expect(screen).toMatch(/onPress=\{\(\) => pickPreset\(p\.key\)\}/); // and the host can change it
    expect(screen).toMatch(/stepKey === 'when' && \(!whenPreset \|\| scheduledAt\.getTime\(\) <= Date\.now\(\)\)/); // confirmed before moving on
  });
});

describe('Meet friends phrasing', () => {
  it.each(['coffee with some friends', 'hike with 3 friends', 'drinks with my friends'])('%s', (t) => {
    expect(inferGatheringFromText(t).activities).toContain('meet_a_friend');
  });
});

describe('AI failure -> deterministic fallback', () => {
  it.each([[503], [500]])('a %i gives a usable Create prefill', async (status) => {
    mockFetch(status, { error: 'down' });
    const result = await classifyCreateRequest('Coffee tonight with some friends');
    expect(result.deterministic).toBe(true);
    const n = nav();
    routeClassifiedIntentToCreation(n, result, 'Coffee tonight with some friends');
    expect(n.calls[0].screen).toBe('CreateGathering');
    expect(n.calls[0].params).toMatchObject({
      quickStartTitle: 'Coffee with some friends', quickStartCategory: 'Coffee', quickStartPartyType: 'friends',
      quickStartWhenPreset: 'tonight', inferredFromText: true,
    });
  });
  it('a network failure also falls back', async () => {
    global.fetch = jest.fn(async () => { throw new Error('offline'); });
    expect((await classifyCreateRequest('coffee')).deterministic).toBe(true);
  });
  it.each([[401], [429], [400]])('a %i (sign-in, daily limit, bad input) is NOT treated as a service failure', async (status) => {
    mockFetch(status, { error: 'nope' });
    await expect(classifyCreateRequest('coffee')).rejects.toThrow('nope');
  });
});

describe('AI success -> AI wins, rules fill only the gaps', () => {
  it('keeps AI title/category/headcount; adds Who and Tonight from the words', () => {
    const n = nav();
    routeClassifiedIntentToCreation(n, { intent: 'gathering', title: 'Latte meetup', category: 'Coffee', partySize: 5, dateWindow: 'weekend' }, 'coffee tonight with some friends');
    expect(n.calls[0].params).toMatchObject({
      quickStartTitle: 'Latte meetup', quickStartCategory: 'Coffee', quickStartPartySize: 5,
      quickStartPartyType: 'friends', quickStartWhenPreset: 'tonight',
    });
  });
  it('an AI dateWindow never becomes a time on its own', () => {
    const n = nav();
    routeClassifiedIntentToCreation(n, { intent: 'gathering', title: 'Dinner', category: 'Restaurants', dateWindow: 'tonight' }, 'dinner with friends');
    expect(n.calls[0].params.quickStartWhenPreset).toBeUndefined();
  });
});

describe('Create Gathering stays short', () => {
  it('asks no energy, commitment, occasion or activity question, and Who stays editable on Details', () => {
    const screen = fs.readFileSync(path.join(__dirname, '../screens/CreateGatheringScreen.js'), 'utf8');
    expect(screen).not.toMatch(/energy_?level|setEnergy|commitment|setOccasion|setActivit/i);
    expect(screen).toMatch(/onPress=\{\(\) => \{ Haptics\.selectionAsync\(\); setPartyType\(option\.key\); \}\}/);
  });
});
