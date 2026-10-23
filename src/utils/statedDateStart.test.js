// Owner (2026-10-23, follow-up to named weekdays): explicit calendar dates and "today" carry like a named weekday, from the ONE
// shared reading (constants/clockWindow.js statedDateFromText -> utils/askUnderstood.js statedCalendarDay / statedWhenDay).
// Decisions: month NAMES only ("November 4", "4 November", "Nov 4th", ", 2027"); a number-only date ("11/4") is never read;
// no year = this year's if not past, else next year's only within 6 months, else none; a stated year is kept; an invalid date,
// a weekday that is not that date's, or tonight/tomorrow naming another day = no day at all (never resolved silently).
// Against the real resolver (AI off), the way Discover/Home hand an ask to Create and Ask Nearby Businesses.
jest.mock('../services/intentOutcomes', () => ({ recordIntentSelection: jest.fn() }));
import { resolveAsk, toClassification, createParamsFromAsk } from './askResolver';
import { understoodPieces, understoodChoices, changeUnderstoodPiece, removeUnderstoodPiece, upcomingWeekdayKeys } from './askUnderstood';
import { displayWeekdayDate } from '../i18n/display';
import fs from 'fs';
import path from 'path';
import { createStartFromAsk } from './createStartTime';
import { askBusinessParamsFromAsk } from '../services/askToBusiness';
import { statedDateFromText, namedDayFromText, dateAnchorFromText } from '../constants/clockWindow';

const FRI_10AM = new Date(2026, 9, 23, 10, 0, 0); // Friday Oct 23 2026, 10 AM local
jest.useFakeTimers({ now: FRI_10AM });
afterEach(() => jest.setSystemTime(FRI_10AM));
afterAll(() => jest.useRealTimers());

const ymd = (d) => (d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : null);
const said = (text, now = FRI_10AM) => ymd(statedDateFromText(text, now));
const ask = (text) => { const r = resolveAsk(text, null); return { r, c: toClassification(r, text), text }; };
const create = ({ r, c, text }, current = c) => {
  const params = createParamsFromAsk(r, text, current);
  return { ...params, ...createStartFromAsk(current, text, params.quickStartWhenPreset) };
};
const stamp = (p) => { const d = p.quickStartWhenISO ? new Date(p.quickStartWhenISO) : null; return d ? `${ymd(d)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : null; };
const biz = (a, classifyResult = a.c) => askBusinessParamsFromAsk({ classifyResult, typedText: a.text });

describe('the explicit-date rule', () => {
  test('owner table: next year only when soon, else none; today when said today', () => {
    const DEC_20 = new Date(2026, 11, 20, 9, 0);
    expect(said('coffee january 5', DEC_20)).toBe('2027-1-5');
    expect(said('coffee march 15', DEC_20)).toBe('2027-3-15');
    expect(said('coffee june 21', DEC_20)).toBeNull(); // more than 6 months ahead
    expect(said('coffee october 3')).toBeNull(); // passed: asked, never moved to next October
    expect(said('coffee november 4')).toBe('2026-11-4');
    expect(said('coffee october 23')).toBe('2026-10-23');
  });
  test('every month-name form reads the same day; a stated year is kept', () => {
    for (const t of ['nov 4', 'Nov. 4th', 'november 4th', '4 november', 'the 4th of november', 'on the 4th of Nov', 'wednesday, november 4']) {
      expect(said(`coffee ${t}`)).toBe('2026-11-4');
    }
    expect(said('coffee november 4, 2027')).toBe('2027-11-4');
    expect(said('coffee january 5 2027')).toBe('2027-1-5');
    expect(said('coffee october 3 2026')).toBeNull(); // a past year-date stays past
  });
  test('none: number-only dates, invalid days, a different weekday, two dates, another day named', () => {
    for (const t of ['11/4', '4/11', '11/4/2026', 'friday 10/30', 'february 30', 'november 31', 'thursday november 4',
      'november 4 or november 5', 'tonight november 4', 'tomorrow november 4', 'this weekend november 4', 'this friday october 30']) {
      expect(said(`coffee ${t}`)).toBeNull();
    }
    expect(said('coffee tomorrow october 24')).toBe('2026-10-24'); // consistent: tomorrow IS Oct 24
    expect(said('coffee this friday october 23')).toBe('2026-10-23');
    expect(said('coffee next friday october 30')).toBe('2026-10-30'); // next Friday IS Oct 30
  });
  test('a number after a month word that is a count, clock or distance is not a day', () => {
    for (const t of ['coffee may 4 people', 'we may 3 friends', 'run march 5 miles', 'coffee nov 4:30']) expect(said(t)).toBeNull();
  });
  test('weekdays keep their completed rule; abbreviations and recurring days stay unread', () => {
    expect(ymd(namedDayFromText('pickleball friday'))).toBe('2026-10-23');
    expect(ymd(namedDayFromText('pickleball next wednesday'))).toBe('2026-10-28');
    for (const t of ['pickleball sat', 'pickleball fri at 2 pm', 'pickleball fridays']) expect(said(t)).toBeNull();
    expect(namedDayFromText('coffee wednesday, november 4')).toBeNull(); // the date rule owns it
  });
  test('search anchors on the same date (clock windows, needs, weather)', () => {
    expect(dateAnchorFromText('coffee november 4 after 7').dates.map(ymd)).toEqual(['2026-11-4']);
    expect(dateAnchorFromText('coffee 11/4 after 7')).toBeNull();
  });
});

describe('Create and Ask Nearby Businesses get the date', () => {
  test('"Coffee November 4 at 2 PM" = Nov 4 2 PM in Create; Nov 4 + 2 PM in AskBusiness', () => {
    const a = ask('Coffee November 4 at 2 PM');
    expect(create(a).quickStartWhenPreset).toBe('custom');
    expect(stamp(create(a))).toBe('2026-11-4 14:00');
    const b = biz(a);
    expect(b.prefillDateWindow).toBe('pick_date');
    expect(ymd(new Date(b.prefillPickedDateISO))).toBe('2026-11-4');
    expect(b.prefillStartMinutes).toBe(14 * 60);
  });
  test('a date without a time carries the day only; "at 9" offers both readings', () => {
    const p = create(ask('coffee november 4'));
    expect(p.quickStartDateISO).toBe('2026-11-04');
    expect(p.quickStartWhenISO).toBeUndefined();
    const q = create(ask('coffee november 4 at 9'));
    expect(q.quickStartDateISO).toBe('2026-11-04');
    expect(q.quickStartTimeChoices).toEqual([9 * 60, 21 * 60]);
    expect(create(ask('coffee november 4 after 7')).quickStartWhenISO).toBeUndefined(); // a window is never a start
  });
  test('"Today at 3 PM" carries into Create; a past time today carries nothing', () => {
    expect(stamp(create(ask('coffee today at 3 pm')))).toBe('2026-10-23 15:00');
    expect(create(ask('coffee today at 3 pm')).quickStartWhenPreset).toBe('custom');
    const past = create(ask('coffee today at 9 am'));
    expect(past.quickStartWhenISO).toBeUndefined();
    expect(past.quickStartDateISO).toBeUndefined();
    expect(stamp(create(ask('coffee october 23 at 3 pm')))).toBe('2026-10-23 15:00');
    expect(create(ask('coffee october 23 at 9 am')).quickStartWhenISO).toBeUndefined();
  });
  test('a past time on a stated date carries neither day nor time to AskBusiness', () => {
    const b = biz(ask('coffee october 23 at 9 am'));
    expect(b.prefillPickedDateISO).toBeUndefined();
    expect(b.prefillStartMinutes ?? null).toBeNull();
  });
  test('an unreadable or contradicting date carries no day anywhere', () => {
    for (const t of ['coffee 11/4 at 2 pm', 'coffee tonight november 4', 'coffee thursday november 4', 'coffee october 3']) {
      const a = ask(t);
      const p = create(a);
      expect([t, p.quickStartWhenPreset ?? null, p.quickStartWhenISO ?? null, p.quickStartDateISO ?? null]).toEqual([t, null, null, null]);
      expect([t, biz(a).prefillPickedDateISO ?? null]).toEqual([t, null]);
      expect([t, understoodPieces(a.c, t).some((x) => x.key === 'when')]).toEqual([t, false]);
    }
  });
});

describe('the WHEN chip shows the date and corrects it in place', () => {
  test('a weekday or a date is one WHEN chip with its date; the choices are the existing windows, none current', () => {
    const fri = ask('pickleball friday');
    expect(understoodPieces(fri.c, fri.text).find((p) => p.key === 'when')).toEqual({ key: 'when', date: '2026-10-23' });
    const sat = ask('pickleball saturday'); // a named Saturday is its date, not "This weekend"
    expect(understoodPieces(sat.c, sat.text).find((p) => p.key === 'when')).toEqual({ key: 'when', date: '2026-10-24' });
    const nov = ask('coffee november 4');
    const piece = understoodPieces(nov.c, nov.text).find((p) => p.key === 'when');
    expect(piece).toEqual({ key: 'when', date: '2026-11-04' });
    expect(understoodChoices(piece)).toEqual(['now', 'today', 'tonight', 'tomorrow', 'weekend', ...upcomingWeekdayKeys()]);
  });
  test('changing it replaces the date everywhere and drops the clock; removing it carries no day', () => {
    const a = ask('pickleball saturday at 2 pm');
    const changed = changeUnderstoodPiece(a.c, 'when', 'tomorrow', a.text);
    expect(understoodPieces(changed, a.text).find((p) => p.key === 'when')).toEqual({ key: 'when', window: 'tomorrow' });
    expect(changeUnderstoodPiece(a.c, 'when', 'weekend', a.text).dateWindow).toBe('weekend'); // already 'weekend' underneath: still a change
    const p = create(a, changed);
    expect(p.quickStartWhenPreset).toBe('tomorrow');
    expect(p.quickStartWhenISO ?? null).toBeNull(); // a changed day drops the words' clock (idea "307")
    expect(biz(a, changed).prefillPickedDateISO).toBeUndefined();
    const removed = removeUnderstoodPiece(a.c, 'when');
    expect(understoodPieces(removed, a.text).some((x) => x.key === 'when')).toBe(false);
    expect(create(a, removed).quickStartWhenISO ?? null).toBeNull();
  });
});

describe('weekday-to-weekday correction on the date chip (owner 2026-10-23)', () => {
  test('the date chip offers Monday-Sunday as their upcoming dates (today included), a window chip keeps its fixed list', () => {
    expect(upcomingWeekdayKeys()).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29']);
    const tonight = ask('coffee tonight');
    expect(understoodChoices(understoodPieces(tonight.c, tonight.text).find((p) => p.key === 'when'))).toEqual(['now', 'today', 'tonight', 'tomorrow', 'weekend']);
  });
  test('Friday at 2 PM -> Saturday: the chip, Create and Ask Nearby Businesses all get Saturday, and the 2 PM is cleared', () => {
    const a = ask('pickleball friday at 2 pm');
    const c = changeUnderstoodPiece(a.c, 'when', '2026-10-24', a.text);
    expect(c.changedUnderstood).toContain('when');
    expect(c.dateWindow).toBe('weekend'); // this weekend's Saturday, like a typed "Saturday"
    expect(understoodPieces(c, a.text).find((p) => p.key === 'when')).toEqual({ key: 'when', date: '2026-10-24' });
    expect(understoodPieces(c, a.text).some((p) => p.key === 'clock')).toBe(false);
    const p = create(a, c);
    expect(p.quickStartWhenPreset).toBe('custom');
    expect(p.quickStartDateISO).toBe('2026-10-24');
    expect(p.quickStartWhenISO).toBeUndefined(); // the time is asked, never the old 2 PM
    expect(p.quickStartTimeChoices).toBeUndefined();
    const b = biz(a, c);
    expect(ymd(new Date(b.prefillPickedDateISO))).toBe('2026-10-24');
    expect(b.prefillStartMinutes ?? null).toBeNull();
  });
  test('a weekday that is not this weekend has no window; "at 9" choices are dropped with the change', () => {
    const a = ask('tennis saturday at 9');
    const c = changeUnderstoodPiece(a.c, 'when', '2026-10-27', a.text);
    expect(c.dateWindow).toBeNull();
    const p = create(a, c);
    expect(p.quickStartDateISO).toBe('2026-10-27');
    expect(p.quickStartTimeChoices).toBeUndefined();
  });
  test('only an offered date is accepted; the same day is no change; a window or ✕ afterwards clears the picked date', () => {
    const a = ask('pickleball friday');
    expect(changeUnderstoodPiece(a.c, 'when', '2026-11-20', a.text)).toEqual(a.c); // not one of the 7 upcoming days
    expect(changeUnderstoodPiece(a.c, 'when', '2026-10-23', a.text)).toEqual(a.c); // already Friday
    const sat = changeUnderstoodPiece(a.c, 'when', '2026-10-24', a.text);
    const tomorrow = changeUnderstoodPiece(sat, 'when', 'tomorrow', a.text);
    expect(tomorrow.whenDate).toBeUndefined();
    expect(understoodPieces(tomorrow, a.text).find((p) => p.key === 'when')).toEqual({ key: 'when', window: 'tomorrow' });
    const removed = removeUnderstoodPiece(sat, 'when');
    expect(removed.whenDate).toBeUndefined();
    expect(understoodPieces(removed, a.text).some((p) => p.key === 'when')).toBe(false);
    expect(create(a, removed).quickStartDateISO).toBeUndefined();
  });
  test('an explicit date chip can be moved to a weekday the same way', () => {
    const a = ask('coffee november 4 at 2 pm');
    const c = changeUnderstoodPiece(a.c, 'when', '2026-10-28', a.text);
    expect(create(a, c).quickStartDateISO).toBe('2026-10-28');
    expect(create(a, c).quickStartWhenISO).toBeUndefined();
  });
});

describe('the year shows only for another calendar year', () => {
  test('shared format: "Tue, Jan 5, 2027" with the year, "Wed, Nov 4" without', () => {
    expect(displayWeekdayDate(new Date(2027, 0, 5), 'en', { withYear: true })).toMatch(/Jan.*5.*2027/);
    expect(displayWeekdayDate(new Date(2026, 10, 4), 'en')).not.toMatch(/2026/);
    expect(displayWeekdayDate(new Date(2027, 0, 5), 'es', { withYear: true })).toMatch(/2027$/);
  });
  test('the chip asks for the year exactly when the date is not in the current year', () => {
    const src = fs.readFileSync(path.join(__dirname, '../components/AskUnderstoodChips.js'), 'utf8');
    expect(src).toMatch(/withYear: d\.getFullYear\(\) !== new Date\(\)\.getFullYear\(\)/);
    expect(src).toMatch(/p\.date \? dayText\(p\.date\)/);
  });
});

describe('a time kept while the date is asked', () => {
  test('"coffee 11/4 at 2 PM": no day guessed, Ask Nearby Businesses keeps 2 PM in its Time field', () => {
    const b = biz(ask('coffee 11/4 at 2 pm'));
    expect(b.prefillPickedDateISO).toBeUndefined();
    expect(b.prefillStartMinutes).toBe(14 * 60);
  });
});
