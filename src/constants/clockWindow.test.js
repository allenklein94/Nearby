import { parseClock, clockWindowFromText, windowFit, applyClockWindowToCandidates, clockWindowCaption, windowSpan, clockLabel } from './clockWindow';

const at = (h, m = 0) => new Date(2026, 8, 26, h, m).toISOString();

describe('reading a clock window from the ask', () => {
  it('parses clock times, never guessing a missing AM/PM', () => {
    expect(parseClock('3 pm')).toBe(15 * 60);
    expect(parseClock('3:30PM')).toBe(15 * 60 + 30);
    expect(parseClock('11 a.m.')).toBe(11 * 60);
    expect(parseClock('12 am')).toBe(0);
    expect(parseClock('noon')).toBe(720);
    expect(parseClock('15:00')).toBe(900);
    expect(parseClock('3')).toBeNull();
    expect(parseClock('5:30')).toBeNull();
  });
  it('before / by / until / after / between', () => {
    expect(clockWindowFromText('something to do before 3 PM')).toEqual({ after: null, before: 900 });
    expect(clockWindowFromText('I need to be back by 5pm')).toEqual({ after: null, before: 1020 });
    expect(clockWindowFromText('free until noon')).toEqual({ after: null, before: 720 });
    expect(clockWindowFromText('dinner after 6 pm')).toEqual({ after: 1080, before: null });
    expect(clockWindowFromText('between 2 and 5 pm')).toEqual({ after: 840, before: 1020 });
    expect(clockWindowFromText('from 2pm until 4pm')).toEqual({ after: 840, before: 960 });
  });
  it('declares nothing without a real clock time', () => {
    expect(clockWindowFromText('before 3')).toBeNull();
    expect(clockWindowFromText('after work')).toBeNull();
    expect(clockWindowFromText('after 6 months of trying')).toBeNull();
    expect(clockWindowFromText('from 2 pm')).toBeNull();
    expect(clockWindowFromText('coffee tonight')).toBeNull();
    expect(clockWindowFromText('between 5 pm and 2 pm')).toBeNull();
  });
});

describe('fitting results into the window (ranking only)', () => {
  const w = { after: null, before: 900 };
  it('a gathering fits when it starts and (known length) ends inside the window', () => {
    expect(windowFit({ startsAt: at(13), category: 'Coffee' }, w)).toBe('fit');
    expect(windowFit({ startsAt: at(14, 30), category: 'Movies' }, w)).toBe('miss');
    expect(windowFit({ startsAt: at(16) }, w)).toBe('miss');
    expect(windowFit({ startsAt: at(14) }, w)).toBeNull();
    expect(windowFit({ startsAt: at(19) }, { after: 1080, before: null })).toBe('fit');
    expect(windowFit({ startsAt: at(17) }, { after: 1080, before: null })).toBe('miss');
  });
  it('a business posting fits when its room window leaves time for a visit', () => {
    expect(windowFit({ windowStart: at(12), windowEnd: at(16), category: 'Coffee' }, w)).toBe('fit');
    expect(windowFit({ windowStart: at(14, 45), windowEnd: at(18), category: 'Coffee' }, w)).toBe('miss');
    expect(windowFit({ windowStart: at(16), windowEnd: at(20) }, w)).toBe('miss');
  });
  it('unknown stays unknown; nothing is removed', () => {
    expect(windowFit({ category: 'Coffee' }, w)).toBeNull();
    const out = applyClockWindowToCandidates([
      { id: 'a', startsAt: at(13), category: 'Coffee', score: 1 },
      { id: 'b', startsAt: at(16), score: 1 },
      { id: 'c', score: 1 },
    ], w);
    expect(out.map((c) => c.score)).toEqual([3, -1, 1]);
    expect(out[0].subtitle).toBe('🕒 Fits before 3 PM');
    expect(out).toHaveLength(3);
    expect(applyClockWindowToCandidates(out, null)).toBe(out);
  });
  it('caption and span', () => {
    expect(clockWindowCaption({ after: 840, before: 1020 })).toBe('Keeping it between 2 PM and 5 PM');
    expect(windowSpan({ after: 840, before: 1020 })).toBe(180);
    expect(windowSpan({ after: null, before: 900 })).toBeNull();
    expect(clockLabel(930)).toBe('3:30 PM');
  });
});
