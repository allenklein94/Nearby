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
  findConnectedPersonForPicks, SURPRISE_PICK_COUNT, surpriseScope, inSurpriseScope,
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
  it('Shuffle avoids the immediately previous set', () => {
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
      expect(a.attributes).toEqual([]); // the AI's attributes are ignored; the resolver reads them from the words
      expect(a.occasion).toBeNull();
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
    expect(home).toMatch(/runSurpriseMe\(\{ \.\.\.previous\.args, exclude: previous\.shown \}\)/);
  });
  it('weather is the resolver\'s own pass (no second weather logic in Surprise Me), and no time is invented', () => {
    const eng = fs.readFileSync(path.join(__dirname, 'surpriseMe.js'), 'utf8');
    expect(eng).not.toMatch(/getSocialForecast|weatherBias|askWeather/);
    expect(eng).toMatch(/const dateWindow = typed \? \(ask\.dateWindow \?\? null\) : when;/);
  });
});

// Owner contract (2026-09-26, LOCKED): broad -> variety across categories; explicit -> variety within it; AI never narrows/broadens.
describe('scope: only the words narrow, and variety follows the scope', () => {
  it('reads the scope from the words', () => {
    expect(surpriseScope('tonight')).toEqual({ level: 'broad' });
    expect(surpriseScope('')).toEqual({ level: 'broad' });
    expect(surpriseScope('with coffee')).toEqual({ level: 'tags', tags: ['Coffee'] });
    expect(surpriseScope('with Italian food')).toEqual({ level: 'cuisine', cuisine: 'italian' });
    expect(surpriseScope('with something to do tonight').level).toBe('groups');
    expect(surpriseScope('with something to do tonight').groups).not.toContain('food_drink');
    const two = surpriseScope('with coffee and a movie');
    expect(two.level).toBe('tags');
    expect(two.tags).toEqual(expect.arrayContaining(['Coffee', 'Movies']));
  });
  it('an explicit scope keeps only what is confirmed inside it', () => {
    expect(inSurpriseScope(c('a', 'Coffee', 1), { level: 'tags', tags: ['Coffee'] })).toBe(true);
    expect(inSurpriseScope(c('b', 'Hiking', 1), { level: 'tags', tags: ['Coffee'] })).toBe(false);
    expect(inSurpriseScope({ type: 'business_availability', id: 'x', matchedAvailability: { cuisine: 'italian' } }, { level: 'cuisine', cuisine: 'italian' })).toBe(true);
    expect(inSurpriseScope({ type: 'business_availability', id: 'y', businessPartner: { cuisine: 'thai' } }, { level: 'cuisine', cuisine: 'italian' })).toBe(false);
    expect(inSurpriseScope(c('g', 'Restaurants', 1), { level: 'cuisine', cuisine: 'italian' })).toBe(false); // no declared cuisine
    expect(inSurpriseScope(c('h', null, 1), { level: 'groups', groups: ['outdoors_nature'] })).toBe(false); // unknown is not confirmed
  });
  it('within one tag, the set spreads across businesses, never two from one', () => {
    const pool = [
      { type: 'business_availability', id: '1', partnerId: 'A', category: 'Coffee', score: 9 },
      { type: 'business_availability', id: '2', partnerId: 'A', category: 'Coffee', score: 8 },
      { type: 'business_availability', id: '3', partnerId: 'B', category: 'Coffee', score: 7 },
      { type: 'business_availability', id: '4', partnerId: 'C', category: 'Coffee', score: 6 },
    ];
    expect(pickDiverse(pool, 3, new Set(), 'scoped').map((p) => p.id)).toEqual(['1', '3', '4']);
  });
  it('within a named group, the set spreads across its tags before repeating one', () => {
    const pool = [c('h1', 'Hiking', 9), c('h2', 'Hiking', 8), c('m', 'Museums', 7), c('b', 'Bowling', 6)];
    expect(pickDiverse(pool, 3, new Set(), 'scoped').map((p) => p.id)).toEqual(['h1', 'm', 'b']);
  });
});

describe('the engine honours the scope', () => {
  beforeEach(() => {
    resolveIntent.mockReset();
    classifyCreateRequest.mockReset();
  });

  it('"surprise me with coffee" = up to 3 coffee places, not coffee + dinner + activity; the AI cannot broaden it', async () => {
    classifyCreateRequest.mockResolvedValue({ category: 'Restaurants', dateWindow: null, partyType: null });
    resolveIntent.mockResolvedValue({
      items: [
        { type: 'business_availability', id: 'c1', partnerId: 'A', category: 'Coffee', score: 9 },
        { type: 'business_availability', id: 'c2', partnerId: 'B', category: 'Coffee', score: 8 },
        { type: 'gathering', id: 'd', category: 'Restaurants', score: 20 },
        { type: 'business_availability', id: 'c3', partnerId: 'C', category: 'Coffee', score: 7 },
      ],
      experience: null,
    });
    const r = await runSurpriseMe({ text: 'surprise me with coffee' });
    expect(resolveIntent.mock.calls.map(([a]) => a.category)).toEqual(['Coffee']);
    expect(r.picks.map((p) => p.id)).toEqual(['c1', 'c2', 'c3']);
    expect(r.basis).toBe('Coffee');
  });

  it('"surprise me tonight": the AI guessing coffee does not narrow it; interests spread across categories', async () => {
    classifyCreateRequest.mockResolvedValue({ category: 'Coffee', cuisine: 'italian', attributes: ['quiet'], occasion: 'date_night', dateWindow: 'tonight', partyType: null });
    resolveIntent.mockImplementation(async ({ category }) => ({ items: [c(`${category}-1`, category ?? 'Coffee', 5)], experience: null }));
    const r = await runSurpriseMe({ text: 'surprise me tonight' });
    const calls = resolveIntent.mock.calls.map(([a]) => a);
    expect(calls.length).toBeGreaterThan(1);
    for (const a of calls) expect(a).toMatchObject({ cuisine: null, attributes: [], occasion: null });
    expect(new Set(r.picks.map((p) => p.category)).size).toBe(r.picks.length);
    expect(r.basis).toBe('Picked from your interests · tonight');
  });

  it('"surprise me with Italian food" = only businesses that declared Italian', async () => {
    classifyCreateRequest.mockResolvedValue({ category: null, dateWindow: null });
    resolveIntent.mockResolvedValue({
      items: [
        { type: 'business_availability', id: 'i1', partnerId: 'A', category: 'Restaurants', matchedAvailability: { cuisine: 'italian' }, score: 5 },
        { type: 'business_availability', id: 't1', partnerId: 'B', category: 'Restaurants', matchedAvailability: { cuisine: 'thai' }, score: 9 },
        c('hike', 'Hiking', 9),
      ],
      experience: null,
    });
    const r = await runSurpriseMe({ text: 'surprise me with Italian food' });
    expect(resolveIntent.mock.calls.map(([a]) => a.cuisine)).toEqual(['italian']);
    expect(r.picks.map((p) => p.id)).toEqual(['i1']);
    expect(r.basis).toBe('Italian');
  });

  it('"surprise me with something to do tonight" = things to do only, no food', async () => {
    classifyCreateRequest.mockResolvedValue({ dateWindow: 'tonight' });
    resolveIntent.mockResolvedValue({ items: [c('m', 'Museums', 5), c('bowl', 'Bowling', 4), c('cafe', 'Coffee', 9)], experience: null });
    const r = await runSurpriseMe({ text: 'surprise me with something to do tonight' });
    expect(r.picks.map((p) => p.id)).toEqual(['m', 'bowl']);
    expect(r.basis).toBe('Things to do · tonight');
  });

  it('"surprise me with coffee and a movie": a real assembled plan replaces the picks', async () => {
    classifyCreateRequest.mockResolvedValue({ dateWindow: 'tonight' });
    const experience = { components: [{ key: 'x', items: [c('c', 'Coffee', 1)] }, { key: 'y', items: [c('mv', 'Movies', 1)] }] };
    resolveIntent.mockResolvedValue({ items: [c('c', 'Coffee', 1), c('mv', 'Movies', 1)], experience });
    const r = await runSurpriseMe({ text: 'surprise me with coffee and a movie tonight' });
    expect(r.suggestion.kind).toBe('experience');
    expect(r.picks).toEqual([]);
  });

  it('"for a date" appears only when the words established it', async () => {
    classifyCreateRequest.mockResolvedValue({ dateWindow: null, partyType: null });
    resolveIntent.mockResolvedValue({ items: [c('r', 'Wine', 5, { attributes: ['romantic'] })], experience: null });
    const r = await runSurpriseMe({ text: 'surprise me with wine' });
    expect(r.basis).not.toMatch(/date/);
  });

  it('Shuffle Again: a fresh fetch that avoids the previous set; nothing new = exhausted, never a repeat', async () => {
    classifyCreateRequest.mockResolvedValue({ dateWindow: null });
    resolveIntent.mockResolvedValue({ items: [c('a', 'Coffee', 3), c('b', 'Hiking', 2)], experience: null });
    const first = await runSurpriseMe({ text: 'surprise me with coffee' });
    expect(first.picks.map((p) => p.id)).toEqual(['a']);
    const again = await runSurpriseMe({ text: 'surprise me with coffee', exclude: new Set(['gathering:a']) });
    expect(again.suggestion).toBeNull();
    expect(again.exhausted).toBe(true);
    expect(resolveIntent).toHaveBeenCalledTimes(2); // fresh fetch each time
  });
});

describe('typed surprises are not logged as searches', () => {
  it('the engine never writes the search log, and Home routes a surprise before any logging', () => {
    const eng = fs.readFileSync(path.join(__dirname, 'surpriseMe.js'), 'utf8');
    expect(eng).not.toMatch(/recordIntentSubmission|intent_submissions|intent_outcomes|recordIntentOutcome/);
    const home = fs.readFileSync(path.join(__dirname, '../screens/HomeScreen.js'), 'utf8');
    const submit = home.slice(home.indexOf('async function handleHomeIntentSubmit'));
    expect(submit.indexOf('surpriseAskFromText(typedText)')).toBeLessThan(submit.indexOf('recordIntentSubmission('));
    const handler = home.slice(home.indexOf('async function handleSurpriseSubmit'), home.indexOf('function handleSurpriseDismiss'));
    expect(handler).not.toMatch(/recordIntent/);
  });
});
