// Owner idea "307" (2026-10-20, reopens decision 3 narrowly): WHEN and People chips can be CHANGED in place to an existing
// choice. Against the REAL resolver with its network edges mocked (the same harness as understoodChipRemoval.test.js).
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
import { understoodPieces, removeUnderstoodPiece, changeUnderstoodPiece, understoodChoices, UNDERSTOOD_PEOPLE_CHOICES } from '../utils/askUnderstood';
import { resolveAsk, toClassification, createParamsFromAsk } from '../utils/askResolver';
import { askBusinessParamsFromAsk } from './askToBusiness';
import { SEQUENCES } from '../motion/motionBudget';
import { refinementChips } from '../utils/askRefinements';

const FIXED_NOW = new Date(2026, 8, 30, 15, 0, 0); // a Wednesday, 3 PM local
jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());
const at = (hours) => new Date(Date.now() + hours * 3600 * 1000).toISOString();
const g = (id, extra = {}) => ({ id, title: `Plan ${id}`, interest_tag: 'Live Music', scheduled_at: at(3), capacity: null, approvedCount: 0, ...extra });
const LIST = [g('tonight'), g('tomorrow', { scheduled_at: at(24) }), g('later', { scheduled_at: at(72) })];
const payloads = () => supabase.rpc.mock.calls.map((c) => c[1].snapshot);
const pieces = (s) => understoodPieces(s.classifyResult, s.typedText);
const ids = (s) => s.items.filter((i) => i.type === 'gathering').map((i) => i.id).sort();
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

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

const TEXT = 'live music tonight at 7 for 4 people';
const CLASSIFY = { intent: 'gathering', category: 'Live Music', dateWindow: 'tonight', partySize: 4, attributes: [] };

describe('changing a chip re-runs the same ask in place with the chosen value', () => {
  it('WHEN Tonight -> Tomorrow: results follow the new day, the words\' "tonight" is not read again, no AI call', async () => {
    const s = await firstSearch(CLASSIFY, TEXT);
    expect(ids(s)).toEqual(['tonight']);
    supabase.rpc.mockClear();
    classifyCreateRequest.mockClear();
    const r = await refineTypedAsk('home', s, 'understood_when', 'tomorrow');
    expect(ids(r)).toEqual(['tomorrow']);
    expect(r.typedText).toBe(TEXT);
    expect(r.classifyResult).toMatchObject({ category: 'Live Music', dateWindow: 'tomorrow', partySize: 4, changedUnderstood: ['when'] });
    expect(pieces(r)).toEqual([{ key: 'what', category: 'Live Music' }, { key: 'when', window: 'tomorrow' }, { key: 'people', count: 4 }]);
    const p = payloads()[0];
    expect(p).toMatchObject({ refinement_key: 'understood_when', refinement_action: 'applied', parent_snapshot_id: s.shown.snapshotId, submission_id: 'sub-1' });
    expect(p.interpretation.date_window).toBe('tomorrow');
    expect(classifyCreateRequest).not.toHaveBeenCalled();
  });

  it('People 4 -> 6: the chip and the recorded interpretation read 6; the time stays', async () => {
    const s = await firstSearch(CLASSIFY, TEXT);
    const r = await refineTypedAsk('home', s, 'understood_people', 6);
    expect(pieces(r)).toContainEqual({ key: 'people', count: 6 });
    expect(pieces(r)).toContainEqual({ key: 'when', window: 'tonight' });
    expect(ids(r)).toEqual(['tonight']);
    expect(payloads().at(-1)).toMatchObject({ refinement_key: 'understood_people', refinement_action: 'applied' });
    expect(payloads().at(-1).interpretation.party_size).toBe(6);
  });

  it('a changed chip can still be removed, and the change is forgotten', async () => {
    const s = await firstSearch(CLASSIFY, TEXT);
    const changed = await refineTypedAsk('home', s, 'understood_people', 6);
    const r = await refineTypedAsk('home', changed, 'understood_people');
    expect(pieces(r).map((p) => p.key)).toEqual(['what', 'when']);
    expect(r.classifyResult).toMatchObject({ partySize: null, removedUnderstood: ['people'], changedUnderstood: [] });
  });
});

describe('the corrected value carries into Create and Ask Nearby Businesses', () => {
  const r = resolveAsk(TEXT);
  const base = { ...toClassification(r), dateWindow: 'tonight' };
  const changed = changeUnderstoodPiece(changeUnderstoodPiece(base, 'when', 'tomorrow'), 'people', 6);

  test('AskBusiness: the chosen day and People, never the old reading; the words\' 7 PM belonged to the old day', () => {
    const before = askBusinessParamsFromAsk({ classifyResult: base, typedText: TEXT });
    expect(before).toMatchObject({ prefillDateWindow: 'tonight', prefillPartySize: 4, prefillStartMinutes: 19 * 60 });
    const after = askBusinessParamsFromAsk({ classifyResult: changed, typedText: TEXT });
    expect(after).toMatchObject({ prefillDateWindow: 'tomorrow', prefillPartySize: 6, prefillStartMinutes: null });
    expect(JSON.stringify(after.carriedSummary)).toMatch(/6/);
    expect(JSON.stringify(after.carriedSummary)).not.toMatch(/"4"|\b4 people/);
  });

  test('a People change alone keeps the stated clock time', () => {
    const p = askBusinessParamsFromAsk({ classifyResult: changeUnderstoodPiece(base, 'people', 6), typedText: TEXT });
    expect(p).toMatchObject({ prefillDateWindow: 'tonight', prefillPartySize: 6, prefillStartMinutes: 19 * 60 });
  });

  test('Create: the chosen when and People; a window Create has no preset for is left for Create to ask', () => {
    expect(createParamsFromAsk(r, TEXT, base)).toMatchObject({ quickStartWhenPreset: 'tonight', quickStartPartySize: 4 });
    expect(createParamsFromAsk(r, TEXT, changed)).toMatchObject({ quickStartWhenPreset: 'tomorrow', quickStartPartySize: 6 });
    const weekend = createParamsFromAsk(r, TEXT, changeUnderstoodPiece(base, 'when', 'weekend'));
    expect(weekend.quickStartWhenPreset).toBeUndefined();
  });
});

describe('the rule', () => {
  test('choices are the existing windows and a headcount list (the current count always included)', () => {
    expect(understoodChoices({ key: 'when', window: 'tonight' })).toEqual(['now', 'today', 'tonight', 'tomorrow', 'weekend']);
    expect(understoodChoices({ key: 'people', count: 4 })).toEqual(UNDERSTOOD_PEOPLE_CHOICES);
    expect(understoodChoices({ key: 'people', count: 20 })).toContain(20);
    for (const key of ['what', 'where', 'who']) expect(understoodChoices({ key })).toEqual([]);
  });
  test('only WHEN and People change, only to a valid new value', () => {
    const c = { dateWindow: 'tonight', partySize: 4, category: 'Coffee' };
    expect(changeUnderstoodPiece(c, 'when', 'someday')).toEqual(c);
    expect(changeUnderstoodPiece(c, 'when', 'tonight')).toEqual(c);
    expect(changeUnderstoodPiece(c, 'people', 0)).toEqual(c);
    expect(changeUnderstoodPiece(c, 'what', 'Bowling')).toEqual(c);
    expect(changeUnderstoodPiece(c, 'people', 6)).toEqual({ ...c, partySize: 6, changedUnderstood: ['people'] });
  });
});

describe('wiring', () => {
  const comp = read('components/AskUnderstoodChips.js');
  test('Home and Discover pass onChange through the same refine handler', () => {
    for (const f of ['screens/HomeScreen.js', 'screens/DiscoverHubScreen.js']) {
      expect(read(f)).toMatch(/onChange=\{canRefine\([a-zA-Z]+\.classifyResult\) \? \(piece, value\) => handleIntentRefine\(`understood_\$\{piece\}`, value\) : null\}/);
    }
  });
  test('changeable only with both handlers, only WHEN / People; quiet (no coral), no motion on the choices row', () => {
    expect(comp).toMatch(/removable && typeof onChange === 'function' && UNDERSTOOD_CHANGEABLE\.includes\(p\.key\)/);
    expect(comp).not.toMatch(/colors\.primary/);
    const row = comp.slice(comp.indexOf('{open && ('));
    expect(row).not.toMatch(/Animated/);
  });
  test('the one new screen-reader string exists in all 11 languages', () => {
    expect((read('i18n/ui/discover.js').match(/understoodTapChange: '\{label\}/g) || []).length).toBe(11);
    expect(comp).toMatch(/t\('ui\.discover\.understoodTapChange', \{ label: labels\[i\] \}\)/);
  });
});
