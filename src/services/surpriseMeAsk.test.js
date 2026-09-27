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
  submitSurprise, shuffleSurprise, surpriseTypesForTab,
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
    expect(submit.indexOf('pickForMeKind(typedText)')).toBeLessThan(submit.indexOf('classifyCreateRequest(typedText)'));
    expect(home).toMatch(/handleSurpriseSubmit\(\{ text: typedText \}\)/);
    expect(home).toMatch(/if \(pickForMeKind\(typedText\)\)/);
    expect(home).toMatch(/A few ideas for you/);
    expect(home).toMatch(/shuffleSurprise\(surprise\)/);
  });
  it('weather is the resolver\'s own pass (no second weather logic in Surprise Me), and no time is invented', () => {
    const eng = fs.readFileSync(path.join(__dirname, 'surpriseMe.js'), 'utf8');
    expect(eng).not.toMatch(/getSocialForecast|weatherBias|askWeather/);
    expect(eng).toMatch(/const dateWindow = typed \? dateWindowFromText\(rest\) : when;/);
  });
});

// Owner contract (2026-09-26, LOCKED): broad -> variety across categories; explicit -> variety within it; AI never narrows/broadens.
describe('scope: only the words narrow, and variety follows the scope', () => {
  it('reads the scope from the words', () => {
    expect(surpriseScope('tonight')).toEqual({ level: 'broad' });
    expect(surpriseScope('for under $30')).toEqual({ level: 'broad' });
    expect(surpriseScope('with something fun this weekend')).toEqual({ level: 'broad' });
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
    expect(submit.indexOf('pickForMeKind(typedText)')).toBeLessThan(submit.indexOf('recordIntentSubmission('));
    const handler = home.slice(home.indexOf('async function handleSurpriseSubmit'), home.indexOf('function handleSurpriseDismiss'));
    expect(handler).not.toMatch(/recordIntent/);
  });
});

// Owner (2026-09-26): Discover's search box recognizes Surprise Me and runs the SAME engine as Home, inline.
describe('Discover uses the one Surprise Me engine, inline', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
  const discover = read('../screens/DiscoverHubScreen.js');
  const home = read('../screens/HomeScreen.js');

  beforeEach(() => {
    resolveIntent.mockReset();
    classifyCreateRequest.mockReset();
    classifyCreateRequest.mockResolvedValue({ dateWindow: null });
    resolveIntent.mockResolvedValue({ items: [c('a', 'Coffee', 3), c('b', 'Hiking', 2)], experience: null });
  });

  it('recognizes the owner\'s examples', () => {
    for (const t of ['surprise me', 'Surprise me tonight', 'surprise me with coffee', 'Surprise me for under $30', 'surprise me with something fun this weekend'])
      expect([t, surpriseAskFromText(t)]).toEqual([t, true]);
  });

  it('Home and Discover give the same canonical interpretation for the same words', async () => {
    for (const text of ['surprise me tonight', 'surprise me with coffee', 'Surprise me for under $30', 'surprise me with something fun this weekend']) {
      resolveIntent.mockClear();
      const fromHome = await submitSurprise({ text });
      const homeCalls = resolveIntent.mock.calls.map(([a]) => ({ ...a }));
      resolveIntent.mockClear();
      const fromDiscover = await submitSurprise({ text, types: surpriseTypesForTab('all'), openNow: false });
      const discoverCalls = resolveIntent.mock.calls.map(([a]) => ({ ...a }));
      // interests are sampled randomly for a broad ask, so compare everything except the sampled category
      const strip = (calls) => calls.map(({ category, ...rest }) => rest);
      expect(strip(discoverCalls)).toEqual(strip(homeCalls));
      expect(fromDiscover.scope).toEqual(fromHome.scope);
      expect(fromDiscover.dateWindow).toEqual(fromHome.dateWindow);
    }
  });

  it('Discover\'s own explicit choices only narrow: the type tab and the Open-now chip', async () => {
    const r = await submitSurprise({ text: 'surprise me', types: surpriseTypesForTab('gatherings'), openNow: true });
    expect(resolveIntent.mock.calls.every(([a]) => a.openNowChip === true)).toBe(true);
    expect(r.picks.every((p) => p.type === 'gathering')).toBe(true);
    resolveIntent.mockResolvedValue({ items: [c('g', 'Coffee', 3), { type: 'perk', id: 'p', category: 'Coffee', score: 9 }], experience: null });
    const perks = await submitSurprise({ text: 'surprise me with coffee', types: surpriseTypesForTab('perks') });
    expect(perks.picks.map((p) => p.id)).toEqual(['p']);
    expect(surpriseTypesForTab('all')).toBeNull();
  });

  it('a failed AI call still gives the deterministic surprise, and no time is invented', async () => {
    classifyCreateRequest.mockRejectedValue(new Error('500 no credit'));
    const r = await submitSurprise({ text: 'surprise me with coffee' });
    expect(r.picks.map((p) => p.id)).toEqual(['a']);
    expect(resolveIntent.mock.calls.every(([a]) => a.dateWindow === null)).toBe(true);
    // even if the classifier claims a time the words never said, none is used
    classifyCreateRequest.mockResolvedValue({ dateWindow: 'tonight' });
    resolveIntent.mockClear();
    const noTime = await submitSurprise({ text: 'surprise me with coffee' });
    expect(noTime.dateWindow).toBeNull();
    expect(resolveIntent.mock.calls.every(([a]) => a.dateWindow === null)).toBe(true);
  });

  it('a network/service failure never fabricates a result; Shuffle keeps the previous set', async () => {
    resolveIntent.mockRejectedValue(new Error('network'));
    const r = await submitSurprise({ text: 'surprise me tonight' });
    expect(r.suggestion).toBeNull();
    expect(r.picks).toEqual([]);
    const previous = { args: { text: 'surprise me' }, suggestion: { kind: 'candidate', candidate: c('a', 'Coffee', 1) }, picks: [c('a', 'Coffee', 1)], shown: new Set(['gathering:a']) };
    const after = await shuffleSurprise(previous);
    expect(after.picks.map((p) => p.id)).toEqual(['a']); // nothing fake, previous set kept
  });

  it('Discover routes a typed surprise before the normal search, into the shared flow, inline (no new screen or tab)', () => {
    const submit = discover.slice(discover.indexOf('async function handleUnderstandSearch'));
    expect(submit.indexOf("submitted.kind === 'pick_for_me'")).toBeLessThan(submit.indexOf('runIntentSearch(typedText'));
    expect(discover).toMatch(/submitSurprise\(\{ text: typedText, types: surpriseTypesForTab\(typeFilter\), openNow: openNowActive \}\)/);
    expect(discover).toMatch(/shuffleSurprise\(discoverSurprise\)/);
    expect(discover).toMatch(/navigateToSurprisePick\(navigation, it, discoverSurprise\)/);
    expect(discover).not.toMatch(/runSurpriseMe|navigate\(['"]Surprise|SurpriseMeScreen|setSurpriseSheet|handleSurpriseSubmit/);
    const handler = discover.slice(discover.indexOf('async function handleDiscoverSurprise'), discover.indexOf('function handleIntentSearchResultTap'));
    expect(handler).not.toMatch(/recordIntent|navigation\.navigate/);
  });

  it('"surprise me" is never a keyword search for the phrase in Discover', () => {
    expect(discover).toMatch(/const isSearching = query\.kind === 'search';/);
    expect(discover).toMatch(/const term = discoverQuery\(searchQuery\)\.literalTerm;/);
    expect(discover).toMatch(/const keyword = literalTerm;/);
  });

  it('there is exactly one Surprise Me engine', () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(path.join(dir, d.name)) : (/\.js$/.test(d.name) && !/\.test\.js$/.test(d.name) ? [path.join(dir, d.name)] : []));
    const src = path.join(__dirname, '..');
    const definers = walk(src).filter((f) => /function (runSurpriseMe|pickDiverse|surpriseAskFromText|surpriseScope)\b/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(src, f)).sort();
    expect(definers).toEqual(['services/surpriseMe.js', 'services/surpriseMeLogic.js']);
    for (const screen of [home, discover]) expect(screen).toMatch(/from '\.\.\/services\/surpriseMe'/);
  });
});

// Owner correction (2026-09-27): in Discover, Surprise Me is a FIRST-CLASS intent -- detect -> canonical engine -> inline results --
// never an ordinary keyword search with special post-processing.
describe('Discover: Surprise Me is a first-class intent (regressions)', () => {
  const { discoverQuery } = require('../utils/discoverQuery');
  const discover = fs.readFileSync(path.join(__dirname, '../screens/DiscoverHubScreen.js'), 'utf8');

  beforeEach(() => {
    resolveIntent.mockReset();
    classifyCreateRequest.mockReset();
  });

  it('1. "surprise me" is classified as its own intent, not a search', () => {
    for (const t of ['surprise me', 'Surprise me tonight', 'surprise me with coffee', 'surprise me with coffee tonight', 'surprise me with something active'])
      expect([t, discoverQuery(t)]).toEqual([t, expect.objectContaining({ kind: 'pick_for_me', pick: 'surprise', literalTerm: null })]);
    expect(discoverQuery('coffee tonight')).toEqual({ kind: 'search', text: 'coffee tonight', literalTerm: 'coffee tonight' });
    // Every Discover search path reads the one classification; the submit routes a pick before any ordinary search.
    const submit = discover.slice(discover.indexOf('async function handleUnderstandSearch'));
    expect(submit.indexOf("submitted.kind === 'pick_for_me'")).toBeLessThan(submit.indexOf('runIntentSearch('));
    expect(discover).not.toMatch(/pickForMeKind|surpriseAskFromText/); // no second, screen-local detector
  });

  it('2. the literal phrase is never searched (keyword lists, Places, or the ordinary resolver)', async () => {
    expect(discoverQuery('surprise me').literalTerm).toBeNull();
    expect(discover).toMatch(/const term = discoverQuery\(searchQuery\)\.literalTerm;/);
    expect(discover).toMatch(/const keyword = literalTerm;/);
    // backstop in the ordinary resolver: a pick-for-me text returns before any classify, search or log
    const resolver = fs.readFileSync(path.join(__dirname, 'intentResolver.js'), 'utf8');
    const body = resolver.slice(resolver.indexOf('export async function runIntentSearch'));
    const guard = body.indexOf("if (pick) return { outcome: 'pick_for_me'");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf('classifyCreateRequest('));
    expect(guard).toBeLessThan(body.indexOf('recordIntentSubmission('));
  });

  it('3. an explicit category is kept ("with coffee", "with coffee tonight", "with something active")', async () => {
    classifyCreateRequest.mockResolvedValue({});
    resolveIntent.mockResolvedValue({ items: [c('cafe', 'Coffee', 5), c('hike', 'Hiking', 9), c('pickle', 'Pickleball', 7)], experience: null });
    const coffee = await submitSurprise({ text: 'surprise me with coffee tonight', types: surpriseTypesForTab('all') });
    expect(coffee.scope).toEqual({ level: 'tags', tags: ['Coffee'] });
    expect(coffee.picks.map((p) => p.id)).toEqual(['cafe']);
    expect(coffee.dateWindow).toBe('tonight');
    const active = await submitSurprise({ text: 'surprise me with something active' });
    expect(active.scope).toEqual({ level: 'energy', energies: ['active'] });
    expect(active.picks.map((p) => p.id).sort()).toEqual(['hike', 'pickle']); // only results the energy table calls active
    expect(active.basis).toBe('Active');
  });

  it('4. an AI-only category guess never narrows a broad request', async () => {
    classifyCreateRequest.mockResolvedValue({ category: 'Coffee', cuisine: 'italian', attributes: ['quiet'], occasion: 'date_night' });
    resolveIntent.mockImplementation(async ({ category }) => ({ items: [c(`${category}-x`, category ?? 'Hiking', 5)], experience: null }));
    const r = await submitSurprise({ text: 'surprise me tonight', types: surpriseTypesForTab('all') });
    expect(r.scope).toEqual({ level: 'broad' });
    for (const [a] of resolveIntent.mock.calls) expect(a).toMatchObject({ cuisine: null, attributes: [], occasion: null });
    expect(resolveIntent.mock.calls.map(([a]) => a.category)).not.toEqual(['Coffee']);
  });

  it('5. explicit time is kept, and none is ever invented', async () => {
    classifyCreateRequest.mockResolvedValue({ dateWindow: 'weekend' }); // the classifier's claim is ignored either way
    resolveIntent.mockResolvedValue({ items: [c('a', 'Coffee', 1)], experience: null });
    expect((await submitSurprise({ text: 'surprise me tonight' })).dateWindow).toBe('tonight');
    expect((await submitSurprise({ text: 'surprise me with coffee' })).dateWindow).toBeNull();
    expect(resolveIntent.mock.calls.map(([a]) => a.dateWindow)).toEqual(expect.arrayContaining(['tonight', null]));
    expect(resolveIntent.mock.calls.map(([a]) => a.dateWindow)).not.toContain('weekend');
  });

  it('6. Discover and Home read equivalent typed requests identically', async () => {
    classifyCreateRequest.mockResolvedValue({ category: 'Bars & Lounges' });
    resolveIntent.mockResolvedValue({ items: [c('a', 'Coffee', 3), c('b', 'Pickleball', 2)], experience: null });
    for (const text of ['surprise me', 'surprise me with coffee tonight', 'surprise me with something active', "I don't know. What's good tonight?"]) {
      resolveIntent.mockClear();
      const home = await submitSurprise({ text });
      const homeCalls = resolveIntent.mock.calls.map(([a]) => a);
      resolveIntent.mockClear();
      const disc = await submitSurprise({ text: discoverQuery(text).text, types: surpriseTypesForTab('all'), openNow: false });
      const discCalls = resolveIntent.mock.calls.map(([a]) => a);
      const strip = (calls) => calls.map(({ category, ...rest }) => rest);
      expect([text, strip(discCalls)]).toEqual([text, strip(homeCalls)]);
      expect([text, disc.scope, disc.dateWindow, disc.kind]).toEqual([text, home.scope, home.dateWindow, home.kind]);
    }
  });

  it('7. Discover\'s type tab and Open-now toggle are still respected', async () => {
    classifyCreateRequest.mockResolvedValue({});
    resolveIntent.mockResolvedValue({ items: [c('g', 'Coffee', 3), { type: 'perk', id: 'p', category: 'Coffee', score: 9 }], experience: null });
    const perks = await submitSurprise({ text: 'surprise me with coffee', types: surpriseTypesForTab('perks'), openNow: true });
    expect(perks.picks.map((p) => p.id)).toEqual(['p']);
    expect(resolveIntent.mock.calls.every(([a]) => a.openNowChip === true)).toBe(true);
    expect(discover).toMatch(/submitSurprise\(\{ text: typedText, types: surpriseTypesForTab\(typeFilter\), openNow: openNowActive \}\)/);
  });
});
