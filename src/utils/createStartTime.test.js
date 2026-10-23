// Owner (2026-10-23): Create from an ask carries the exact start time the ask established, from the SAME reading the chips and
// Ask Nearby Businesses use (`statedStartMinutes`), never a second reading of the words. A window ("after 7", "before 9") is a
// constraint, never a start; a removed clock chip or a changed/removed WHEN carries none; "at 9" is never guessed. Against the
// real resolver (AI off), the way Discover/Home hand an ask to Create (createAssistant.createFromAsk = these two calls).
jest.mock('../services/intentOutcomes', () => ({ recordIntentSelection: jest.fn() }));
import fs from 'fs';
import path from 'path';
import { resolveAsk, toClassification, createParamsFromAsk } from './askResolver';
import { understoodPieces, understoodChoices, changeUnderstoodPiece, removeUnderstoodPiece, statedStartMinutes } from './askUnderstood';
import { createStartFromAsk } from './createStartTime';
import { askBusinessParamsFromAsk } from '../services/askToBusiness';

const FIXED_NOW = new Date(2026, 8, 30, 15, 0, 0); // a Wednesday, 3 PM local
jest.useFakeTimers({ now: FIXED_NOW });
afterAll(() => jest.useRealTimers());

const ask = (text) => { const r = resolveAsk(text, null); return { r, c: toClassification(r, text), text }; };
const create = ({ r, c, text }, current = c) => {
  const params = createParamsFromAsk(r, text, current);
  return { ...params, ...createStartFromAsk(current, text, params.quickStartWhenPreset) };
};
const at = (p) => (p.quickStartWhenISO ? new Date(p.quickStartWhenISO) : null);
const hm = (d) => (d ? `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : null);

describe('exact times carry into Create', () => {
  test('"Pickleball tomorrow at 7 PM" opens with Tomorrow and 7 PM', () => {
    const p = create(ask('Pickleball tomorrow at 7 PM'));
    expect(p.quickStartWhenPreset).toBe('tomorrow');
    expect(hm(at(p))).toBe('1 19:00');
  });
  test('a bare "at 7" follows the one shared rule (7 PM), same as Ask Nearby Businesses', () => {
    const a = ask('pickleball tomorrow at 7');
    expect(hm(at(create(a)))).toBe('1 19:00');
    expect(askBusinessParamsFromAsk({ classifyResult: a.c, typedText: a.text }).prefillStartMinutes).toBe(19 * 60);
  });
  test('"dinner tonight at 8 pm" keeps Tonight at 8 PM; "yoga tomorrow at 7 am" keeps Tomorrow at 7 AM', () => {
    const p = create(ask('dinner tonight at 8 pm'));
    expect(p.quickStartWhenPreset).toBe('tonight');
    expect(hm(at(p))).toBe('30 20:00');
    const q = create(ask('yoga tomorrow at 7 am'));
    expect(q.quickStartWhenPreset).toBe('tomorrow');
    expect(hm(at(q))).toBe('1 7:00');
  });
});

describe('nothing is invented', () => {
  test('an ambiguous "at 9" carries no time (the day still carries, its default time unchanged)', () => {
    const p = create(ask('pickleball tomorrow at 9'));
    expect(p.quickStartWhenPreset).toBe('tomorrow');
    expect(p.quickStartWhenISO).toBeUndefined();
  });
  test('"after 7 PM" / "before 9 PM" are constraints, never an exact start', () => {
    for (const t of ['coffee tonight after 7 PM', 'drinks tonight before 9 PM']) {
      const a = ask(t);
      expect(statedStartMinutes(a.c, t)).toBeNull();
      expect(create(a).quickStartWhenISO).toBeUndefined();
      expect(create(a).quickStartWhenPreset).toBe('tonight');
    }
  });
  test('a time with no day carries nothing (Create has one date-and-time; its When step asks)', () => {
    const p = create(ask('pickleball at 7 PM'));
    expect(p.quickStartWhenPreset).toBeUndefined();
    expect(p.quickStartWhenISO).toBeUndefined();
  });
  test('a time already past today carries nothing; "Now" never takes a clock time', () => {
    const a = ask('dinner tonight at 8 pm');
    expect(createStartFromAsk(a.c, a.text, 'tonight', new Date(2026, 8, 30, 21, 0, 0))).toEqual({});
    expect(createStartFromAsk(a.c, a.text, 'now')).toEqual({});
    expect(createStartFromAsk(a.c, a.text, null)).toEqual({});
  });
});

describe('corrections on the chips carry exactly', () => {
  const need = 'I need a car wash tomorrow at 7';
  const clockPiece = (c) => understoodPieces(c, need).find((x) => x.key === 'clock');

  test('switching 7 PM to 7 AM gives Create 7 AM (and Ask Nearby Businesses the same)', () => {
    const a = ask(need);
    expect(hm(at(create(a)))).toBe('1 19:00');
    const am = understoodChoices(clockPiece(a.c)).find((x) => x.at === 7 * 60);
    expect(am).toBeDefined();
    const changed = changeUnderstoodPiece(a.c, 'clock', am, need);
    expect(hm(at(create(a, changed)))).toBe('1 7:00');
    expect(askBusinessParamsFromAsk({ classifyResult: changed, typedText: need }).prefillStartMinutes).toBe(7 * 60);
  });
  test('a morning time on Tonight shows as a picked date, never under the Tonight chip', () => {
    const switched = { changedUnderstood: ['clock'], clockChoice: { at: 7 * 60 } };
    const p = createStartFromAsk(switched, 'I need a car wash tonight at 7', 'tonight', new Date(2026, 8, 30, 5, 0, 0));
    expect(p.quickStartWhenPreset).toBe('custom');
    expect(hm(at(p))).toBe('30 7:00');
  });
  test('removing the clock chip carries no time', () => {
    const a = ask(need);
    const removed = removeUnderstoodPiece(a.c, 'clock');
    const p = create(a, removed);
    expect(p.quickStartWhenPreset).toBe('tomorrow');
    expect(p.quickStartWhenISO).toBeUndefined();
  });
  test('changing the day drops the old clock time (idea "307")', () => {
    const a = ask(need);
    const changed = changeUnderstoodPiece(a.c, 'when', 'tonight', need);
    const p = create(a, changed);
    expect(p.quickStartWhenPreset).toBe('tonight');
    expect(p.quickStartWhenISO).toBeUndefined();
  });
  test('removing WHEN carries neither day nor time', () => {
    const a = ask(need);
    const p = create(a, removeUnderstoodPiece(a.c, 'when'));
    expect(p.quickStartWhenPreset).toBeUndefined();
    expect(p.quickStartWhenISO).toBeUndefined();
  });
});

describe('existing carryover is unchanged', () => {
  test('activity, People and Who still come from createParamsFromAsk as before', () => {
    const a = ask('pickleball tomorrow at 7 PM with 3 friends');
    const before = createParamsFromAsk(a.r, a.text, a.c);
    const after = create(a);
    for (const k of ['quickStartTitle', 'quickStartCategory', 'quickStartPartySize', 'quickStartPartyType', 'inferredSummary', 'inferredFromText']) {
      expect(after[k]).toEqual(before[k]);
    }
  });
});

describe('wiring (one reading, every Create entry point)', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  test('createAssistant hands Create createFromAsk = createParamsFromAsk + createStartFromAsk, at every Create navigation', () => {
    const s = read('services/createAssistant.js');
    expect(s).toMatch(/createStartFromAsk\(result, typedText, params\.quickStartWhenPreset\)/);
    expect(s).not.toMatch(/navigate\('CreateGathering', withAsk\(\{? ?\.{0,3}createParamsFromAsk/);
  });
  test('the Create hub uses the same helper', () => {
    expect(read('screens/CreateHubScreen.js')).toMatch(/navigate\('CreateGathering', createFromAsk\(/);
  });
  test('Create honours quickStartWhenISO beside any preset', () => {
    expect(read('screens/CreateGatheringScreen.js')).toMatch(/if \(route\.params\?\.quickStartWhenISO\) \{/);
  });
  test('Ask Nearby Businesses reads the same statedStartMinutes', () => {
    expect(read('services/askToBusiness.js')).toMatch(/statedStartMinutes\(c, typedText\)/);
  });
});
