// ONE Surprise Me (owner items 89/90, merged and LOCKED 2026-09-27). "surprise me", "I don't know what I want", "what's good tonight"
// and the Home sheet are one intent with one result model: up to 3 labeled rows (Best Pick, With Friends, Something Active,
// Something Easy), each shown only when a real result backs its label. Explicit words decide the scope; the AI can neither narrow
// nor broaden; time is never invented; Home and Discover interpret the same words identically; nothing is logged.
// The orchestrator is driven here with its network edges mocked.
jest.mock('./intentResolver', () => ({ resolveIntent: jest.fn(), navigateToIntentResultItem: jest.fn() }));
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
  submitSurprise, shuffleSurprise, surpriseTypesForTab, runSurpriseMe, surpriseAskFromText, stripSurprisePhrase,
  surpriseCategories, surpriseBasis, saidCategory, findConnectedPersonForPicks, SURPRISE_PICK_COUNT, surpriseScope,
  inSurpriseScope, pickLanes, pickForMeKind,
} = require('./surpriseMe');
const { discoverQuery } = require('../utils/discoverQuery');

const c = (id, category, score, extra = {}) => ({ type: 'gathering', id, category, score, title: id, ...extra });
const biz = (id, partnerId, category, score, extra = {}) => ({ type: 'business_availability', id, partnerId, category, score, title: id, ...extra });
const ids = (r) => r.lanes.flatMap((l) => l.items.map((i) => i.id));
const rows = (r) => r.lanes.map((l) => [l.key, l.items.map((i) => i.id)]);
const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

// A pool with one clear candidate per row: a friends trivia night (host-declared), pickleball (active), coffee (easy), a nightclub.
const MIXED = [
  c('club', 'Nightclubs', 10),
  c('trivia', 'Trivia', 9, { partyType: 'friends' }),
  c('pickle', 'Pickleball', 8),
  c('coffee', 'Coffee', 7),
];

beforeEach(() => {
  resolveIntent.mockReset();
  classifyCreateRequest.mockReset();
  classifyCreateRequest.mockResolvedValue({});
  resolveIntent.mockResolvedValue({ items: MIXED, experience: null });
});

describe('saying it', () => {
  it('recognizes the person asking Nearby to choose, and the undecided ask, as ONE intent', () => {
    for (const t of ['surprise me', 'Surprise me tonight', 'surprise us with something fun', "dealer's choice", 'you pick', "I'm feeling lucky"])
      expect([t, pickForMeKind(t)]).toEqual([t, 'surprise']);
    for (const t of ["I don't know what I want", "what's good tonight"]) expect([t, pickForMeKind(t)]).toEqual([t, 'undecided']);
  });
  it('a plan ABOUT a surprise is not this, nor a refusal', () => {
    for (const t of ['plan a surprise party', 'a surprise for my wife', "don't surprise me", 'coffee tonight', 'surprised by the weather'])
      expect([t, surpriseAskFromText(t)]).toEqual([t, false]);
  });
  it('the rest of the sentence keeps its signals', () => {
    expect(stripSurprisePhrase('Surprise me tonight under $30 with my girlfriend')).toBe('tonight under $30 with my girlfriend');
    expect(stripSurprisePhrase('surprise me!')).toBe('');
  });
});

describe('scope: only the words narrow it', () => {
  it('reads the scope from the words', () => {
    expect(surpriseScope('tonight')).toEqual({ level: 'broad' });
    expect(surpriseScope('')).toEqual({ level: 'broad' });
    expect(surpriseScope('for under $30')).toEqual({ level: 'broad' });
    expect(surpriseScope('with something fun this weekend')).toEqual({ level: 'broad' });
    expect(surpriseScope('with coffee')).toEqual({ level: 'tags', tags: ['Coffee'] });
    expect(surpriseScope('with coffee tonight')).toEqual({ level: 'tags', tags: ['Coffee'] });
    expect(surpriseScope('with Italian food')).toEqual({ level: 'cuisine', cuisine: 'italian' });
    expect(surpriseScope('with something active')).toEqual({ level: 'energy', energies: ['active'] });
    expect(surpriseScope('with something to do tonight').groups).not.toContain('food_drink');
    expect(surpriseScope('with coffee and a movie').tags).toEqual(expect.arrayContaining(['Coffee', 'Movies']));
    expect(saidCategory('with coffee')).toBe('Coffee');
  });
  it('an explicit scope keeps only what is confirmed inside it', () => {
    expect(inSurpriseScope(c('a', 'Coffee', 1), { level: 'tags', tags: ['Coffee'] })).toBe(true);
    expect(inSurpriseScope(c('b', 'Hiking', 1), { level: 'tags', tags: ['Coffee'] })).toBe(false);
    expect(inSurpriseScope(biz('x', 'A', 'Restaurants', 1, { matchedAvailability: { cuisine: 'italian' } }), { level: 'cuisine', cuisine: 'italian' })).toBe(true);
    expect(inSurpriseScope(c('g', 'Restaurants', 1), { level: 'cuisine', cuisine: 'italian' })).toBe(false); // no declared cuisine
    expect(inSurpriseScope(c('p', 'Pickleball', 1), { level: 'energy', energies: ['active'] })).toBe(true);
    expect(inSurpriseScope(c('k', 'Coffee', 1), { level: 'energy', energies: ['active'] })).toBe(false);
    expect(inSurpriseScope(c('h', null, 1), { level: 'groups', groups: ['outdoors_nature'] })).toBe(false); // unknown is not confirmed
  });
});

describe('the one result model: up to 3 labeled rows', () => {
  it('broad "surprise me" uses the labeled rows, capped at 3', async () => {
    const r = await submitSurprise({ text: 'surprise me' });
    expect(r.suggestion).toEqual({ kind: 'lanes' });
    expect(r.lanes.length).toBeLessThanOrEqual(SURPRISE_PICK_COUNT);
    expect(r.lanes.map((l) => l.label)).toEqual(['Best Pick', 'With Friends', 'Something Active']);
    expect(r.header).toBe('Near you');
    expect(r).not.toHaveProperty('picks'); // no second, anonymous-picks presentation
  });

  it('fewer than 3 real rows is a valid answer; no row is manufactured', () => {
    expect(pickLanes([c('m', 'Museums', 5), c('n', 'Nightclubs', 4)]).map((l) => l.key)).toEqual(['best']); // neither fits another row
    expect(pickLanes([c('m', 'Museums', 5), c('k', 'Coffee', 4)]).map((l) => l.key)).toEqual(['best', 'easy']);
    expect(pickLanes([])).toEqual([]);
  });

  it('no item or business appears in more than one row', () => {
    const pool = [
      biz('b1', 'P', 'Coffee', 9, { businessPartner: { attributes: ['group_friendly'] } }),
      biz('b2', 'P', 'Pickleball', 8),
      biz('b3', 'P', 'Coffee', 7),
      c('pickle', 'Pickleball', 6),
    ];
    const lanes = pickLanes(pool);
    const all = lanes.flatMap((l) => l.items);
    expect(new Set(all.map((i) => `${i.type}:${i.id}`)).size).toBe(all.length);
    expect(all.filter((i) => i.partnerId === 'P')).toHaveLength(1);
    expect(rows({ lanes })).toEqual([['best', ['b1']], ['active', ['pickle']]]);
  });

  it('With Friends only from a declared friends/group signal; never inferred', () => {
    expect(pickLanes([c('a', 'Trivia', 9), c('b', 'Trivia', 8)]).map((l) => l.key)).not.toContain('friends');
    expect(pickLanes([c('a', 'Museums', 9), c('b', 'Trivia', 8, { partyType: 'groups' })]).map((l) => l.key)).toContain('friends');
  });

  it('Best Pick is a real two-part plan from two different businesses when one exists', () => {
    const experience = { components: [
      { key: 'food', label: '🍽️ Dinner', items: [biz('d', 'A', 'Restaurants', 5)] },
      { key: 'entertainment', label: '🎵 Entertainment', items: [c('m', 'Live Music', 4)] },
    ] };
    const lanes = pickLanes([c('m', 'Live Music', 4), c('p', 'Pickleball', 3)], { experience });
    expect(lanes[0]).toMatchObject({ key: 'best', plan: 'Dinner + Entertainment' });
    expect(lanes[0].items.map((i) => i.id)).toEqual(['d', 'm']);
    const oneBusiness = { components: [
      { key: 'food', label: '🍽️ Dinner', items: [biz('d', 'A', 'Restaurants', 5)] },
      { key: 'drinks', label: '🍸 Drinks', items: [biz('e', 'A', 'Bars & Lounges', 4)] },
    ] };
    expect(pickLanes([], { experience: oneBusiness })[0]?.plan ?? null).toBeNull(); // same business twice is not a plan
  });

  it('variety underneath: rows prefer different kinds of things', () => {
    const pool = [c('k1', 'Coffee', 9), c('k2', 'Coffee', 8, { partyType: 'friends' }), c('t', 'Trivia', 7, { partyType: 'friends' })];
    // With Friends takes the trivia night over a second coffee; the second coffee fills Easy only because nothing else fits it.
    expect(rows({ lanes: pickLanes(pool) })).toEqual([['best', ['k1']], ['friends', ['t']], ['easy', ['k2']]]);
  });
});

describe('explicit words control; the AI never narrows', () => {
  it('"surprise me with coffee tonight": coffee only, tonight kept; a row that makes no sense for coffee is omitted', async () => {
    classifyCreateRequest.mockResolvedValue({ category: 'Restaurants' });
    resolveIntent.mockResolvedValue({ items: [...MIXED, biz('cafe2', 'B', 'Coffee', 6)], experience: null });
    const r = await submitSurprise({ text: 'surprise me with coffee tonight' });
    expect(resolveIntent.mock.calls.map(([a]) => a.category)).toEqual(['Coffee']);
    expect(ids(r).every((id) => ['coffee', 'cafe2'].includes(id))).toBe(true);
    expect(r.lanes.map((l) => l.key)).not.toContain('active');
    expect(r.dateWindow).toBe('tonight');
    expect(r.header).toBe('Tonight near you');
    expect(r.basis).toBe('Coffee');
  });

  it('"surprise me with something active": only results the energy vocabulary calls active', async () => {
    resolveIntent.mockResolvedValue({ items: [...MIXED, c('hike', 'Hiking', 5)], experience: null });
    const r = await submitSurprise({ text: 'surprise me with something active' });
    expect(r.scope).toEqual({ level: 'energy', energies: ['active'] });
    expect(ids(r).sort()).toEqual(['hike', 'pickle']);
    expect(r.basis).toBe('Active');
  });

  it('"surprise me with Italian food": only businesses that declared Italian', async () => {
    resolveIntent.mockResolvedValue({
      items: [biz('i1', 'A', 'Restaurants', 5, { matchedAvailability: { cuisine: 'italian' } }), biz('t1', 'B', 'Restaurants', 9, { matchedAvailability: { cuisine: 'thai' } }), c('hike', 'Hiking', 9)],
      experience: null,
    });
    const r = await submitSurprise({ text: 'surprise me with Italian food' });
    expect(ids(r)).toEqual(['i1']);
  });

  it('broad "surprise me tonight": an AI category guess never narrows it; no AI cuisine/attributes/occasion', async () => {
    classifyCreateRequest.mockResolvedValue({ category: 'Coffee', cuisine: 'italian', attributes: ['quiet'], occasion: 'date_night', dateWindow: 'weekend' });
    const r = await submitSurprise({ text: 'surprise me tonight' });
    expect(r.scope).toEqual({ level: 'broad' });
    const calls = resolveIntent.mock.calls.map(([a]) => a);
    expect(calls.map((a) => a.category)).toContain(null); // one open search: no category forced
    for (const a of calls) expect(a).toMatchObject({ cuisine: null, attributes: [], occasion: null, dateWindow: 'tonight' });
    expect(calls.find((a) => a.category == null).openEnded).toBe(true);
    expect(r.lanes.map((l) => l.key)).toEqual(['best', 'friends', 'active']);
  });

  it('no time words = no time, even when the classifier claims one', async () => {
    classifyCreateRequest.mockResolvedValue({ dateWindow: 'tonight' });
    const r = await submitSurprise({ text: 'surprise me with coffee' });
    expect(r.dateWindow).toBeNull();
    expect(resolveIntent.mock.calls.every(([a]) => a.dateWindow === null)).toBe(true);
    expect(r.header).toBe('Near you');
  });

  it('budget and who-with come from the words; "for a date" only when said', async () => {
    classifyCreateRequest.mockResolvedValue({ budgetMax: 30, partyType: 'date', partySize: 2 });
    const r = await submitSurprise({ text: 'Surprise me tonight under $30 with my girlfriend' });
    expect(classifyCreateRequest).toHaveBeenCalledWith('tonight under $30 with my girlfriend');
    for (const [a] of resolveIntent.mock.calls) expect(a).toMatchObject({ budgetMax: 30, partyType: 'date', partySize: 2, rawText: 'tonight under $30 with my girlfriend' });
    expect(r.basis).toBe('Picked from your interests · under $30 · for a date');
    classifyCreateRequest.mockResolvedValue({});
    expect((await submitSurprise({ text: 'surprise me with wine' })).basis ?? '').not.toMatch(/date/);
  });

  it('interests spread a broad set: two declared + one new tag + one open search', () => {
    const seq = [0.1, 0.9, 0.5, 0.3, 0.7];
    let i = 0;
    const cats = surpriseCategories(['Coffee', 'Hiking', 'Museums'], () => seq[i++ % seq.length]);
    expect(cats).toHaveLength(3);
    expect(['Coffee', 'Hiking', 'Museums']).not.toContain(cats[2]);
    expect(surpriseCategories([])).toEqual([null]);
    expect(surpriseBasis({})).toBeNull();
  });
});

describe('the Home sheet uses the same result model', () => {
  it('chips in, labeled rows out', async () => {
    const r = await runSurpriseMe({ when: 'today', mood: 'foodie' });
    expect(resolveIntent.mock.calls.every(([a]) => a.dateWindow === 'today')).toBe(true);
    expect(r.suggestion).toEqual({ kind: 'lanes' });
    expect(r.header).toBe('Today near you');
    expect(classifyCreateRequest).not.toHaveBeenCalled();
  });
});

describe('Shuffle Again and failures', () => {
  it('a fresh fetch that avoids the immediately previous set', async () => {
    resolveIntent.mockResolvedValue({ items: [...MIXED, c('run', 'Running', 6), c('bakery', 'Bakeries', 5)], experience: null });
    const first = await submitSurprise({ text: 'surprise me' });
    const again = await shuffleSurprise(first);
    expect(resolveIntent.mock.calls.length).toBeGreaterThan(4); // fetched again
    for (const id of ids(again)) expect(ids(first)).not.toContain(id);
  });
  it('nothing new = keep the previous rows and say so; never a repeat or a fake', async () => {
    resolveIntent.mockResolvedValue({ items: [c('a', 'Coffee', 3)], experience: null });
    const first = await submitSurprise({ text: 'surprise me with coffee' });
    const again = await shuffleSurprise(first);
    expect(again.exhausted).toBe(true);
    expect(ids(again)).toEqual(ids(first));
  });
  it('an AI failure still gives the deterministic result; a network failure gives no fabricated one', async () => {
    classifyCreateRequest.mockRejectedValue(new Error('500 no credit'));
    expect(ids(await submitSurprise({ text: 'surprise me with coffee' }))).toEqual(['coffee']);
    resolveIntent.mockRejectedValue(new Error('network'));
    const failed = await submitSurprise({ text: 'surprise me tonight' });
    expect(failed.suggestion).toBeNull();
    expect(failed.lanes).toEqual([]);
  });
  it('a friend is named only through a declared-interest link, never a stranger', () => {
    const picks = [c('x', 'Coffee', 1, { title: 'Coffee meetup' }), c('y', 'Live Music', 1, { title: 'Jazz night' })];
    expect(findConnectedPersonForPicks(picks, [{ id: 'f1', name: 'Sam', interests: ['Live Music'] }])).toEqual({ id: 'f1', name: 'Sam', photo_url: undefined, forTitle: 'Jazz night' });
    expect(findConnectedPersonForPicks(picks, [{ id: 'f1', name: 'Sam', interests: ['Golf'] }])).toBeNull();
  });
});

describe('Home and Discover: one engine, one interpretation', () => {
  it('the same words give the same canonical searches, scope, time and rows', async () => {
    for (const text of ['surprise me', 'surprise me with coffee tonight', 'surprise me with something active', 'Surprise me for under $30', "I don't know. What's good tonight?"]) {
      resolveIntent.mockClear();
      const home = await submitSurprise({ text });
      const homeCalls = resolveIntent.mock.calls.map(([a]) => a);
      resolveIntent.mockClear();
      const disc = await submitSurprise({ text: discoverQuery(text).text, types: surpriseTypesForTab('all'), openNow: false });
      const discCalls = resolveIntent.mock.calls.map(([a]) => a);
      const strip = (calls) => calls.map(({ category, ...rest }) => rest); // broad interest tags are sampled at random
      expect([text, strip(discCalls)]).toEqual([text, strip(homeCalls)]);
      expect([text, disc.scope, disc.dateWindow, disc.header]).toEqual([text, home.scope, home.dateWindow, home.header]);
      if (home.scope.level !== 'broad') expect([text, rows(disc)]).toEqual([text, rows(home)]);
    }
  });

  it('Discover classifies "surprise me" as its own intent and never searches the literal phrase', () => {
    for (const t of ['surprise me', 'Surprise me tonight', 'surprise me with coffee', 'surprise me with coffee tonight', 'surprise me with something active', "what's good tonight"])
      expect([t, discoverQuery(t)]).toEqual([t, expect.objectContaining({ kind: 'pick_for_me', literalTerm: null })]);
    expect(discoverQuery('coffee tonight')).toEqual({ kind: 'search', text: 'coffee tonight', literalTerm: 'coffee tonight' });
    const discover = read('../screens/DiscoverHubScreen.js');
    const submit = discover.slice(discover.indexOf('async function handleUnderstandSearch'));
    expect(submit.indexOf("submitted.kind === 'pick_for_me'")).toBeLessThan(submit.indexOf('runIntentSearch('));
    expect(discover).toMatch(/const isSearching = query\.kind === 'search';/);
    expect(discover).toMatch(/const term = discoverQuery\(searchQuery\)\.literalTerm;/);
    expect(discover).toMatch(/const keyword = literalTerm;/);
    expect(discover).not.toMatch(/pickForMeKind|surpriseAskFromText/); // no screen-local detector
  });

  it('the ordinary search backstop stops a Surprise Me phrase before any AI, search or log', () => {
    const resolver = read('intentResolver.js');
    const body = resolver.slice(resolver.indexOf('export async function runIntentSearch'));
    const guard = body.indexOf("if (pick) return { outcome: 'pick_for_me'");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf('classifyCreateRequest('));
    expect(guard).toBeLessThan(body.indexOf('recordIntentSubmission('));
  });

  it('Discover still respects its type tab and Open-now toggle (they only narrow)', async () => {
    resolveIntent.mockResolvedValue({ items: [c('g', 'Coffee', 3), { type: 'perk', id: 'p', category: 'Coffee', score: 9 }], experience: null });
    const r = await submitSurprise({ text: 'surprise me with coffee', types: surpriseTypesForTab('perks'), openNow: true });
    expect(ids(r)).toEqual(['p']);
    expect(resolveIntent.mock.calls.every(([a]) => a.openNowChip === true)).toBe(true);
    expect(surpriseTypesForTab('all')).toBeNull();
    expect(read('../screens/DiscoverHubScreen.js')).toMatch(/submitSurprise\(\{ text: typedText, types: surpriseTypesForTab\(typeFilter\), openNow: openNowActive \}\)/);
  });

  it('both screens use the shared flow and render only the labeled rows', () => {
    const home = read('../screens/HomeScreen.js');
    const discover = read('../screens/DiscoverHubScreen.js');
    const submit = home.slice(home.indexOf('async function handleHomeIntentSubmit'));
    expect(submit.indexOf('pickForMeKind(typedText)')).toBeLessThan(submit.indexOf('classifyCreateRequest(typedText)'));
    expect(home).toMatch(/submitSurprise\(args\)/);
    expect(home).toMatch(/shuffleSurprise\(surprise\)/);
    expect(discover).toMatch(/shuffleSurprise\(discoverSurprise\)/);
    for (const screen of [home, discover]) {
      expect(screen).toMatch(/suggestion\.kind === 'lanes'/);
      expect(screen).not.toMatch(/A few ideas for you|surprise\.picks|discoverSurprise\.picks|suggestion\.kind === 'experience'/);
      expect(screen).not.toMatch(/runSurpriseMe|navigate\(['"]Surprise/);
    }
  });

  it('exactly one engine definition; nothing written to the search log', () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? walk(path.join(dir, d.name)) : (/\.js$/.test(d.name) && !/\.test\.js$/.test(d.name) ? [path.join(dir, d.name)] : []));
    const src = path.join(__dirname, '..');
    const definers = walk(src).filter((f) => /function (runSurpriseMe|pickLanes|surpriseAskFromText|surpriseScope)\b/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(src, f)).sort();
    expect(definers).toEqual(['services/surpriseMe.js', 'services/surpriseMeLogic.js']);
    expect(read('surpriseMe.js')).not.toMatch(/recordIntentSubmission|intent_submissions|intent_outcomes|recordIntentOutcome|getSocialForecast|weatherBias|askWeather/);
    const home = read('../screens/HomeScreen.js');
    const handler = home.slice(home.indexOf('async function handleSurpriseSubmit'), home.indexOf('function handleSurpriseDismiss'));
    expect(handler).not.toMatch(/recordIntent/);
    const discover = read('../screens/DiscoverHubScreen.js');
    const dHandler = discover.slice(discover.indexOf('async function handleDiscoverSurprise'), discover.indexOf('function handleIntentSearchResultTap'));
    expect(dHandler).not.toMatch(/recordIntent|navigation\.navigate/);
  });
});
