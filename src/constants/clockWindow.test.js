import { parseClock, clockWindowFromText, dateAnchorFromText, windowFit, applyClockWindowToCandidates, clockWindowCaption, windowSpan, clockLabel } from './clockWindow';

// Wednesday Sep 23 2026, 10:00 local; Saturday is Sep 26, Sunday Sep 27.
const WED = new Date(2026, 8, 23, 10);
const SUN = new Date(2026, 8, 27, 10);
const day = (d) => (d ? `${d.getMonth() + 1}/${d.getDate()}` : null);
const at = (date, h, m = 0) => new Date(2026, 8, date, h, m).toISOString();

describe('reading a clock window from the words', () => {
  it('parses clock times', () => {
    expect(parseClock('3 pm')).toBe(900);
    expect(parseClock('3:30PM')).toBe(930);
    expect(parseClock('11 a.m.')).toBe(660);
    expect(parseClock('12 am')).toBe(0);
    expect(parseClock('noon')).toBe(720);
    expect(parseClock('15:00')).toBe(900);
  });
  it('a bare 1-7 is afternoon/evening ("until 5"); a bare 8-11 is not guessed', () => {
    expect(parseClock('5')).toBe(1020);
    expect(parseClock('3')).toBe(900);
    expect(parseClock('12')).toBe(720);
    expect(parseClock('9')).toBeNull();
    expect(parseClock('10:30')).toBeNull();
  });
  it('before / by / until / after / between', () => {
    expect(clockWindowFromText('something to do before 3 PM')).toEqual({ after: null, before: 900 });
    expect(clockWindowFromText('I have until 5')).toEqual({ after: null, before: 1020 });
    expect(clockWindowFromText('back by 5pm')).toEqual({ after: null, before: 1020 });
    expect(clockWindowFromText('dinner after 6 pm')).toEqual({ after: 1080, before: null });
    expect(clockWindowFromText('between 2 and 5 pm')).toEqual({ after: 840, before: 1020 });
    expect(clockWindowFromText('from 2pm until 4pm')).toEqual({ after: 840, before: 960 });
  });
  it('declares nothing without a real clock time', () => {
    expect(clockWindowFromText('before 9')).toBeNull();
    expect(clockWindowFromText('after work')).toBeNull();
    expect(clockWindowFromText('from 2 pm')).toBeNull();
    expect(clockWindowFromText('coffee tonight')).toBeNull();
    expect(clockWindowFromText('I have two hours')).toBeNull();
    expect(clockWindowFromText('between 5 pm and 2 pm')).toBeNull();
  });
});

describe('date anchors: only the date the person gave, never chosen for them', () => {
  it('today / tonight / tomorrow', () => {
    expect(dateAnchorFromText('today before 3 PM', WED)).toEqual({ kind: 'day', dates: [new Date(2026, 8, 23)] });
    expect(day(dateAnchorFromText('tonight', WED).dates[0])).toBe('9/23');
    expect(day(dateAnchorFromText('tomorrow before 3 PM', WED).dates[0])).toBe('9/24');
  });
  it('this weekend is a PERIOD, no day preferred; a named day is that day', () => {
    const w = dateAnchorFromText('this weekend before 5', WED);
    expect(w.kind).toBe('period');
    expect(w.dates.map(day)).toEqual(['9/26', '9/27']);
    expect(dateAnchorFromText('Saturday this weekend', WED)).toEqual({ kind: 'day', dates: [new Date(2026, 8, 26)] });
    expect(dateAnchorFromText('Sunday this weekend', WED)).toEqual({ kind: 'day', dates: [new Date(2026, 8, 27)] });
    expect(day(dateAnchorFromText('saturday night', WED).dates[0])).toBe('9/26');
  });
  it('on a Sunday the weekend period is what is left of it; a past Saturday is not chosen', () => {
    expect(dateAnchorFromText('this weekend', SUN).dates.map(day)).toEqual(['9/27']);
    expect(dateAnchorFromText('saturday', SUN)).toBeNull();
  });
  it('"this weekend tonight" resolves only when today is a weekend day', () => {
    expect(dateAnchorFromText('this weekend tonight', WED)).toBeNull();
    expect(day(dateAnchorFromText('this weekend tonight', SUN).dates[0])).toBe('9/27');
  });
  it('no date words, or "next weekend" = no anchor', () => {
    expect(dateAnchorFromText('before 3 PM', WED)).toBeNull();
    expect(dateAnchorFromText('I have two hours', WED)).toBeNull();
    expect(dateAnchorFromText('next weekend before 5', WED)).toBeNull();
  });
});

describe('fitting gatherings into an anchored window (ranking only)', () => {
  const today = dateAnchorFromText('today', WED);
  const w = { after: null, before: 900 };
  it('start and (known) end inside the window on the anchored day', () => {
    expect(windowFit({ startsAt: at(23, 13), category: 'Coffee' }, w, today)).toBe('fit');
    expect(windowFit({ startsAt: at(23, 14, 30), category: 'Movies' }, w, today)).toBe('miss');
    expect(windowFit({ startsAt: at(23, 16) }, w, today)).toBe('miss');
    expect(windowFit({ startsAt: at(23, 14) }, w, today)).toBeNull();
    expect(windowFit({ startsAt: at(24, 13), category: 'Coffee' }, w, today)).toBe('miss');
  });
  it('a weekend window accepts either weekend day equally', () => {
    const wk = dateAnchorFromText('this weekend', WED);
    expect(windowFit({ startsAt: at(26, 13), category: 'Coffee' }, w, wk)).toBe('fit');
    expect(windowFit({ startsAt: at(27, 13), category: 'Coffee' }, w, wk)).toBe('fit');
  });
  it('without an anchor nothing changes; nothing is removed', () => {
    const items = [{ id: 'a', startsAt: at(23, 13), category: 'Coffee', score: 1 }, { id: 'b', startsAt: at(23, 16), score: 1 }, { id: 'c', score: 1 }];
    expect(applyClockWindowToCandidates(items, w, null)).toBe(items);
    const out = applyClockWindowToCandidates(items, w, today);
    expect(out.map((c) => c.score)).toEqual([3, -1, 1]);
    expect(out[0].subtitle).toBe('🕒 Fits before 3 PM');
    expect(out).toHaveLength(3);
  });
  it('business supply is unchanged (no posting window or duration matching)', () => {
    expect(windowFit({ type: 'business_availability', windowStart: at(23, 12), windowEnd: at(23, 16), category: 'Coffee' }, w, today)).toBeNull();
  });
  it('caption and span need the anchor', () => {
    expect(clockWindowCaption({ after: 840, before: 1020 }, today)).toBe('Keeping it between 2 PM and 5 PM');
    expect(clockWindowCaption({ after: 840, before: 1020 }, null)).toBeNull();
    expect(windowSpan({ after: 840, before: 1020 }, today)).toBe(180);
    expect(windowSpan({ after: 840, before: 1020 }, null)).toBeNull();
    expect(windowSpan({ after: null, before: 900 }, today)).toBeNull();
    expect(clockLabel(930)).toBe('3:30 PM');
  });
});
