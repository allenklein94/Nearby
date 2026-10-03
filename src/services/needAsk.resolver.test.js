// Owner item 162 (2026-10-03, LOCKED): Want vs Need. Drives the REAL resolver (runIntentSearch -> resolveIntent) with its
// network edges mocked. A need (the asked category is a need/service group) orders availability > proximity > reliability >
// personalization, each level a tie-breaker for the one before; a want keeps today's order.
jest.mock('expo-location', () => ({}));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(async () => ({ coords: { latitude: 40.3, longitude: -75.2 } })) }));
jest.mock('./gatherings', () => ({ getNearbyGatherings: jest.fn(async () => []), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })) }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('./brandOffers', () => ({
  getActiveOffers: jest.fn(async () => []), logBusinessProfileView: jest.fn(), getPartnerWeatherSettings: jest.fn(async () => ({})),
  getPartnerPriceInfo: jest.fn(async () => new Map()), getPartnerSuitedAges: jest.fn(async () => ({})), getPartnerOperatingInfo: jest.fn(async () => new Map()),
}));
jest.mock('./businessFulfillment', () => ({
  getConnectedOpenBusinessRequests: jest.fn(async () => []), searchActiveBusinessAvailability: jest.fn(async () => []),
  searchPolicyOnlyBusinesses: jest.fn(async () => []), searchOccasionOfferingBusinesses: jest.fn(async () => []),
  getMyBusinessAffinitySignals: jest.fn(async () => ({})), getPartnerReputations: jest.fn(async () => new Map()),
}));
jest.mock('./preferencePolls', () => ({ getWhoForPreferenceSignals: jest.fn(async () => ({})) }));
jest.mock('./occasionPackages', () => ({ searchOccasionPackages: jest.fn(async () => []), formatOccasionPackageDetail: jest.fn() }));
jest.mock('./homeDashboard', () => ({ getSocialForecast: jest.fn(async () => null) }));
jest.mock('./createAssistant', () => ({ classifyCreateRequest: jest.fn() }));
jest.mock('./intentOutcomes', () => ({ recordIntentSubmission: jest.fn(async () => 'sub-1') }));
jest.mock('./behaviorSignals', () => ({ recordSearchBehavior: jest.fn(), getMyLearnedAffinity: jest.fn(async () => null) }));

import { runIntentSearch } from './intentResolver';
import { searchActiveBusinessAvailability, getMyBusinessAffinitySignals, getPartnerReputations } from './businessFulfillment';
import { classifyCreateRequest } from './createAssistant';
import { askKind, orderNeedResults, needAvailabilityWindow, NEED_CAPTION, NEED_CLOSE_CAPTION } from '../utils/needAsk';
import { dateWindowFromText } from '../utils/askResolver';
import { clockWindowFromText, dateAnchorFromText, pointClockFromText } from '../constants/clockWindow';
import { spontaneityOf } from '../constants/spontaneity';
import { isNeedCategory } from '../constants/gatheringCategories';
import { RELIABILITY_MIN_OPPORTUNITIES } from '../utils/reliabilityRecord';

const FIXED_NOW = new Date(2026, 8, 30, 15, 0, 0); // a Wednesday, 3 PM local
jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());
const at = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

// live = a posting open right now (available); later = a posting that starts in 3 hours (not usable now: unknown)
// slot = [startHours, endHours] from now, overriding live
const row = (id, { miles = 1, live = true, category = 'Car Wash', slot = null } = {}) => ({
  id, partner_id: `p-${id}`, partner_name: `Biz ${id}`, title: 'Open slots', category,
  distance_miles: miles, starts_at: slot ? at(slot[0]) : live ? at(-1) : at(3), ends_at: slot ? at(slot[1]) : live ? at(2) : at(6), remaining_capacity: 5,
});
const ESTABLISHED = { total_opportunities: RELIABILITY_MIN_OPPORTUNITIES, completion_rate: 90 };

async function ask(text, category, rows, { followed = [], established = [], dateWindow = 'today' } = {}) {
  searchActiveBusinessAvailability.mockResolvedValue(rows);
  getMyBusinessAffinitySignals.mockResolvedValue({ followedPartnerIds: new Set(followed.map((id) => `p-${id}`)) });
  getPartnerReputations.mockResolvedValue(new Map(established.map((id) => [`p-${id}`, ESTABLISHED])));
  classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category, dateWindow, attributes: [] });
  const out = await runIntentSearch(text);
  return { ids: out.items.filter((i) => i.type === 'business_availability').map((i) => i.id), out };
}

describe('classification: a need/service category AND task framing in the words (owner, 2026-10-03, LOCKED)', () => {
  it.each([
    ['I need a haircut today', 'Barbers'],
    ['find a haircut', 'Barbers'],
    ['book me a haircut', 'Barbers'],
    ['where can I get a haircut?', 'Barbers'],
    ['I need flowers for my mom', 'Florist'],
    ['looking for a florist', 'Florist'],
    ['I have to buy a gift', 'Gift Shop'],
    ['need to find a gift shop', 'Gift Shop'],
    ['I need a dog groomer', 'Grooming'],
    ['I need a car wash today', 'Car Wash'],
    ['schedule a car wash', 'Car Wash'],
  ])('"%s" -> NEED', (text, category) => {
    expect(askKind({ category, rawText: text })).toBe('need');
  });

  it.each([
    ['haircut', 'Barbers'],
    ['haircuts near me', 'Barbers'],
    ['flowers', 'Florist'],
    ['best florist', 'Florist'],
    ['gift shop', 'Gift Shop'],
    ['car wash today', 'Car Wash'],
    ['coffee', 'Coffee'],
    ['places for coffee', 'Coffee'],
    ['I need coffee', 'Coffee'],
    ['I need a drink', 'Bars & Lounges'],
    ['I need something fun to do', null],
    ['I need a vacation, something like a car wash', 'Car Wash'], // the verb is too far from the category words
  ])('"%s" -> WANT', (text, category) => {
    expect(askKind({ category, rawText: text })).toBe('want');
  });

  it('category membership alone is never enough, and nothing but the words + resolved category is read', () => {
    expect(askKind({ category: 'Car Wash' })).toBe('want');
    expect(isNeedCategory('Barbers')).toBe(true);
    expect(isNeedCategory('Coffee')).toBe(false);
    expect(isNeedCategory('home_local_services')).toBe(true);
    const src = require('fs').readFileSync(require('path').join(__dirname, '../utils/needAsk.js'), 'utf8');
    expect(src).not.toMatch(/classifyCreateRequest|supabase|historyScore\s*[><]/);
  });

  it('a need ask shows the caption and records ask_kind; a want does neither', async () => {
    const need = await ask('I need a car wash today', 'Car Wash', [row('a')]);
    expect(need.out.openEndedNote).toContain(NEED_CAPTION);
    expect(need.out.audit.interpretation.ask_kind).toBe('need');
    const want = await ask('I need coffee', 'Coffee', [row('a', { category: 'Coffee' })]);
    expect(want.out.openEndedNote ?? '').not.toContain(NEED_CAPTION);
    expect(want.out.audit.interpretation.ask_kind).toBe('want');
  });
});

describe('need ordering: strictly availability > proximity > reliability > personalization', () => {
  it('availability decides first: an open-now place beats a closer, followed, established one that is not usable now', async () => {
    const { ids } = await ask('I need a car wash today', 'Car Wash', [row('near', { miles: 0.5, live: false }), row('open', { miles: 8 })], { followed: ['near'], established: ['near'] });
    expect(ids).toEqual(['open', 'near']);
  });

  it('urgency (item 163): ASAP keeps open-right-now first; "no rush" lets the closer place lead', async () => {
    const rows = () => [row('near', { miles: 0.5, live: false }), row('open', { miles: 8 })];
    const asap = await ask('I need a car wash ASAP', 'Car Wash', rows(), { dateWindow: 'now' });
    expect(asap.ids).toEqual(['open', 'near']);
    const relaxed = await ask('I need a car wash, no rush', 'Car Wash', rows(), { dateWindow: null });
    expect(relaxed.ids).toEqual(['near', 'open']);
    expect(relaxed.out.audit.interpretation.spontaneity).toBe('no_rush');
    expect(relaxed.out.openEndedNote).toContain(NEED_CLOSE_CAPTION);
  });

  // FIXED_NOW = Wednesday 3 PM. 'near' = a 0.5 mi place open right now (2-5 PM today); 'tmrw' = 8 mi, a slot tomorrow 10 AM-1 PM.
  const timing = () => [row('near', { miles: 0.5 }), row('tmrw', { miles: 8, slot: [19, 22] })];
  it('timing rule 1: a stated day decides availability ("tomorrow" = anywhere tomorrow), and beats "no rush"', async () => {
    expect((await ask('I need a car wash tomorrow', 'Car Wash', timing(), { dateWindow: null })).ids).toEqual(['tmrw', 'near']);
    const r = await ask('I need a car wash, no rush, tomorrow is fine', 'Car Wash', timing(), { dateWindow: null });
    expect(r.ids).toEqual(['tmrw', 'near']);
    expect(r.out.openEndedNote).toContain(NEED_CAPTION);
  });
  it('timing rule 1: a stated clock time decides ("at 4 PM" today), never moved to another day', async () => {
    const rows = () => [row('later', { miles: 8, slot: [3, 6] }), row('near', { miles: 0.5 })]; // later = 6-9 PM
    expect((await ask('I need a car wash at 4 PM', 'Car Wash', rows(), { dateWindow: null })).ids).toEqual(['near', 'later']);
    expect((await ask('I need a car wash at 7 PM', 'Car Wash', rows(), { dateWindow: null })).ids).toEqual(['later', 'near']);
    // 1 PM already passed today: no moment, availability ties, proximity leads
    const past = await ask('I need a car wash at 1 PM', 'Car Wash', [row('later', { miles: 8, slot: [3, 6] }), row('closer', { miles: 2, live: false })], { dateWindow: null });
    expect(past.ids).toEqual(['closer', 'later']);
    expect(past.out.openEndedNote).toContain(NEED_CLOSE_CAPTION);
  });
  it('timing rules 2-3: ASAP = now; "this week" = no moment; the caption says what was applied, one line', async () => {
    expect((await ask('I need a car wash ASAP', 'Car Wash', timing(), { dateWindow: 'now' })).ids).toEqual(['near', 'tmrw']);
    const wk = await ask('I need a car wash this week', 'Car Wash', [row('soon', { miles: 8 }), row('closer', { miles: 2, live: false })], { dateWindow: null });
    expect(wk.ids).toEqual(['closer', 'soon']);
    expect(wk.out.openEndedNote).toContain(NEED_CLOSE_CAPTION);
    expect(wk.out.openEndedNote).not.toContain(NEED_CAPTION);
    expect(wk.out.openEndedNote).not.toMatch(/this week first/); // no second, spontaneity line for a need
  });
  it('timing never classifies: "haircut ASAP" / "car wash tomorrow, no rush" stay WANT', () => {
    expect(askKind({ category: 'Barbers', rawText: 'haircut ASAP' })).toBe('want');
    expect(askKind({ category: 'Car Wash', rawText: 'car wash tomorrow, no rush' })).toBe('want');
  });

  it('availability tied: proximity decides; reliability and personalization cannot override a measured distance', async () => {
    const { ids } = await ask('I need a car wash today', 'Car Wash', [row('far', { miles: 6 }), row('near', { miles: 3 })], { followed: ['far'], established: ['far'] });
    expect(ids).toEqual(['near', 'far']);
  });

  it('availability and proximity tied: reliability decides over personalization', async () => {
    const { ids } = await ask('I need a car wash today', 'Car Wash', [row('liked', { miles: 3 }), row('reliable', { miles: 3 })], { followed: ['liked'], established: ['reliable'] });
    expect(ids).toEqual(['reliable', 'liked']);
  });

  it('only when everything before is tied does personalization decide', async () => {
    const { ids } = await ask('I need a car wash today', 'Car Wash', [row('other', { miles: 3 }), row('liked', { miles: 3 })], { followed: ['liked'] });
    expect(ids).toEqual(['liked', 'other']);
  });

  it('nothing is removed: the same results as without need ordering', async () => {
    const rows = [row('a', { miles: 4 }), row('b', { miles: 1, live: false }), row('c', { miles: 2 })];
    const { ids } = await ask('I need a car wash today', 'Car Wash', rows);
    expect([...ids].sort()).toEqual(['a', 'b', 'c']);
  });

  it('a failed reliability lookup = everyone neutral, never an error', async () => {
    getPartnerReputations.mockRejectedValueOnce(new Error('down'));
    searchActiveBusinessAvailability.mockResolvedValue([row('far', { miles: 6 }), row('near', { miles: 3 })]);
    getMyBusinessAffinitySignals.mockResolvedValue({});
    classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: 'Car Wash', dateWindow: 'today', attributes: [] });
    const out = await runIntentSearch('I need a car wash today');
    expect(out.items.filter((i) => i.type === 'business_availability').map((i) => i.id)).toEqual(['near', 'far']);
  });

  it('a want ask keeps today\'s order (a followed place can still lead a closer one)', async () => {
    const { ids } = await ask('somewhere for a drink', 'Bars & Lounges', [row('near', { miles: 0.5, category: 'Bars & Lounges' }), row('liked', { miles: 6, category: 'Bars & Lounges' })], { followed: ['liked'], dateWindow: null });
    expect(ids[0]).toBe('liked');
  });
});

describe('orderNeedResults (the rule, buckets reuse existing ones)', () => {
  const ent = (c) => c.entity;
  const now = new Date();
  const open = { kind: 'business', posting: { startsAt: at(-1), endsAt: at(1), remainingCapacity: 3 } };
  it('unknown distance sorts after every measured distance; full ties keep the existing order', () => {
    const items = [{ id: 'x', entity: open }, { id: 'y', entity: open, distanceMiles: 9 }, { id: 'z', entity: open, distanceMiles: 9 }];
    expect(orderNeedResults(items, { toEntity: ent, at: now, reputations: new Map() }).map((c) => c.id)).toEqual(['y', 'z', 'x']);
  });
  it('reliability: established record > no record; there is no bucket below no record', () => {
    const base = { entity: open, distanceMiles: 2 };
    const items = [{ id: 'none', ...base, partnerId: 'n' }, { id: 'est', ...base, partnerId: 'e' }, { id: 'weak', ...base, partnerId: 'w' }];
    const reps = new Map([['e', { total_opportunities: 9 }], ['w', { total_opportunities: 2 }]]);
    expect(orderNeedResults(items, { toEntity: ent, at: now, reputations: reps }).map((c) => c.id)).toEqual(['est', 'none', 'weak']);
  });
  it('needAvailabilityWindow, from the real parsers: the locked timing hierarchy', () => {
    const now = new Date(2026, 8, 30, 15, 0, 0); // Wednesday 3 PM
    const win = (text) => {
      const dw = dateWindowFromText(text);
      return needAvailabilityWindow({ dateWindow: dw, clockWindow: clockWindowFromText(text), dateAnchor: dateAnchorFromText(text, now), pointClock: pointClockFromText(text), spontaneity: spontaneityOf({ dateWindow: dw, rawText: text }) }, now);
    };
    const h = (w, k) => new Date(w[k]).getHours();
    expect(win('I need a plumber at 4 PM')).toMatchObject({ basis: 'stated' });
    expect(h(win('I need a plumber at 4 PM'), 'startMs')).toBe(16);
    expect(win('I need a plumber at 1 PM')).toBeNull(); // passed: never moved to tomorrow
    const tmrw = win('I need a haircut tomorrow');
    expect([new Date(tmrw.startMs).getDate(), h(tmrw, 'startMs'), tmrw.endMs - tmrw.startMs]).toEqual([1, 0, 24 * 3600 * 1000]);
    expect(new Date(win('I need a haircut tomorrow at 2 PM').startMs).getHours()).toBe(14);
    expect(new Date(win('haircut tomorrow after 2 PM').startMs).getHours()).toBe(14);
    expect(h(win('I need a haircut tonight'), 'startMs')).toBe(17);
    expect(win('no rush, tomorrow is fine').basis).toBe('stated');
    expect(win('I need a plumber ASAP')).toMatchObject({ basis: 'now' });
    expect(win('I need a haircut, no rush')).toBeNull();
    expect(win('I need a haircut this week')).toBeNull();
    expect(win('I need a haircut next week')).toBeNull();
    expect(win('I need a haircut today')).toMatchObject({ basis: 'now' }); // today keeps its existing meaning
    expect(win('I need a haircut')).toMatchObject({ basis: 'now' }); // no timing: existing meaning
    expect(win('I need a car wash this weekend').basis).toBe('stated');
  });
});
