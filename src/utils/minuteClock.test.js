// Owner item 108: relative time labels stay true while a screen is open (data freshness, not motion).
const fs = require('fs');
const path = require('path');
import { startMinuteClock, nextTickAt, dayWordChangeAt, relativeWindows, windowOf, windowsKey, MINUTE_MS } from './minuteClock';
import { recommendationContext, contextItem } from './recommendationContext';
import { whenLabel } from './timeContext';

const at = (h, m = 0, s = 0) => new Date(2026, 9, 17, h, m, s);
const iso = (d) => d.toISOString();
// What a card really shows: the shared context line (no distance given, so only the when half).
const cardWhen = (row, nowMs) => recommendationContext(contextItem('gathering', row), { now: new Date(nowMs) }).context;

function fakeAppState(initial = 'active') {
  const listeners = [];
  return {
    currentState: initial,
    added: 0,
    addEventListener(_e, fn) { this.added += 1; listeners.push(fn); return { remove: () => listeners.splice(listeners.indexOf(fn), 1) }; },
    emit(state) { this.currentState = state; listeners.slice().forEach((fn) => fn(state)); },
    get listenerCount() { return listeners.length; },
  };
}

// Runs the clock from `from` for `minutes`, re-rendering (reading the label) on every tick, like the screen does.
function run(row, from, minutes, opts = {}) {
  jest.setSystemTime(from);
  const shown = [{ at: Date.now(), label: cardWhen(row, Date.now()) }];
  const stop = startMinuteClock(relativeWindows(row), (nowMs) => shown.push({ at: nowMs, label: cardWhen(row, nowMs) }), opts);
  for (let i = 0; i < minutes; i += 1) jest.advanceTimersByTime(MINUTE_MS);
  return { shown, stop };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('label progression (frozen clock)', () => {
  it('Starts in 42 min -> 41 -> ... -> 1 -> Happening now for 30 min (to +29) -> the plain label, one change per minute, then stops', () => {
    const row = { id: 'g', scheduled_at: iso(at(19)) };
    const { shown } = run(row, at(18, 18), 90, { appState: fakeAppState() });
    const labels = shown.map((s) => s.label);
    expect(labels[0]).toBe('Starts in 42 min');
    expect(labels[1]).toBe('Starts in 41 min');
    expect(labels).toContain('Starts in 1 min');
    // boundary 1: the start minute itself flips to Happening now
    expect(shown.find((s) => s.at === at(19).getTime()).label).toBe('Happening now');
    expect(shown.find((s) => s.at === at(18, 59).getTime()).label).toBe('Starts in 1 min');
    // boundary 2: still Happening now at +29, the plain label at +30 (start-only: the engine's own "over" wording; the end is
    // exclusive, as for a gathering with a length, and the same instant the check-in window closes, migration 20270326)
    expect(shown.find((s) => s.at === at(19, 29).getTime()).label).toBe('Happening now');
    const after = shown.find((s) => s.at === at(19, 30).getTime());
    expect(after.label).toBe('Already happened');
    expect(whenLabel(iso(at(19)), new Date(after.at))).toBe('Tonight · 7 PM');
    // every tick is a minute boundary and nothing ticks after the window
    shown.slice(1).forEach((s) => expect(s.at % MINUTE_MS).toBe(0));
    expect(shown[shown.length - 1].at).toBe(at(19, 31).getTime());
    expect(jest.getTimerCount()).toBe(0);
  });

  it('a gathering with a length: Happening now · until -> Ends in N min -> Ended, then stops', () => {
    const row = { id: 'g', scheduled_at: iso(at(19)), duration_minutes: 60 };
    const { shown } = run(row, at(18, 58), 70, { appState: fakeAppState() });
    expect(shown.find((s) => s.at === at(19).getTime()).label).toBe('Happening now · until 8 PM');
    expect(shown.find((s) => s.at === at(19, 30).getTime()).label).toBe('Ends in 30 min');
    expect(shown.find((s) => s.at === at(19, 59).getTime()).label).toBe('Ends in 1 min');
    expect(shown.find((s) => s.at === at(20).getTime()).label).toBe('Already happened');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('sleeps until the "Starts in 60 min" boundary instead of ticking (no needless renders), capped at an hour', () => {
    const row = { id: 'g', scheduled_at: iso(at(21)) };
    const { shown } = run(row, at(18), 125, { appState: fakeAppState() });
    expect(shown[0].label).toBe('Tonight · 9 PM');
    // the 19:00 cap wake re-plans without a tick; the first tick is the span start
    expect(shown[1]).toEqual({ at: at(20).getTime(), label: 'Starts in 60 min' });
    expect(shown[2]).toEqual({ at: at(20, 1).getTime(), label: 'Starts in 59 min' });
  });

  it('nextTickAt: next minute boundary inside a span, the span start before it, null after every span', () => {
    const w = [{ start: at(19).getTime(), end: null }];
    expect(nextTickAt(w, at(18, 30, 20).getTime())).toBe(at(18, 31).getTime());
    expect(nextTickAt(w, at(17).getTime())).toBe(at(18).getTime());
    expect(nextTickAt(w, at(19, 31).getTime())).toBeNull();
    expect(nextTickAt([], at(18).getTime())).toBeNull();
  });
});

describe('background pause', () => {
  it('no ticks in the background; one catch-up tick on return, then minute ticks resume', () => {
    const app = fakeAppState();
    const row = { id: 'g', scheduled_at: iso(at(19)) };
    jest.setSystemTime(at(18, 18));
    const ticks = [];
    startMinuteClock(relativeWindows(row), (nowMs) => ticks.push(nowMs), { appState: app });
    jest.advanceTimersByTime(2 * MINUTE_MS);
    expect(ticks).toEqual([at(18, 19).getTime(), at(18, 20).getTime()]);
    app.emit('background');
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(15 * MINUTE_MS); // 18:35, away
    expect(ticks).toHaveLength(2);
    jest.advanceTimersByTime(30 * 1000); // 18:35:30
    app.emit('active');
    expect(ticks[2]).toBe(at(18, 35, 30).getTime());
    expect(cardWhen(row, ticks[2])).toBe('Starts in 25 min');
    jest.advanceTimersByTime(30 * 1000);
    expect(ticks[3]).toBe(at(18, 36).getTime());
  });

  it('inactive pauses too; starting while backgrounded schedules nothing until active', () => {
    const app = fakeAppState('background');
    jest.setSystemTime(at(18, 18));
    const ticks = [];
    startMinuteClock(relativeWindows({ scheduled_at: iso(at(19)) }), (n) => ticks.push(n), { appState: app });
    expect(jest.getTimerCount()).toBe(0);
    app.emit('active');
    expect(ticks).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(1);
    app.emit('inactive');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stop() clears the timer and the AppState listener', () => {
    const app = fakeAppState();
    jest.setSystemTime(at(18, 18));
    const stop = startMinuteClock(relativeWindows({ scheduled_at: iso(at(19)) }), () => {}, { appState: app });
    expect(app.listenerCount).toBe(1);
    stop();
    expect(app.listenerCount).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('no needless subscriptions', () => {
  it('nothing shown, or only finished things: no timer and no AppState listener', () => {
    const app = fakeAppState();
    jest.setSystemTime(at(18));
    startMinuteClock(relativeWindows([], null, undefined), () => {}, { appState: app });
    startMinuteClock(relativeWindows({ scheduled_at: iso(at(10)) }, { title: 'no time' }), () => {}, { appState: app });
    expect(app.added).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('only Home and Discover use the clock', () => {
    const src = path.join(__dirname, '..');
    const users = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); return; }
      if (!/\.js$/.test(e.name) || /\.test\.js$/.test(e.name)) return;
      if (/useMinuteClock|startMinuteClock/.test(fs.readFileSync(p, 'utf8'))) users.push(path.relative(src, p));
    });
    walk(src);
    expect(users.sort()).toEqual(['hooks/useMinuteClock.js', 'screens/DiscoverHubScreen.js', 'screens/HomeScreen.js', 'utils/minuteClock.js']);
  });

  it('the clock is text only: neither file touches motion', () => {
    for (const f of ['utils/minuteClock.js', 'hooks/useMinuteClock.js']) {
      const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
      expect(s).not.toMatch(/from '\.\.?\/(motion|\.\.\/motion)|Animated|LayoutAnimation|motionBudget/);
    }
  });
});

describe('windows from what a screen shows', () => {
  it('gatherings, resolver items, wrappers and postings; the key is order-free', () => {
    expect(windowOf({ scheduled_at: iso(at(19)), duration_minutes: 60 })).toEqual({ start: at(19).getTime(), end: at(20).getTime() });
    expect(windowOf({ startsAt: iso(at(19)) })).toEqual({ start: at(19).getTime(), end: null });
    expect(windowOf({ gathering: { scheduled_at: iso(at(19)) } })).toEqual({ start: at(19).getTime(), end: null });
    expect(windowOf({ postingStartsAt: iso(at(17)), postingEndsAt: iso(at(21)) })).toEqual({ start: at(17).getTime(), end: at(21).getTime() });
    expect(windowOf({ title: 'x' })).toBeNull();
    const a = relativeWindows([{ startsAt: iso(at(19)) }], { scheduled_at: iso(at(20)) });
    expect(windowsKey(a)).toBe(windowsKey([...a].reverse()));
  });
});

// Midnight follow-up (owner, 2026-10-18): the day word follows the real calendar day while the screen stays open.
describe('day word at local midnight', () => {
  const d = (y, mo, day, h, m = 0) => new Date(y, mo, day, h, m);
  const labelsAcross = (rows, from, minutes, opts = {}) => {
    jest.setSystemTime(from);
    const read = (nowMs) => rows.map((r) => cardWhen(r, nowMs));
    const shown = [{ at: Date.now(), labels: read(Date.now()) }];
    const stop = startMinuteClock(relativeWindows(rows), (nowMs) => shown.push({ at: nowMs, labels: read(nowMs) }), opts);
    for (let i = 0; i < minutes; i += 1) jest.advanceTimersByTime(MINUTE_MS);
    return { shown, stop };
  };

  it('11:59 PM Tomorrow -> 12:00 AM Today; the event a day later becomes Tomorrow; several days away keeps its date', () => {
    const next = { id: 'a', scheduled_at: iso(d(2026, 9, 18, 10)) };
    const later = { id: 'b', scheduled_at: iso(d(2026, 9, 19, 10)) };
    const far = { id: 'c', scheduled_at: iso(d(2026, 9, 23, 10)) };
    const { shown } = labelsAcross([next, later, far], d(2026, 9, 17, 23, 59), 2, { appState: fakeAppState() });
    expect(shown[0].labels).toEqual(['Tomorrow · 10 AM', whenLabel(later.scheduled_at, d(2026, 9, 17, 23, 59)), whenLabel(far.scheduled_at, d(2026, 9, 17, 23, 59))]);
    expect(shown[0].labels[1]).not.toMatch(/^(Today|Tomorrow)/);
    // exactly one tick, at midnight, with every label re-read
    expect(shown).toHaveLength(2);
    expect(shown[1].at).toBe(d(2026, 9, 18, 0).getTime());
    expect(shown[1].labels[0]).toBe('Today · 10 AM');
    expect(shown[1].labels[1]).toBe('Tomorrow · 10 AM');
    expect(shown[1].labels[2]).toBe(shown[0].labels[2]);
    expect(shown[1].labels[2]).not.toMatch(/^(Today|Tomorrow)/);
  });

  it('an evening start reads Tonight after midnight (the engine\'s own Today/Tonight rule, unchanged)', () => {
    const row = { id: 'g', scheduled_at: iso(d(2026, 9, 18, 19)) };
    const { shown } = labelsAcross([row], d(2026, 9, 17, 23, 59), 2, { appState: fakeAppState() });
    expect(shown.map((s) => s.labels[0])).toEqual(['Tomorrow · 7 PM', 'Tonight · 7 PM']);
  });

  it('month-end and year-end', () => {
    expect(dayWordChangeAt(d(2026, 10, 1, 10).getTime(), d(2026, 9, 31, 12).getTime())).toBe(d(2026, 10, 1, 0).getTime());
    expect(dayWordChangeAt(d(2027, 0, 1, 10).getTime(), d(2026, 11, 31, 12).getTime())).toBe(d(2027, 0, 1, 0).getTime());
    expect(dayWordChangeAt(d(2027, 0, 2, 10).getTime(), d(2026, 11, 31, 12).getTime())).toBe(d(2027, 0, 1, 0).getTime());
    const row = { id: 'y', scheduled_at: iso(d(2027, 0, 1, 10)) };
    const { shown } = labelsAcross([row], d(2026, 11, 31, 23, 59), 2, { appState: fakeAppState() });
    expect(shown.map((s) => s.labels[0])).toEqual(['Tomorrow · 10 AM', 'Today · 10 AM']);
  });

  it('dayWordChangeAt: the day before, then the day itself; null once started or already today', () => {
    const start = d(2026, 9, 20, 10).getTime();
    expect(dayWordChangeAt(start, d(2026, 9, 17, 12).getTime())).toBe(d(2026, 9, 19, 0).getTime());
    expect(dayWordChangeAt(start, d(2026, 9, 19, 12).getTime())).toBe(d(2026, 9, 20, 0).getTime());
    expect(dayWordChangeAt(start, d(2026, 9, 20, 8).getTime())).toBeNull();
    expect(dayWordChangeAt(start, start + 1)).toBeNull();
    expect(dayWordChangeAt(null, start)).toBeNull();
  });

  it('backgrounded across midnight: no tick while away, the right label at once on return', () => {
    const app = fakeAppState();
    const row = { id: 'g', scheduled_at: iso(d(2026, 9, 18, 10)) };
    jest.setSystemTime(d(2026, 9, 17, 23, 50));
    const shown = [];
    startMinuteClock(relativeWindows(row), (nowMs) => shown.push(cardWhen(row, nowMs)), { appState: app });
    app.emit('background');
    expect(jest.getTimerCount()).toBe(0);
    jest.setSystemTime(d(2026, 9, 18, 7));
    expect(shown).toEqual([]);
    app.emit('active');
    expect(shown).toEqual(['Today · 10 AM']);
  });

  it('one timer however many day-labelled things are shown; no ticks between midnights beyond the hourly cap re-plan', () => {
    const rows = [1, 2, 3, 4].map((n) => ({ id: `g${n}`, scheduled_at: iso(d(2026, 9, 17 + n, 10)) }));
    const { shown } = labelsAcross(rows, d(2026, 9, 17, 12), 12 * 60, { appState: fakeAppState() });
    expect(jest.getTimerCount()).toBe(1);
    expect(shown.slice(1).map((s) => s.at)).toEqual([d(2026, 9, 18, 0).getTime()]);
  });
});
