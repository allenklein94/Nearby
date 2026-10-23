// Owner (2026-10-23): a named weekday and an exact time carry from an ask into Create (and the day into Ask Nearby
// Businesses), from the ONE shared reading (constants/clockWindow.js namedDayFromText -> utils/askUnderstood.js statedNamedDay),
// never a parser in Create. Rule: "Friday" = the next Friday within 7 days, today included; "this Friday" = this Monday-Sunday
// week's (past = none); "next Friday" = the following Monday-Sunday week's. No time / a window / "at 9" = the day only, the time
// asked ("at 9" offers 9 AM and 9 PM, never picks one); an exact time already past = nothing carried (never rolled a week).
// Against the real resolver (AI off), the way Discover/Home hand an ask to Create.
jest.mock('../services/intentOutcomes', () => ({ recordIntentSelection: jest.fn() }));
import fs from 'fs';
import path from 'path';
import { resolveAsk, toClassification, createParamsFromAsk } from './askResolver';
import { understoodPieces, understoodChoices, changeUnderstoodPiece, removeUnderstoodPiece } from './askUnderstood';
import { createStartFromAsk } from './createStartTime';
import { askBusinessParamsFromAsk } from '../services/askToBusiness';
import { namedDayFromText, dateAnchorFromText, pointClockChoicesFromText } from '../constants/clockWindow';
import { stepProblems } from './createGatheringValidation';

const WED_3PM = new Date(2026, 8, 30, 15, 0, 0); // Wednesday Sep 30 2026, 3 PM local
jest.useFakeTimers({ now: WED_3PM });
afterEach(() => jest.setSystemTime(WED_3PM));
afterAll(() => jest.useRealTimers());

const ask = (text) => { const r = resolveAsk(text, null); return { r, c: toClassification(r, text), text }; };
const create = ({ r, c, text }, current = c) => {
  const params = createParamsFromAsk(r, text, current);
  return { ...params, ...createStartFromAsk(current, text, params.quickStartWhenPreset) };
};
const md = (d) => (d ? `${d.getMonth() + 1}/${d.getDate()}` : null);
const startOf = (p) => (p.quickStartWhenISO ? new Date(p.quickStartWhenISO) : null);
const stamp = (d) => (d ? `${md(d)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : null);
const biz = (a, classifyResult = a.c) => askBusinessParamsFromAsk({ classifyResult, typedText: a.text });

describe('the weekday rule (shared, deterministic, local date)', () => {
  test('all seven weekdays = the next one within 7 days, today included', () => {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    expect(days.map((d) => md(namedDayFromText(`pickleball ${d}`)))).toEqual(['10/5', '10/6', '9/30', '10/1', '10/2', '10/3', '10/4']);
  });
  test('"this X" = this Monday-Sunday week (past = none); "next X" = the following week', () => {
    expect(namedDayFromText('this monday')).toBeNull(); // Mon Sep 28 has passed
    expect(md(namedDayFromText('this wednesday'))).toBe('9/30');
    expect(md(namedDayFromText('this friday'))).toBe('10/2');
    expect(md(namedDayFromText('this sunday'))).toBe('10/4');
    expect(md(namedDayFromText('next monday'))).toBe('10/5');
    expect(md(namedDayFromText('next wednesday'))).toBe('10/7');
    expect(md(namedDayFromText('next sunday'))).toBe('10/11');
  });
  test('owner examples: on Monday Oct 26, "Wednesday" = Oct 28 and "next Wednesday" = Nov 4; Saturday said on a Sunday = the coming one', () => {
    const MON = new Date(2026, 9, 26, 9, 0);
    expect(md(namedDayFromText('volleyball wednesday', MON))).toBe('10/28');
    expect(md(namedDayFromText('volleyball next wednesday', MON))).toBe('11/4');
    expect(md(namedDayFromText('pickleball saturday', new Date(2026, 9, 25, 10, 0)))).toBe('10/31');
  });
  test('no single day = none: two weekdays, conflicting modifiers, an explicit date, a contradicting tonight/tomorrow', () => {
    for (const t of ['saturday or sunday', 'friday and saturday', 'this friday or next friday', 'friday november 6',
      'saturday, oct 3', 'friday 10/2', 'tomorrow friday', 'tonight saturday', 'sat at 2 pm', 'fridays at 6 pm']) {
      expect(namedDayFromText(t)).toBeNull();
    }
    expect(md(namedDayFromText('tomorrow thursday'))).toBe('10/1'); // consistent: tomorrow IS Thursday
  });
  test('an hour without AM/PM gives both readings, never one; a stated or 1-7 hour is not ambiguous', () => {
    expect(pointClockChoicesFromText('saturday at 9')).toEqual([9 * 60, 21 * 60]);
    expect(pointClockChoicesFromText('saturday at 10:30')).toEqual([10 * 60 + 30, 22 * 60 + 30]);
    for (const t of ['saturday at 9 pm', 'saturday at 7', 'saturday at noon', 'saturday after 9', 'saturday at 19:00']) {
      expect(pointClockChoicesFromText(t)).toBeNull();
    }
  });
  test('search uses the same day: "coffee friday after 7" anchors to Friday', () => {
    expect(dateAnchorFromText('coffee friday after 7').dates.map(md)).toEqual(['10/2']);
    expect(dateAnchorFromText('coffee next wednesday before 9').dates.map(md)).toEqual(['10/7']);
    expect(dateAnchorFromText('coffee this monday after 7')).toBeNull();
  });
});

describe('Create gets the day and the exact time together', () => {
  test('"Pickleball Saturday at 2 PM" = Saturday 2 PM, a picked date', () => {
    const p = create(ask('Pickleball Saturday at 2 PM'));
    expect(p.quickStartWhenPreset).toBe('custom');
    expect(stamp(startOf(p))).toBe('10/3 14:00');
    expect(p.quickStartDateISO).toBeUndefined();
  });
  test('"Coffee Friday at 9 AM" = Friday 9 AM; "Volleyball next Wednesday at 6 PM" = Oct 7 6 PM', () => {
    expect(stamp(startOf(create(ask('Coffee Friday at 9 AM'))))).toBe('10/2 9:00');
    expect(stamp(startOf(create(ask('Volleyball next Wednesday at 6 PM'))))).toBe('10/7 18:00');
  });
  test('every weekday with an exact time', () => {
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    expect(days.map((d) => stamp(startOf(create(ask(`tennis ${d} at 6 pm`))))))
      .toEqual(['10/5 18:00', '10/6 18:00', '9/30 18:00', '10/1 18:00', '10/2 18:00', '10/3 18:00', '10/4 18:00']);
  });
  test('"Dinner tomorrow at 7 PM" keeps its own Tomorrow path', () => {
    const p = create(ask('Dinner tomorrow at 7 PM'));
    expect(p.quickStartWhenPreset).toBe('tomorrow');
    expect(stamp(startOf(p))).toBe('10/1 19:00');
  });
});

describe('the day without a time: the day carries, the time is asked, nothing is invented', () => {
  test('"Pickleball Saturday" = Saturday, no time', () => {
    const p = create(ask('Pickleball Saturday'));
    expect(p).toMatchObject({ quickStartWhenPreset: 'custom', quickStartDateISO: '2026-10-03' });
    expect(p.quickStartWhenISO).toBeUndefined();
    expect(p.quickStartTimeChoices).toBeUndefined();
  });
  test('"Saturday at 9" = Saturday, 9 AM or 9 PM offered, neither picked', () => {
    const p = create(ask('tennis saturday at 9'));
    expect(p).toMatchObject({ quickStartDateISO: '2026-10-03', quickStartTimeChoices: [9 * 60, 21 * 60] });
    expect(p.quickStartWhenISO).toBeUndefined();
  });
  test('"after 7" / "before 9" are constraints: the day carries, never a start', () => {
    for (const t of ['coffee friday after 7', 'drinks friday before 9 pm']) {
      const p = create(ask(t));
      expect(p.quickStartDateISO).toBe('2026-10-02');
      expect(p.quickStartWhenISO).toBeUndefined();
      expect(p.quickStartTimeChoices).toBeUndefined();
    }
  });
  test('"Volleyball next Wednesday" = Oct 7, time asked', () => {
    expect(create(ask('Volleyball next Wednesday')).quickStartDateISO).toBe('2026-10-07');
  });
  test('"Coffee this weekend" still carries no day or time (Create asks)', () => {
    const p = create(ask('Coffee this weekend'));
    expect(p.quickStartWhenPreset).toBeUndefined();
    expect(p.quickStartDateISO).toBeUndefined();
    expect(p.quickStartWhenISO).toBeUndefined();
  });
  test('Create cannot leave When with a day and no time (the existing "pick a time" rule)', () => {
    const base = { whenPreset: 'custom', scheduledAt: new Date(2026, 9, 3, 12, 0), now: WED_3PM.getTime() };
    expect(stepProblems('whenWhere', { ...base, timeNeeded: true, locationMode: 'near_me' })).toEqual(expect.arrayContaining([{ step: 'whenWhere', field: 'time', code: 'pickTime' }]));
    expect(stepProblems('whenWhere', { ...base, timeNeeded: false, locationMode: 'near_me' }).filter((p) => p.field === 'time')).toEqual([]);
  });
});

describe('past dates and times are never rolled forward', () => {
  test('"Wednesday at 9 AM" said Wednesday 3 PM carries nothing to Create or Ask Nearby Businesses', () => {
    const a = ask('coffee wednesday at 9 am');
    const p = create(a);
    expect(p.quickStartWhenISO).toBeUndefined();
    expect(p.quickStartDateISO).toBeUndefined();
    expect(biz(a).prefillDateWindow).not.toBe('pick_date');
    expect(biz(a).prefillStartMinutes).toBeNull();
  });
  test('"Wednesday at 9 PM" said Wednesday 3 PM = today 9 PM', () => {
    expect(stamp(startOf(create(ask('coffee wednesday at 9 pm'))))).toBe('9/30 21:00');
  });
  test('"Wednesday at 9" said Wednesday 3 PM offers only the 9 PM still ahead', () => {
    expect(create(ask('coffee wednesday at 9')).quickStartTimeChoices).toEqual([21 * 60]);
  });
  test('"this Monday" said Wednesday carries nothing (it has passed)', () => {
    const p = create(ask('pickleball this monday at 6 pm'));
    expect(p.quickStartWhenISO).toBeUndefined();
    expect(p.quickStartDateISO).toBeUndefined();
  });
});

describe('corrections on the chips', () => {
  const need = 'I need a car wash saturday at 7';
  test('switching 7 PM to 7 AM gives Create Saturday 7 AM and Ask Nearby Businesses the same day and time', () => {
    const a = ask(need);
    expect(stamp(startOf(create(a)))).toBe('10/3 19:00');
    const piece = understoodPieces(a.c, need).find((x) => x.key === 'clock');
    const am = understoodChoices(piece).find((x) => x.at === 7 * 60);
    const changed = changeUnderstoodPiece(a.c, 'clock', am, need);
    expect(stamp(startOf(create(a, changed)))).toBe('10/3 7:00');
    const b = biz(a, changed);
    expect(b).toMatchObject({ prefillDateWindow: 'pick_date', prefillPickedDateISO: '2026-10-03T12:00:00.000Z', prefillStartMinutes: 7 * 60 });
  });
  test('removing the clock chip keeps the day and asks the time', () => {
    const a = ask(need);
    const p = create(a, removeUnderstoodPiece(a.c, 'clock'));
    expect(p.quickStartDateISO).toBe('2026-10-03');
    expect(p.quickStartWhenISO).toBeUndefined();
    expect(p.quickStartTimeChoices).toBeUndefined();
  });
  test('changing the day (This weekend -> Tonight) drops Saturday AND the old clock time', () => {
    const a = ask(need);
    const p = create(a, changeUnderstoodPiece(a.c, 'when', 'tonight', need));
    expect(p.quickStartWhenPreset).toBe('tonight');
    expect(p.quickStartWhenISO).toBeUndefined();
    expect(p.quickStartDateISO).toBeUndefined();
  });
  test('removing WHEN carries neither day nor time, to Create or Ask Nearby Businesses', () => {
    const a = ask(need);
    const removed = removeUnderstoodPiece(a.c, 'when');
    const p = create(a, removed);
    expect(p.quickStartWhenPreset).toBeUndefined();
    expect(p.quickStartDateISO).toBeUndefined();
    expect(biz(a, removed).prefillDateWindow).toBeNull();
  });
});

describe('Ask Nearby Businesses gets the same day', () => {
  test('"Pickleball Saturday at 2 PM" = Saturday Oct 3 picked + 2 PM; the carried card shows no "This weekend" row', () => {
    const a = ask('Pickleball Saturday at 2 PM');
    const b = biz(a);
    expect(b).toMatchObject({ prefillDateWindow: 'pick_date', prefillPickedDateISO: '2026-10-03T12:00:00.000Z', prefillStartMinutes: 14 * 60 });
    expect(b.carriedSummary.some((r) => r.layer === 'time')).toBe(false);
  });
  test('Tonight / Tomorrow / this weekend keep their own day', () => {
    expect(biz(ask('coffee tonight at 8 pm')).prefillDateWindow).toBe('tonight');
    expect(biz(ask('coffee tomorrow')).prefillDateWindow).toBe('tomorrow');
    expect(biz(ask('coffee this weekend')).prefillDateWindow).toBe('weekend');
  });
});

describe('wiring', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  test('Create reads quickStartDateISO / quickStartTimeChoices and keeps the day unpicked-time until chosen', () => {
    const s = read('screens/CreateGatheringScreen.js');
    expect(s).toMatch(/localDateFromKey\(route\.params\?\.quickStartDateISO\)/);
    expect(s).toMatch(/setTimeNeeded\(true\)/);
    expect(s).toMatch(/title, interestTag, scheduledAt, whenPreset, timeNeeded,/);
    expect(s).not.toMatch(/namedDayFromText|WEEKDAYS/); // no date parser in Create
  });
  test('one reading: Create and Ask Nearby Businesses both read statedNamedDay', () => {
    expect(read('utils/createStartTime.js')).toMatch(/statedNamedDay\(classifyResult, typedText, now\)/);
    expect(read('services/askToBusiness.js')).toMatch(/statedNamedDay\(c, typedText\)/);
  });
});
