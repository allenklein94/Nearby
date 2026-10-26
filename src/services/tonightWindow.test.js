// Owner, 2026-10-26: a typed "tonight" = today from 6 PM to the end of the local day, the same window as Home's Tonight quick
// picks (utils/gatheringDateFilter.js); "today" stays the whole day; a stated clock time governs the hours ("tonight" = the day).
import fs from 'fs';
import path from 'path';
import { matchesDateWindow } from './intentResolverScoring';
import { matchesDateFilter } from '../utils/gatheringDateFilter';

const at = (h, m = 0, day = 26) => new Date(2026, 9, day, h, m).toISOString(); // Mon 26 Oct 2026, local wall clock

describe('typed "tonight"', () => {
  test('asked before 6 PM: an afternoon gathering is not tonight, an evening one is; today keeps both', () => {
    const now = new Date(2026, 9, 26, 15, 0);
    expect(matchesDateWindow(at(16), 'tonight', now)).toBe(false);
    expect(matchesDateWindow(at(17, 59), 'tonight', now)).toBe(false);
    expect(matchesDateWindow(at(18), 'tonight', now)).toBe(true);
    expect(matchesDateWindow(at(16), 'today', now)).toBe(true);
    expect(matchesDateWindow(at(18), 'today', now)).toBe(true);
  });

  test('asked after 6 PM: later tonight matches, up to the end of the local day', () => {
    const now = new Date(2026, 9, 26, 19, 30);
    expect(matchesDateWindow(at(21), 'tonight', now)).toBe(true);
    expect(matchesDateWindow(at(23, 59), 'tonight', now)).toBe(true);
    expect(matchesDateWindow(at(0, 0, 27), 'tonight', now)).toBe(false); // local midnight = tomorrow
    expect(matchesDateWindow(at(1, 0, 27), 'tonight', now)).toBe(false);
  });

  test('just after local midnight, "tonight" is the new day\'s evening, never the night that just ended', () => {
    const now = new Date(2026, 9, 27, 0, 15);
    expect(matchesDateWindow(at(23, 0, 26), 'tonight', now)).toBe(false);
    expect(matchesDateWindow(at(20, 0, 27), 'tonight', now)).toBe(true);
    expect(matchesDateWindow(at(9, 0, 27), 'tonight', now)).toBe(false);
  });

  test('a stated clock time governs the hours: "tonight after 5" keeps 5:30 PM (the clock window ranks it)', () => {
    const now = new Date(2026, 9, 26, 15, 0);
    expect(matchesDateWindow(at(17, 30), 'tonight', now, { clockStated: true })).toBe(true);
    expect(matchesDateWindow(at(0, 30, 27), 'tonight', now, { clockStated: true })).toBe(false); // still today only
  });

  test('now / tomorrow / weekend / flexible unchanged', () => {
    const now = new Date(2026, 9, 26, 15, 0);
    expect(matchesDateWindow(at(16), 'now', now)).toBe(true);
    expect(matchesDateWindow(at(20), 'now', now)).toBe(false);
    expect(matchesDateWindow(at(10, 0, 27), 'tomorrow', now)).toBe(true);
    expect(matchesDateWindow(at(16), 'flexible', now)).toBe(true);
    expect(matchesDateWindow(at(16), null, now)).toBe(true);
  });

  test('same answer as the Home Tonight quick pick for every hour of the day', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 9, 26, 12, 0));
    try {
      const now = new Date();
      for (let h = 0; h < 24; h += 1) {
        for (const m of [0, 59]) expect([h, m, matchesDateWindow(at(h, m), 'tonight', now)]).toEqual([h, m, matchesDateFilter(at(h, m), 'tonight')]);
      }
      expect(matchesDateWindow(at(20, 0, 27), 'tonight', now)).toBe(matchesDateFilter(at(20, 0, 27), 'tonight'));
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, 'intentResolver.js'), 'utf8');
  test('gatherings in a typed ask pass whether a clock time was stated', () => {
    expect(src).toMatch(/matchesDateWindow\(g\.scheduled_at, dateWindow, new Date\(\), \{ clockStated \}\)/);
    expect(src).toMatch(/const clockStated = !!\(clockWindow && \(clockWindow\.after != null \|\| clockWindow\.before != null\)\) \|\| pointClock != null;/);
    expect(src).toMatch(/resolveGatherings\(category, dateWindow, rawText, priceLevel, partyType, weatherPromise, !!travelMiles, askedActivities, statedDay, clockStated\)/);
  });
});
