// Owner (2026-10-15): understood chips are correctable, remove only (reopens item 45 narrowly) + the People count chip. Against the
// REAL resolver with its network edges mocked (the same harness as askRefine.test.js).
jest.mock('expo-location', () => ({}));
let mockUuidN = 0;
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => `00000000-0000-4000-8000-${String(++mockUuidN).padStart(12, '0')}`) }));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(async () => null) }));
jest.mock('./gatherings', () => ({ getNearbyGatherings: jest.fn(), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })) }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('./brandOffers', () => ({
  getActiveOffers: jest.fn(async () => []), logBusinessProfileView: jest.fn(), getPartnerWeatherSettings: jest.fn(async () => ({})),
  getPartnerPriceInfo: jest.fn(async () => new Map()), getPartnerSuitedAges: jest.fn(async () => ({})), getPartnerOperatingInfo: jest.fn(async () => ({})),
  getDeclinedBusinesses: jest.fn(async () => []),
}));
jest.mock('./businessFulfillment', () => ({
  getConnectedOpenBusinessRequests: jest.fn(async () => []), searchActiveBusinessAvailability: jest.fn(async () => []),
  searchPolicyOnlyBusinesses: jest.fn(async () => []), searchOccasionOfferingBusinesses: jest.fn(async () => []),
  getMyBusinessAffinitySignals: jest.fn(async () => ({})),
}));
jest.mock('./preferencePolls', () => ({ getWhoForPreferenceSignals: jest.fn(async () => ({})) }));
jest.mock('./occasionPackages', () => ({ searchOccasionPackages: jest.fn(async () => []), formatOccasionPackageDetail: jest.fn() }));
jest.mock('./homeDashboard', () => ({ getSocialForecast: jest.fn(async () => null) }));
jest.mock('./createAssistant', () => ({ classifyCreateRequest: jest.fn() }));
jest.mock('./intentOutcomes', () => ({ recordIntentSubmission: jest.fn(async () => 'sub-1'), recordIntentSelection: jest.fn() }));

import { runIntentSearch } from './intentResolver';
import { refineTypedAsk } from './askRefine';
import fs from 'fs';
import path from 'path';
import { recordTypedAsk } from './typedAskAudit';
import { supabase } from './supabase';
import { getNearbyGatherings } from './gatherings';
import { classifyCreateRequest } from './createAssistant';
import { understoodPieces, removeUnderstoodPiece } from '../utils/askUnderstood';
import { resolveAsk, toClassification, createParamsFromAsk } from '../utils/askResolver';
import { askBusinessParamsFromAsk } from './askToBusiness';
import { SEQUENCES } from '../motion/motionBudget';
import { refinementChips } from '../utils/askRefinements';

const FIXED_NOW = new Date(2026, 8, 30, 15, 0, 0); // a Wednesday, 3 PM local
jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());
const at = (hours) => new Date(Date.now() + hours * 3600 * 1000).toISOString();
const g = (id, extra = {}) => ({ id, title: `Plan ${id}`, interest_tag: 'Live Music', scheduled_at: at(3), capacity: null, approvedCount: 0, ...extra });
const LIST = [
  g('tonight'),
  g('later', { scheduled_at: at(72) }),
  g('hike', { interest_tag: 'Hiking' }),
  g('bowl', { interest_tag: 'Bowling' }),
];
const payloads = () => supabase.rpc.mock.calls.map((c) => c[1].snapshot);
const keys = (s) => understoodPieces(s.classifyResult, s.typedText).map((p) => p.key);
const ids = (s) => s.items.filter((i) => i.type === 'gathering').map((i) => i.id).sort();

async function firstSearch(classify, text) {
  classifyCreateRequest.mockResolvedValue(classify);
  const r = await runIntentSearch(text);
  return { ...r, shown: recordTypedAsk('home', r) };
}

beforeEach(() => {
  supabase.rpc.mockReset();
  supabase.rpc.mockResolvedValue({ data: 'x', error: null });
  getNearbyGatherings.mockResolvedValue(LIST);
  classifyCreateRequest.mockClear();
});

describe('decision 1: the People count chip only for a number the words stated', () => {
  test('explicit "4 people" shows it; a date\'s assumed 2 never does', () => {
    const four = toClassification(resolveAsk('live music for 4 people tonight'));
    expect(understoodPieces(four, 'live music for 4 people tonight')).toContainEqual({ key: 'people', count: 4 });
    const date = toClassification(resolveAsk('coffee date tonight'));
    expect(understoodPieces(date, 'coffee date tonight').map((p) => p.key)).not.toContain('people');
    // a date's 2 assumed by anything other than the words (the AI, the resolver's own date default) never shows
    const assumed = { ...date, partyType: 'date', partySize: 2, structured: { ...date.structured, sources: { ...date.structured.sources, partySize: 'ai' } } };
    expect(understoodPieces(assumed, 'coffee date tonight').map((p) => p.key)).not.toContain('people');
    expect(understoodPieces({ partySize: 6 }, 'dinner')).toEqual([]); // a size the words did not state
  });
  test('labelled with the existing "{count} people" string; no new string', () => {
    const comp = fs.readFileSync(path.join(__dirname, '../components/AskUnderstoodChips.js'), 'utf8');
    expect(comp).toMatch(/t\('ui\.common\.count\.people', \{ count: p\.count \}\)/);
    expect(comp).toMatch(/t\('ui\.discover\.selectedTapClear', \{ label: labels\[i\] \}\)/);
  });
});

describe('decision 2: removing a chip re-runs the same ask in place, and the piece stays removed', () => {
  it('WHEN: the time filter goes, the words do not bring it back, everything else stays', async () => {
    const text = 'live music tonight with friends under $25';
    const s = await firstSearch({ intent: 'gathering', category: 'Live Music', dateWindow: 'tonight', partyType: 'friends', budgetMax: 25, priceLevel: '$', attributes: [] }, text);
    expect(ids(s)).toEqual(['tonight']);
    supabase.rpc.mockClear();
    classifyCreateRequest.mockClear();
    const r = await refineTypedAsk('home', s, 'understood_when');
    expect(ids(r)).toEqual(['later', 'tonight']);
    expect(r.typedText).toBe(text); // the original words, untouched
    expect(r.classifyResult).toMatchObject({ category: 'Live Music', dateWindow: null, partyType: 'friends', budgetMax: 25, priceLevel: '$', removedUnderstood: ['when'] });
    expect(keys(r)).toEqual(['what']);
    const p = payloads()[0];
    expect(p).toMatchObject({ refinement_key: 'understood_when', refinement_action: 'removed', parent_snapshot_id: s.shown.snapshotId, submission_id: 'sub-1' });
    expect(p.interpretation.date_window).toBeUndefined();
    expect(p.interpretation.spontaneity ?? null).toBeNull(); // "tonight" in the words is not read again
    expect(p.interpretation).toMatchObject({ category: 'Live Music', party_type: 'friends', budget_max: 25 });
    expect(classifyCreateRequest).not.toHaveBeenCalled(); // no AI call
  });

  it('WHERE: indoor results come back and "outdoors" in the words is not read again', async () => {
    const text = 'something outdoors tonight';
    const s = await firstSearch({ intent: 'gathering', category: null, dateWindow: 'tonight', attributes: [] }, text);
    expect(keys(s)).toEqual(['when', 'where']);
    expect(ids(s)).not.toContain('bowl');
    supabase.rpc.mockClear();
    const r = await refineTypedAsk('home', s, 'understood_where');
    expect(keys(r)).toEqual(['when']);
    expect(ids(r)).toContain('bowl');
    expect(ids(r)).not.toContain('later'); // the time is still there
    const p = payloads()[0];
    expect(p).toMatchObject({ refinement_key: 'understood_where', refinement_action: 'removed' });
    expect(p.interpretation.environment ?? null).toBeNull();
    expect(p.interpretation.environment_required).toBe(false);
  });

  it('WHAT: the category filter goes; the time stays', async () => {
    const s = await firstSearch({ intent: 'gathering', category: 'Live Music', dateWindow: 'tonight', attributes: [] }, 'live music tonight');
    expect(ids(s)).toEqual(['tonight']);
    const r = await refineTypedAsk('home', s, 'understood_what');
    expect(ids(r)).toEqual(['bowl', 'hike', 'tonight']);
    expect(keys(r)).toEqual(['when']);
    expect(payloads().at(-1)).toMatchObject({ refinement_key: 'understood_what', refinement_action: 'removed' });
  });

  it('WHO: the party goes and partner words do not refill it', async () => {
    const text = 'live music tonight with my family and my girlfriend';
    const s = await firstSearch({ intent: 'gathering', category: 'Live Music', dateWindow: 'tonight', partyType: 'family', attributes: [] }, text);
    expect(keys(s)).toContain('who');
    const r = await refineTypedAsk('home', s, 'understood_who');
    expect(keys(r)).toEqual(['what', 'when']);
    expect(payloads().at(-1).interpretation.party_type).toBeUndefined();
  });

  it('PEOPLE: the stated count goes and is not re-read from "4 people"', async () => {
    const text = 'live music tonight for 4 people';
    const s = await firstSearch({ ...toClassification(resolveAsk(text)), intent: 'gathering', category: 'Live Music' }, text);
    expect(keys(s)).toContain('people');
    supabase.rpc.mockClear();
    const r = await refineTypedAsk('home', s, 'understood_people');
    expect(keys(r)).not.toContain('people');
    expect(r.classifyResult.partySize).toBeNull();
    expect(payloads()[0].interpretation.party_size_stated).toBe(false);
    expect(payloads()[0]).toMatchObject({ refinement_key: 'understood_people', refinement_action: 'removed' });
  });

  it('removals add up and survive a later refinement chip', async () => {
    let s = await firstSearch({ intent: 'gathering', category: null, dateWindow: 'tonight', attributes: [] }, 'something outdoors tonight');
    s = await refineTypedAsk('home', s, 'understood_where');
    s = await refineTypedAsk('home', s, 'understood_when');
    s = await refineTypedAsk('home', s, 'solo');
    expect(s.classifyResult.removedUnderstood).toEqual(['where', 'when']);
    expect(keys(s)).toEqual([]);
    expect(ids(s)).toEqual(['bowl', 'hike', 'later', 'tonight']);
  });

  it('a WHAT chip showing only a Browse group is cleared the rail\'s own way (refinement "category")', async () => {
    const s = await firstSearch({ intent: 'gathering', category: null, dateWindow: null, attributes: [] }, 'something fun');
    const narrowed = { ...s, classifyResult: { ...s.classifyResult, narrowGroup: 'activities_recreation' } };
    supabase.rpc.mockClear();
    const r = await refineTypedAsk('home', narrowed, 'understood_what');
    expect(r.classifyResult.narrowGroup).toBeUndefined();
    expect(r.classifyResult.removedUnderstood).toBeUndefined();
    expect(payloads()[0]).toMatchObject({ refinement_key: 'category', refinement_action: 'removed' });
  });

  test('the next screens carry the corrected ask, not the original words', () => {
    const text = 'coffee for 4 tonight';
    let c = toClassification(resolveAsk(text));
    expect(createParamsFromAsk(c.structured, text, c)).toMatchObject({ quickStartPartySize: 4, quickStartWhenPreset: expect.any(String) });
    c = removeUnderstoodPiece(removeUnderstoodPiece(c, 'people'), 'when');
    const create = createParamsFromAsk(c.structured, text, c);
    expect(create.quickStartPartySize).toBeNull();
    expect(create.quickStartWhenPreset).toBeUndefined();
    expect(create.inferredSummary.map((r) => r.layer)).not.toEqual(expect.arrayContaining(['people']));
    expect(create.inferredSummary.map((r) => r.layer)).not.toContain('time');
    const ask = askBusinessParamsFromAsk({ classifyResult: c, typedText: text });
    expect(ask.prefillPartySize).toBeNull();
    expect(ask.prefillDateWindow).toBeNull();
    expect(ask.carriedSummary.map((r) => r.layer)).toEqual(['activity']);
  });

  test('an unknown key changes nothing', () => {
    const c = { category: 'Live Music', dateWindow: 'tonight' };
    expect(removeUnderstoodPiece(c, 'budget')).toEqual(c);
  });
});

describe('boundaries', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '../..', f), 'utf8');
  const home = read('src/screens/HomeScreen.js');
  const discover = read('src/screens/DiscoverHubScreen.js');
  test('removable only on a results list: never under the Finding loader, never above People mode', () => {
    for (const src of [home, discover]) {
      expect(src).toMatch(/intentPhase\?\.phase === 'finding' && <AskUnderstoodChips classifyResult=\{intentPhase\.classifyResult\} typedText=\{intentPhase\.typedText\} \/>/);
      expect(src.match(/onRemove=\{/g)).toHaveLength(1);
      expect(src).toMatch(/onRemove=\{canRefine\(\w+\.classifyResult\) \? \(piece\) => handleIntentRefine\(`understood_\$\{piece\}`\) : null\}/);
    }
    expect(discover).toMatch(/<AskUnderstoodChips classifyResult=\{peopleFromAsk\.understood\.classifyResult\} typedText=\{peopleFromAsk\.understood\.typedText\} \/>/);
  });
  test('motion tokens unchanged; Reduce Motion still settled at once', () => {
    expect(SEQUENCES.askUnderstood).toEqual({ tier: 'small', maxPieces: 4, pieceMs: 160, staggerMs: 40, risePx: 4 });
    const comp = read('src/components/AskUnderstoodChips.js');
    expect(comp).toMatch(/&& !reduceMotion\)/);
    expect(comp).toMatch(/new Animated\.Value\(play \? 0 : 1\)/);
  });
  test('the server accepts the five keys (the same list as the client)', () => {
    const sql = read('supabase/migrations/20270306_understood_chip_removal.sql');
    for (const k of ['understood_what', 'understood_when', 'understood_where', 'understood_who', 'understood_people']) {
      expect(sql.match(new RegExp(`'${k}'`, 'g'))).toHaveLength(2); // the CHECK and the RPC's own validation
    }
  });
});

// Owner (2026-10-15): the item-107 Date chip, once turned off, is not refilled by partner words in the unchanged ask.
describe('Date refinement chip: partner words never refill it', () => {
  const TEXT = 'live music tonight with my girlfriend';
  const dateAsk = () => firstSearch({ ...toClassification(resolveAsk(TEXT)), intent: 'gathering', category: 'Live Music' }, TEXT);
  const dateShaped = (p) => p.interpretation.party_type === 'date' || p.interpretation.party_size === 2 || (p.interpretation.attributes ?? []).includes('date_friendly');

  it('turning Date off keeps it off through the re-run and later refinements; the words and other refinements stay', async () => {
    let s = await dateAsk();
    expect(refinementChips(s.classifyResult).find((c) => c.key === 'date').selected).toBe(true); // the partner words selected it
    s = await refineTypedAsk('home', s, 'under_25');
    supabase.rpc.mockClear();
    classifyCreateRequest.mockClear();
    s = await refineTypedAsk('home', s, 'date');
    expect(s.typedText).toBe(TEXT);
    expect(refinementChips(s.classifyResult).filter((c) => c.selected).map((c) => c.key)).toEqual(['under_25']);
    const off = payloads()[0];
    expect(off).toMatchObject({ refinement_key: 'date', refinement_action: 'removed' });
    expect(dateShaped(off)).toBe(false); // without the fix: party_type 'date', party_size 2, date_friendly
    expect(off.interpretation).toMatchObject({ category: 'Live Music', date_window: 'tonight', budget_max: 25 });
    // a later, unrelated refinement keeps Date off
    s = await refineTypedAsk('home', s, 'under_25');
    expect(refinementChips(s.classifyResult).find((c) => c.key === 'date').selected).toBe(false);
    expect(dateShaped(payloads()[1])).toBe(false);
    expect(classifyCreateRequest).not.toHaveBeenCalled();
    // turning Date back on is a date again
    s = await refineTypedAsk('home', s, 'date');
    expect(payloads()[2].interpretation).toMatchObject({ party_type: 'date' });
    expect(s.classifyResult.partnerWordsOff).toBeUndefined();
  });

  it('switching Date to Solo leaves nothing date-shaped behind', async () => {
    let s = await dateAsk();
    supabase.rpc.mockClear();
    s = await refineTypedAsk('home', s, 'solo');
    expect(refinementChips(s.classifyResult).filter((c) => c.selected).map((c) => c.key)).toEqual(['solo']);
    expect(payloads()[0].interpretation.party_type).toBe('solo');
    expect(dateShaped(payloads()[0])).toBe(false);
  });

  it('a who-for chip cleared on a partner-words ask does not become a date', async () => {
    const text = 'live music tonight with friends and my girlfriend';
    let s = await firstSearch({ intent: 'gathering', category: 'Live Music', dateWindow: 'tonight', partyType: 'friends', attributes: [] }, text);
    supabase.rpc.mockClear();
    s = await refineTypedAsk('home', s, 'friends');
    expect(refinementChips(s.classifyResult).some((c) => c.selected)).toBe(false);
    expect(dateShaped(payloads()[0])).toBe(false);
  });
});
