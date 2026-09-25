import { priorityTimeRangeFromChoice, priorityTimeRangeLabel, priorityTimeStringToDate, isWithinPriorityTimeRange } from './priorityTimeRange';

function at(h, m = 0) {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

describe('priorityTimeRangeFromChoice', () => {
  it('both null -> clears the window', () => {
    expect(priorityTimeRangeFromChoice(null, null)).toEqual({ start: null, end: null });
  });
  it('only one side set -> an error, never a half-saved window', () => {
    expect(priorityTimeRangeFromChoice(at(16), null).error).toBeDefined();
    expect(priorityTimeRangeFromChoice(null, at(19)).error).toBeDefined();
  });
  it('end not after start -> an error', () => {
    expect(priorityTimeRangeFromChoice(at(19), at(16)).error).toBeDefined();
    expect(priorityTimeRangeFromChoice(at(16), at(16)).error).toBeDefined();
  });
  it('a real window -> HH:MM strings', () => {
    expect(priorityTimeRangeFromChoice(at(16), at(19))).toEqual({ start: '16:00', end: '19:00' });
  });
});

describe('priorityTimeRangeLabel', () => {
  it('null when incomplete', () => {
    expect(priorityTimeRangeLabel(null, null)).toBeNull();
    expect(priorityTimeRangeLabel('16:00', null)).toBeNull();
  });
  it('reads "4-7 PM" for a whole-hour window', () => {
    expect(priorityTimeRangeLabel('16:00', '19:00')).toBe('4–7 PM');
  });
});

describe('priorityTimeStringToDate', () => {
  it('null/absent -> null', () => {
    expect(priorityTimeStringToDate(null)).toBeNull();
    expect(priorityTimeStringToDate('')).toBeNull();
  });
  it('parses a stored HH:MM[:SS] into a today-dated Date', () => {
    const d = priorityTimeStringToDate('16:30:00');
    expect(d.getHours()).toBe(16);
    expect(d.getMinutes()).toBe(30);
  });
});

describe('isWithinPriorityTimeRange (item 56 follow-up)', () => {
  it('no window set -> never a match', () => {
    expect(isWithinPriorityTimeRange('17:00', null, null)).toBe(false);
  });
  it('no request time -> never a match', () => {
    expect(isWithinPriorityTimeRange(null, '16:00', '19:00')).toBe(false);
  });
  it('inside the window', () => {
    expect(isWithinPriorityTimeRange('17:30', '16:00', '19:00')).toBe(true);
  });
  it('before the window', () => {
    expect(isWithinPriorityTimeRange('15:59', '16:00', '19:00')).toBe(false);
  });
  it('after the window', () => {
    expect(isWithinPriorityTimeRange('19:01', '16:00', '19:00')).toBe(false);
  });
  it('inclusive at both boundaries', () => {
    expect(isWithinPriorityTimeRange('16:00', '16:00', '19:00')).toBe(true);
    expect(isWithinPriorityTimeRange('19:00', '16:00', '19:00')).toBe(true);
  });
  it('unparseable input never matches', () => {
    expect(isWithinPriorityTimeRange('not a time', '16:00', '19:00')).toBe(false);
  });
});
