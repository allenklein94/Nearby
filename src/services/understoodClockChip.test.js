// Owner idea "306" (2026-10-22): the clock time an ask was read as is an understood chip ("After 7 PM") only when the search
// really uses it; it can be removed or switched to the same time AM / PM, the results update in place, and the correction carries
// into Ask Nearby Businesses. Against the REAL resolver with its network edges mocked (the harness of understoodChipChange.test.js).
jest.mock('@react-native-async-storage/async-storage', () => ({}));
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

import fs from 'fs';
import path from 'path';
import { runIntentSearch } from './intentResolver';
import { refineTypedAsk } from './askRefine';
import { recordTypedAsk } from './typedAskAudit';
import { REFINEMENT_KEYS } from '../utils/typedAskAudit';
import { supabase } from './supabase';
import { getNearbyGatherings } from './gatherings';
import { classifyCreateRequest } from './createAssistant';
import { askBusinessParamsFromAsk } from './askToBusiness';
import { understoodPieces, understoodChoices, changeUnderstoodPiece, removeUnderstoodPiece, clockOverride, askClock, flipClock, UNDERSTOOD_CHANGEABLE } from '../utils/askUnderstood';
import { resolveAsk, toClassification, createParamsFromAsk } from '../utils/askResolver';
import { askWeatherWindow } from '../utils/askWeather';

const FIXED_NOW = new Date(2026, 8, 30, 15, 0, 0); // a Wednesday, 3 PM local
jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());
const today = (h) => new Date(2026, 8, 30, h, 0, 0).toISOString();
const g = (id, h) => ({ id, title: `Plan ${id}`, interest_tag: 'Live Music', scheduled_at: today(h), capacity: null, approvedCount: 0 });
// 4 PM sits after 7 AM but before 7 PM; 8 PM sits after both.
const LIST = [g('four', 16), g('eight', 20)];
const payloads = () => supabase.rpc.mock.calls.map((c) => c[1].snapshot);
const clockPiece = (s) => understoodPieces(s.classifyResult, s.typedText).find((p) => p.key === 'clock') ?? null;
const order = (s) => s.items.filter((i) => i.type === 'gathering').map((i) => i.id);
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

const TEXT = 'live music tonight after 7';
const CLASSIFY = { intent: 'gathering', category: 'Live Music', dateWindow: 'tonight', attributes: [] };

describe('the chip shows only a clock time the search really uses', () => {
  test('an anchored window ("tonight after 7") is a chip; the old "Keeping it after…" caption is gone', async () => {
    const s = await firstSearch(CLASSIFY, TEXT);
    expect(clockPiece(s)).toEqual({ key: 'clock', clock: { after: 19 * 60, before: null } });
    expect(String(s.caption ?? s.openEndedNote ?? '')).not.toMatch(/Keeping it/);
    expect(order(s)[0]).toBe('eight');
  });
  test.each([
    ['music after 7', { category: 'Live Music' }], // no day: the window constrains nothing
    ['live music tonight at 7', { category: 'Live Music', dateWindow: 'tonight' }], // a want's "at 7" is not used by search
    ['live music tonight after 9', { category: 'Live Music', dateWindow: 'tonight' }], // a bare 9 is ambiguous: never guessed
  ])('"%s" -> no chip', (text, c) => {
    expect(askClock(c, text)).toBeNull();
  });
  test('a need\'s single time is a chip ("I need a car wash today at 7")', () => {
    expect(askClock({ category: 'Car Wash' }, 'I need a car wash today at 7')).toEqual({ at: 19 * 60 });
  });
});

describe('correcting it re-runs the same ask in place', () => {
  test('After 7 PM -> After 7 AM: results reorder, recorded as understood_clock applied, no AI call', async () => {
    const s = await firstSearch(CLASSIFY, TEXT);
    supabase.rpc.mockClear();
    classifyCreateRequest.mockClear();
    const r = await refineTypedAsk('home', s, 'understood_clock', { after: 7 * 60, before: null });
    expect(r.typedText).toBe(TEXT);
    expect(clockPiece(r)).toEqual({ key: 'clock', clock: { after: 7 * 60, before: null } });
    expect(r.classifyResult.changedUnderstood).toEqual(['clock']);
    expect(order(r)[0]).toBe('four');
    expect(payloads()[0]).toMatchObject({ refinement_key: 'understood_clock', refinement_action: 'applied', parent_snapshot_id: s.shown.snapshotId });
    expect(classifyCreateRequest).not.toHaveBeenCalled();
  });
  test('✕ removes the clock constraint: no chip, the window no longer ranks, recorded as removed', async () => {
    const s = await firstSearch(CLASSIFY, TEXT);
    const r = await refineTypedAsk('home', s, 'understood_clock');
    expect(clockPiece(r)).toBeNull();
    expect(clockOverride(r.classifyResult)).toBeNull();
    expect(r.items.some((i) => /after 7/i.test(JSON.stringify(i.reasons ?? [])))).toBe(false);
    expect(payloads().at(-1)).toMatchObject({ refinement_key: 'understood_clock', refinement_action: 'removed' });
  });
  test('only the same time\'s AM/PM twin is accepted; another hour or a time the search would not use changes nothing', () => {
    const c = { ...CLASSIFY };
    expect(changeUnderstoodPiece(c, 'clock', { after: 8 * 60, before: null }, TEXT)).toEqual(c);
    expect(changeUnderstoodPiece(c, 'clock', { after: 7 * 60, before: null }, 'music after 7')).toEqual(c);
    expect(changeUnderstoodPiece(c, 'clock', { after: 7 * 60, before: null }, TEXT)).toMatchObject({ clockChoice: { after: 7 * 60, before: null }, changedUnderstood: ['clock'] });
  });
  test('choices: the reading and its twin in time order; noon / midnight and a range that would run backwards are remove-only', () => {
    expect(understoodChoices({ key: 'clock', clock: { after: 19 * 60, before: null } })).toEqual([{ after: 7 * 60, before: null }, { after: 19 * 60, before: null }]);
    expect(understoodChoices({ key: 'clock', clock: { at: 12 * 60 } })).toEqual([]);
    expect(flipClock({ after: 11 * 60, before: 14 * 60 })).toBeNull();
    expect(flipClock({ after: 18 * 60, before: 20 * 60 })).toEqual({ after: 6 * 60, before: 8 * 60 });
    expect(UNDERSTOOD_CHANGEABLE).toContain('clock');
  });
  test('a removed or changed WHEN drops the words\' clock too (it belonged to the old day)', () => {
    expect(clockOverride(removeUnderstoodPiece(CLASSIFY, 'when'))).toBeNull();
    expect(clockOverride(changeUnderstoodPiece(CLASSIFY, 'when', 'tomorrow'))).toBeNull();
    expect(clockOverride(CLASSIFY)).toBeUndefined();
  });
  test('the weather window follows the correction', () => {
    expect(askWeatherWindow(TEXT, FIXED_NOW).startMs).toBe(new Date(2026, 8, 30, 19).getTime());
    expect(askWeatherWindow(TEXT, FIXED_NOW, { after: 7 * 60, before: null }).startMs).toBe(FIXED_NOW.getTime()); // 7 AM already past: from now
    expect(askWeatherWindow(TEXT, FIXED_NOW, null).startMs).toBe(new Date(2026, 8, 30, 17).getTime()); // removed: the plain "tonight"
  });
});

describe('the correction carries into Ask Nearby Businesses and Create', () => {
  const NEED = 'I need a car wash today at 7';
  const base = { ...toClassification(resolveAsk(NEED)), category: 'Car Wash', dateWindow: 'today' };
  test('AskBusiness: the words\' 7 PM, the chosen 7 AM, nothing after ✕', () => {
    expect(askBusinessParamsFromAsk({ classifyResult: base, typedText: NEED }).prefillStartMinutes).toBe(19 * 60);
    const am = changeUnderstoodPiece(base, 'clock', { at: 7 * 60 }, NEED);
    expect(askBusinessParamsFromAsk({ classifyResult: am, typedText: NEED }).prefillStartMinutes).toBe(7 * 60);
    expect(askBusinessParamsFromAsk({ classifyResult: removeUnderstoodPiece(base, 'clock'), typedText: NEED }).prefillStartMinutes).toBeNull();
  });
  test('Create carries no clock time from an ask, before or after a correction (its own When step asks)', () => {
    const r = resolveAsk(TEXT);
    const c = { ...toClassification(r), dateWindow: 'tonight' };
    const before = createParamsFromAsk(r, TEXT, c);
    const after = createParamsFromAsk(r, TEXT, changeUnderstoodPiece(c, 'clock', { after: 7 * 60, before: null }, TEXT));
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toMatch(/StartMinutes|startTime|clock/i);
  });
});

describe('wiring', () => {
  const comp = read('components/AskUnderstoodChips.js');
  test('the audit key is allowed on the client and in the migration', () => {
    expect(REFINEMENT_KEYS).toContain('understood_clock');
    const m = read('../supabase/migrations/20270335_understood_clock_chip.sql');
    expect(m).toMatch(/'understood_people', 'understood_clock'\)\);\s+CREATE OR REPLACE/);
    expect(m).toMatch(/'understood_people', 'understood_clock'\) or v_ref_action/);
  });
  test('the chip labels exist in all 11 languages and the chip reuses the existing row (no new picker, no motion, no coral)', () => {
    const d = read('i18n/ui/discover.js');
    for (const k of ['understoodClockAt', 'understoodClockAfter', 'understoodClockBefore', 'understoodClockBetween']) {
      expect((d.match(new RegExp(`${k}: '[^']*\\{(time|from)\\}`, 'g')) || []).length).toBe(11);
    }
    expect(comp).toMatch(/p\.key === 'clock'\) return clockText\(p\.clock\)/);
    expect(comp).not.toMatch(/colors\.primary|DateTimePicker/);
    expect(comp.slice(comp.indexOf('{open && ('))).not.toMatch(/Animated/);
  });
  test('the resolver reads the one override for the window, the need moment and the weather', () => {
    const r = read('services/intentResolver.js');
    expect(r).toMatch(/clock: clockOverride\(classifyResult\)/);
    expect(r).toMatch(/settingByPartnerId: settings, clock \}/);
    expect(r).not.toMatch(/clockWindowCaption\(/);
  });
});
