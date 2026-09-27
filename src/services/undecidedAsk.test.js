// Item 90 (owner, 2026-09-26): "I don't know what I want" is a valid intent. No category is forced; Nearby answers with labeled
// rows (Best Pick, With Friends, Something Active, Something Easy), each only when a real result backs its label. Same engine and
// flow as Surprise Me (submit / shuffle / tap, never logged). The orchestrator is driven here with its network edges mocked.
jest.mock('./intentResolver', () => ({ resolveIntent: jest.fn(), navigateToIntentResultItem: jest.fn() }));
jest.mock('./createAssistant', () => ({ classifyCreateRequest: jest.fn() }));
jest.mock('./friends', () => ({ getMyFriends: jest.fn(async () => []) }));
jest.mock('./matchActions', () => ({ getMyMatches: jest.fn(async () => []) }));
jest.mock('./deviceCalendar', () => ({ isCalendarIntegrationEnabled: jest.fn(async () => false), getUpcomingCalendarEvents: jest.fn() }));
jest.mock('./supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { interests: [] }, error: null }) }), in: async () => ({ data: [], error: null }) }) }),
  },
}));

const fs = require('fs');
const path = require('path');
const { resolveIntent } = require('./intentResolver');
const { classifyCreateRequest } = require('./createAssistant');
const {
  submitSurprise, shuffleSurprise, pickForMeKind, pickLanes, fitsFriends, fitsActive, fitsEasy, undecidedHeader, undecidedPlanRecipe,
} = require('./surpriseMe');
const { undecidedAskFromText, stripUndecidedPhrase } = require('../constants/undecidedAsk');
const { openEndedAskGroups } = require('../utils/openEndedAsk');

const g = (id, category, score, extra = {}) => ({ type: 'gathering', id, category, score, title: id, ...extra });

describe('recognizing "I don\'t know what I want"', () => {
  it('the person\'s own words, deterministic', () => {
    for (const t of ["I don't know what I want", "I don't know. What's good tonight?", "what's good tonight", "What's good around here?", 'no idea what to do tonight',
      "not sure what I want", "we don't know what to do", 'idk', "I'm so indecisive", "anything good tonight?"])
      expect([t, undecidedAskFromText(t)]).toEqual([t, true]);
  });
  it('look-alikes are not it', () => {
    for (const t of ["what's good for a headache", "what's good at the Thai place", "I don't know what time it starts", "I know exactly what I want",
      'coffee tonight', "I don't know what to get my wife", 'something good to eat'])
      expect([t, undecidedAskFromText(t)]).toEqual([t, false]);
  });
  it('surprise wins when both are said; a category said after all makes it an ordinary ask', () => {
    expect(pickForMeKind("I don't know, surprise me")).toBe('surprise');
    expect(pickForMeKind("I don't know what I want tonight")).toBe('undecided');
    expect(pickForMeKind("I don't know what I want, maybe coffee")).toBeNull();
    expect(pickForMeKind('dinner tonight')).toBeNull();
    expect(stripUndecidedPhrase("I don't know what I want, something under $30 tonight")).toBe('something under $30 tonight');
  });
  it('counts as an open-ended ask, so service businesses are left out and no category is forced', () => {
    expect(Array.isArray(openEndedAskGroups({ rawText: "I don't know what I want" }))).toBe(true);
    expect(openEndedAskGroups({ rawText: "I don't know what I want" })).not.toContain('home_local_services');
  });
});

describe('each labeled row is a claim backed by real data', () => {
  it('With Friends = host-declared friends/groups or a declared group-friendly business', () => {
    expect(fitsFriends(g('a', 'Trivia', 1, { partyType: 'friends' }))).toBe(true);
    expect(fitsFriends({ type: 'business_availability', id: 'b', businessPartner: { attributes: ['group_friendly'] } })).toBe(true);
    expect(fitsFriends(g('c', 'Trivia', 1))).toBe(false); // undeclared is never assumed
  });
  it('Something Active = the energy table or the host\'s energy; Something Easy = drop-in/easy and never high-energy', () => {
    expect(fitsActive(g('p', 'Pickleball', 1))).toBe(true);
    expect(fitsActive(g('c', 'Coffee', 1))).toBe(false);
    expect(fitsEasy(g('c', 'Coffee', 1))).toBe(true);
    expect(fitsEasy(g('n', 'Nightclubs', 1))).toBe(false);
    expect(fitsEasy(g('long', 'Coffee', 1, { durationMinutes: 240 }))).toBe(false); // a host-declared long event is not easy
  });
  it('rows only when real; no item or business twice; Best Pick first', () => {
    const pool = [
      g('trivia', 'Trivia', 9, { partyType: 'friends' }),
      g('pickle', 'Pickleball', 8),
      g('coffee', 'Coffee', 7),
      { type: 'business_availability', id: 'b1', partnerId: 'P', category: 'Coffee', score: 6 },
      { type: 'business_availability', id: 'b2', partnerId: 'P', category: 'Pickleball', score: 5 },
    ];
    const lanes = pickLanes(pool);
    expect(lanes.map((l) => [l.label, l.items.map((i) => i.id)])).toEqual([
      ['Best Pick', ['trivia']],
      ['Something Active', ['pickle']],
      ['Something Easy', ['coffee']],
    ]); // no With Friends row: the only friends result is already the Best Pick
    expect(pickLanes([g('x', 'Museums', 1)]).map((l) => l.key)).toEqual(['best']);
    expect(pickLanes([])).toEqual([]);
  });
  it('Best Pick may be a real two-part plan (two parts, two different businesses)', () => {
    const experience = { components: [
      { key: 'food', label: '🍽️ Dinner', items: [{ type: 'business_availability', id: 'd', partnerId: 'A', category: 'Restaurants', score: 5, title: 'Dinner at A' }] },
      { key: 'entertainment', label: '🎵 Entertainment', items: [g('m', 'Live Music', 4)] },
    ] };
    const lanes = pickLanes([g('m', 'Live Music', 4)], { experience });
    expect(lanes[0]).toMatchObject({ key: 'best', plan: 'Dinner + Entertainment' });
    expect(lanes[0].items.map((i) => i.id)).toEqual(['d', 'm']);
  });
  it('the header and plan recipe come only from the person\'s time words', () => {
    expect(undecidedHeader('tonight')).toBe('Tonight near you');
    expect(undecidedHeader(null)).toBe('Near you');
    expect(undecidedPlanRecipe('tonight')).toBe('night_out');
    expect(undecidedPlanRecipe(null)).toBeNull();
  });
});

describe('the engine', () => {
  beforeEach(() => {
    resolveIntent.mockReset();
    classifyCreateRequest.mockReset();
    classifyCreateRequest.mockResolvedValue({ dateWindow: 'tonight', category: 'Coffee' });
    resolveIntent.mockResolvedValue({ items: [g('trivia', 'Trivia', 9, { partyType: 'friends' }), g('pickle', 'Pickleball', 8), g('coffee', 'Coffee', 7)], experience: null });
  });

  it('"I don\'t know. What\'s good tonight?": ONE search, no category forced (the AI\'s guess ignored), rows returned', async () => {
    const r = await submitSurprise({ text: "I don't know. What's good tonight?" });
    expect(resolveIntent).toHaveBeenCalledTimes(1);
    expect(resolveIntent.mock.calls[0][0]).toMatchObject({ category: null, dateWindow: 'tonight', cuisine: null, attributes: [], occasion: null });
    expect(r.kind).toBe('undecided');
    expect(r.header).toBe('Tonight near you');
    expect(r.lanes.map((l) => l.key)).toEqual(['best', 'active', 'easy']);
  });

  it('no time words = no time (never invented), even if the classifier says one', async () => {
    const r = await submitSurprise({ text: "I don't know what I want" });
    expect(resolveIntent.mock.calls[0][0].dateWindow).toBeNull();
    expect(r.header).toBe('Near you');
  });

  it('a network failure gives no fake rows; Shuffle avoids the previous rows', async () => {
    const r = await submitSurprise({ text: "what's good tonight" });
    const again = await shuffleSurprise(r);
    expect(again.exhausted).toBe(true); // everything real was already shown: keep the previous rows, say so
    expect(again.lanes.map((l) => l.key)).toEqual(r.lanes.map((l) => l.key));
    resolveIntent.mockRejectedValue(new Error('network'));
    const failed = await submitSurprise({ text: "what's good tonight" });
    expect(failed.suggestion).toBeNull();
    expect(failed.lanes).toEqual([]);
  });
});

describe('wiring: Home and Discover share it, nothing is logged', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
  it('both surfaces route it through the one flow and render the rows inline', () => {
    const home = read('../screens/HomeScreen.js');
    const discover = read('../screens/DiscoverHubScreen.js');
    expect(home).toMatch(/pickForMeKind\(typedText\)/);
    expect(discover).toMatch(/submitted\.kind === 'pick_for_me'/); // Discover's one classification (utils/discoverQuery.js)
    for (const screen of [home, discover]) expect(screen).toMatch(/suggestion\.kind === 'lanes'/);
    const { discoverQuery } = require('../utils/discoverQuery');
    expect(discoverQuery("what's good tonight")).toMatchObject({ kind: 'pick_for_me', pick: 'undecided', literalTerm: null });
    const eng = read('surpriseMe.js');
    expect(eng).not.toMatch(/recordIntentSubmission|intent_submissions|intent_outcomes/);
  });
});
