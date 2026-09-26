// Item 89 (owner, 2026-09-26): "surprise me" can be SAID, and the one Surprise Me engine returns a small, DIVERSE set built from
// time + location + interests + budget + weather + social context. The orchestrator is driven here with its network edges mocked.
jest.mock('./intentResolver', () => ({ resolveIntent: jest.fn() }));
jest.mock('./createAssistant', () => ({ classifyCreateRequest: jest.fn() }));
jest.mock('./friends', () => ({ getMyFriends: jest.fn(async () => [{ id: 'f1', display_name: 'Sam' }]) }));
jest.mock('./matchActions', () => ({ getMyMatches: jest.fn(async () => []) }));
jest.mock('./deviceCalendar', () => ({ isCalendarIntegrationEnabled: jest.fn(async () => false), getUpcomingCalendarEvents: jest.fn() }));
jest.mock('./supabase', () => {
  const profilesQuery = (rows) => ({
    select: () => ({
      eq: () => ({ single: async () => ({ data: { interests: ['Coffee', 'Hiking'] }, error: null }) }),
      in: async () => ({ data: rows, error: null }),
    }),
  });
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
      from: () => profilesQuery([{ id: 'f1', interests: ['Live Music'] }]),
    },
  };
});

const fs = require('fs');
const path = require('path');
const { resolveIntent } = require('./intentResolver');
const { classifyCreateRequest } = require('./createAssistant');
const {
  runSurpriseMe, surpriseAskFromText, stripSurprisePhrase, pickDiverse, surpriseCategories, surpriseBasis, saidCategory,
  findConnectedPersonForPicks, SURPRISE_PICK_COUNT,
} = require('./surpriseMe');

const c = (id, category, score, extra = {}) => ({ type: 'gathering', id, category, score, title: id, ...extra });

describe('saying it', () => {
  it('recognizes the person asking Nearby to choose', () => {
    for (const t of ['surprise me', 'Surprise me tonight', 'surprise us with something fun', "dealer's choice", 'you pick', 'pick something for me', "I'm feeling lucky"])
      expect([t, surpriseAskFromText(t)]).toEqual([t, true]);
  });
  it('a plan ABOUT a surprise is not this, nor a refusal', () => {
    for (const t of ['plan a surprise party', 'a surprise for my wife', "don't surprise me", 'coffee tonight', 'surprised by the weather'])
      expect([t, surpriseAskFromText(t)]).toEqual([t, false]);
  });
  it('the rest of the sentence keeps its signals', () => {
    expect(stripSurprisePhrase('Surprise me tonight under $30 with my girlfriend')).toBe('tonight under $30 with my girlfriend');
    expect(stripSurprisePhrase('surprise me!')).toBe('');
  });
  it('only the person\'s own words can narrow it to one category', () => {
    expect(saidCategory('with coffee')).toBe('Coffee');
    expect(saidCategory('tonight under $30')).toBeNull();
    expect(saidCategory('')).toBeNull();
  });
});

describe('diverse, small, real', () => {
  it('best first, then a different category group each; one business never twice', () => {
    const pool = [
      c('coffee1', 'Coffee', 9), c('coffee2', 'Coffee', 8), c('bar', 'Bars & Lounges', 7), c('hike', 'Hiking', 6),
      { type: 'business_availability', id: 'b1', partnerId: 'P', category: 'Live Music', score: 5 },
      { type: 'business_availability', id: 'b2', partnerId: 'P', category: 'Museums', score: 4 },
    ];
    const picks = pickDiverse(pool);
    expect(picks.map((p) => p.id)).toEqual(['coffee1', 'hike', 'b1']); // Coffee and Bars share Food & Drink; b2 is the same business
    expect(picks).toHaveLength(SURPRISE_PICK_COUNT);
  });
  it('fills from a used group only when there are not enough groups; never pads', () => {
    expect(pickDiverse([c('a', 'Coffee', 3), c('b', 'Coffee', 2)]).map((p) => p.id)).toEqual(['a', 'b']);
    expect(pickDiverse([])).toEqual([]);
    expect(pickDiverse([{ type: 'friend_request', id: 'x', score: 9 }])).toEqual([]); // not a surprise-eligible thing
  });
  it('Shuffle never repeats what was shown', () => {
    const pool = [c('a', 'Coffee', 3), c('b', 'Hiking', 2), c('d', 'Museums', 1)];
    expect(pickDiverse(pool, 3, new Set(['gathering:a'])).map((p) => p.id)).toEqual(['b', 'd']);
  });
  it('interests: two declared + one not yet declared; none declared = one open search', () => {
    const seq = [0.1, 0.9, 0.5, 0.3, 0.7];
    let i = 0;
    const rand = () => seq[i++ % seq.length];
    const cats = surpriseCategories(['Coffee', 'Hiking', 'Museums'], rand);
    expect(cats).toHaveLength(3);
    expect(cats.slice(0, 2).every((t) => ['Coffee', 'Hiking', 'Museums'].includes(t))).toBe(true);
    expect(['Coffee', 'Hiking', 'Museums']).not.toContain(cats[2]);
    expect(surpriseCategories([])).toEqual([null]);
    expect(surpriseCategories(['Not A Tag'])).toEqual([null]);
  });
  it('the basis line names only signals that really shaped the set', () => {
    expect(surpriseBasis({ usedInterests: true, dateWindow: 'tonight', budgetMax: 30, partyType: 'date' })).toBe('Picked from your interests · tonight · under $30 · for a date');
    expect(surpriseBasis({})).toBeNull();
  });
  it('a friend is named only through a declared-interest link, never a stranger', () => {
    const picks = [c('x', 'Coffee', 1, { title: 'Coffee meetup' }), c('y', 'Live Music', 1, { title: 'Jazz night' })];
    expect(findConnectedPersonForPicks(picks, [{ id: 'f1', name: 'Sam', interests: ['Live Music'] }])).toEqual({ id: 'f1', name: 'Sam', photo_url: undefined, forTitle: 'Jazz night' });
    expect(findConnectedPersonForPicks(picks, [{ id: 'f1', name: 'Sam', interests: ['Golf'] }])).toBeNull();
  });
});

describe('the engine: every signal reaches the one resolver', () => {
  beforeEach(() => {
    resolveIntent.mockReset();
    classifyCreateRequest.mockReset();
    resolveIntent.mockImplementation(async ({ category }) => ({
      items: [
        c(`${category}-1`, category ?? 'Coffee', 5),
        c(`${category}-2`, category ?? 'Coffee', 4),
      ],
      experience: null,
    }));
  });

  it('"surprise me tonight under $30 with my girlfriend": time, budget, party and the words go to every search; interests spread it', async () => {
    classifyCreateRequest.mockResolvedValue({ category: 'Bars & Lounges', dateWindow: 'tonight', budgetMax: 30, priceLevel: null, partyType: 'date', partySize: 2, attributes: ['date_friendly'], occasion: null, cuisine: null });
    const r = await runSurpriseMe({ text: 'Surprise me tonight under $30 with my girlfriend' });
    expect(classifyCreateRequest).toHaveBeenCalledWith('tonight under $30 with my girlfriend');
    const calls = resolveIntent.mock.calls.map(([a]) => a);
    expect(calls).toHaveLength(3); // 2 declared interests + 1 new tag, NOT the AI's single guessed category
    expect(calls.map((a) => a.category)).not.toContain('Bars & Lounges');
    for (const a of calls) {
      expect(a).toMatchObject({ dateWindow: 'tonight', budgetMax: 30, partyType: 'date', partySize: 2, rawText: 'tonight under $30 with my girlfriend' });
      expect(a.attributes).toEqual(['date_friendly']);
    }
    expect(r.picks.length).toBeGreaterThan(0);
    expect(r.picks.length).toBeLessThanOrEqual(3);
    expect(new Set(r.picks.map((p) => p.category)).size).toBe(r.picks.length); // one per category
    expect(r.basis).toBe('Picked from your interests · tonight · under $30 · for a date');
  });

  it('no time words = no time filter (never invented); a named category narrows it', async () => {
    classifyCreateRequest.mockResolvedValue({ category: 'Coffee', dateWindow: null, attributes: [], partyType: null });
    await runSurpriseMe({ text: 'surprise me with coffee' });
    const calls = resolveIntent.mock.calls.map(([a]) => a);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ category: 'Coffee', dateWindow: null });
  });

  it('just "surprise me": no classifier call, interests only', async () => {
    await runSurpriseMe({ text: 'surprise me' });
    expect(classifyCreateRequest).not.toHaveBeenCalled();
    expect(resolveIntent.mock.calls.every(([a]) => a.dateWindow === null && a.budgetMax === null && a.rawText === '')).toBe(true);
  });

  it('the sheet still works through the same engine and also returns a diverse set', async () => {
    const r = await runSurpriseMe({ when: 'today', mood: 'foodie' });
    expect(resolveIntent.mock.calls.every(([a]) => a.dateWindow === 'today')).toBe(true);
    expect(r.picks.length).toBeGreaterThan(0);
    expect(classifyCreateRequest).not.toHaveBeenCalled();
  });

  it('a classifier failure never breaks it', async () => {
    classifyCreateRequest.mockRejectedValue(new Error('429'));
    const r = await runSurpriseMe({ text: 'surprise me tonight' });
    expect(r.picks.length).toBeGreaterThan(0);
  });
});

describe('wiring', () => {
  const home = fs.readFileSync(path.join(__dirname, '../screens/HomeScreen.js'), 'utf8');
  it('Home routes a typed surprise before the normal ask, into the one engine, and renders the set', () => {
    const submit = home.slice(home.indexOf('async function handleHomeIntentSubmit'));
    expect(submit.indexOf('surpriseAskFromText(typedText)')).toBeLessThan(submit.indexOf('classifyCreateRequest(typedText)'));
    expect(home).toMatch(/handleSurpriseSubmit\(\{ text: typedText \}\)/);
    expect(home).toMatch(/A few ideas for you/);
    expect(home).toMatch(/pickDiverse\(surprise\.pool, undefined, surprise\.shown\)/);
  });
  it('weather is the resolver\'s own pass (no second weather logic in Surprise Me), and no time is invented', () => {
    const eng = fs.readFileSync(path.join(__dirname, 'surpriseMe.js'), 'utf8');
    expect(eng).not.toMatch(/getSocialForecast|weatherBias|askWeather/);
    expect(eng).toMatch(/const dateWindow = typed \? \(ask\.dateWindow \?\? null\) : when;/);
  });
});
