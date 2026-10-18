// Idea "202" follow-up: Home's time-of-day wording and quick picks follow the real period while Home stays open
// (data freshness, not motion). Fake timers + a fake AppState; local wall-clock fixtures (2026-10-16 = Friday).
const fs = require('fs');
const path = require('path');
import { startPeriodClock, MAX_SLEEP_MS } from './periodClock';
import { homeMomentKey, nextHomeMomentBoundary, getTimePeriod, getGreeting } from './timeContext';

const fri = (h, m = 0, s = 0) => new Date(2026, 9, 16, h, m, s);
const sat = (h, m = 0) => new Date(2026, 9, 17, h, m);
const sun = (h, m = 0) => new Date(2026, 9, 18, h, m);
const mon = (h, m = 0) => new Date(2026, 9, 19, h, m);

function fakeAppState(initial = 'active') {
  const listeners = [];
  return {
    currentState: initial,
    addEventListener(_e, fn) { listeners.push(fn); return { remove: () => listeners.splice(listeners.indexOf(fn), 1) }; },
    emit(state) { this.currentState = state; listeners.slice().forEach((fn) => fn(state)); },
    get listenerCount() { return listeners.length; },
  };
}

// A controllable clock: timers fire only when advanced past their due time.
function harness(startDate, appState = fakeAppState()) {
  let nowMs = startDate.getTime();
  let timers = [];
  let id = 0;
  const opts = {
    appState,
    now: () => nowMs,
    setTimer: (fn, ms) => { id += 1; timers.push({ id, due: nowMs + ms, fn }); return id; },
    clearTimer: (t) => { timers = timers.filter((x) => x.id !== t); },
  };
  const advanceTo = (date) => {
    const target = date.getTime();
    for (;;) {
      const due = timers.filter((t) => t.due <= target).sort((a, b) => a.due - b.due)[0];
      if (!due) break;
      timers = timers.filter((t) => t !== due);
      nowMs = due.due;
      due.fn();
    }
    nowMs = target;
  };
  return { opts, advanceTo, setNow: (d) => { nowMs = d.getTime(); }, pending: () => timers.length, appState };
}

describe('the one period rule, extended (no second time-period system)', () => {
  it('the key follows getTimePeriod and the greeting', () => {
    expect(homeMomentKey(fri(17, 59))).toBe('afternoon|afternoon');
    expect(homeMomentKey(fri(18, 0))).toBe('evening|evening');
    expect(homeMomentKey(sat(11, 59))).toBe('weekend|morning');
    expect(homeMomentKey(sat(12, 0))).toBe('weekend|afternoon'); // greeting changes on a weekend noon too
    expect(getTimePeriod(fri(18, 0))).toBe('evening');
    expect(getGreeting(fri(18, 0))).toBe('Good evening');
  });

  it('next boundary = local noon, 6 PM or midnight', () => {
    expect(nextHomeMomentBoundary(fri(9, 30))).toBe(fri(12).getTime());
    expect(nextHomeMomentBoundary(fri(12, 0))).toBe(fri(18).getTime());
    expect(nextHomeMomentBoundary(fri(17, 59, 59))).toBe(fri(18).getTime());
    expect(nextHomeMomentBoundary(fri(23, 0))).toBe(sat(0).getTime());
  });
});

describe('Home stays open across a boundary', () => {
  it('5:59 PM -> 6:00 PM: one change, to evening', () => {
    const h = harness(fri(17, 59));
    const seen = [];
    startPeriodClock((k) => seen.push(k), h.opts);
    h.advanceTo(fri(17, 59, 59));
    expect(seen).toEqual([]);
    h.advanceTo(fri(18, 0));
    expect(seen).toEqual(['evening|evening']);
  });

  it('across midnight Friday -> Saturday: evening -> weekend; Sunday -> Monday: weekend -> morning', () => {
    const h = harness(fri(23, 30));
    const seen = [];
    startPeriodClock((k) => seen.push(k), h.opts);
    h.advanceTo(sat(0, 1));
    expect(seen).toEqual(['weekend|morning']);
    const h2 = harness(sun(23, 30));
    const seen2 = [];
    startPeriodClock((k) => seen2.push(k), h2.opts);
    h2.advanceTo(mon(0, 1));
    expect(seen2).toEqual(['morning|morning']);
  });

  it('no boundary passed = no call; long sleeps are capped and re-checked silently', () => {
    const h = harness(fri(0, 30)); // next boundary noon, 11.5 h away
    const seen = [];
    startPeriodClock((k) => seen.push(k), h.opts);
    h.advanceTo(fri(11, 59));
    expect(seen).toEqual([]); // the capped wake-ups found the same period
    h.advanceTo(fri(12, 0));
    expect(seen).toEqual(['afternoon|afternoon']);
    expect(MAX_SLEEP_MS).toBe(3600000);
  });

  it('never more than one timer (no duplicates, no polling loop)', () => {
    const h = harness(fri(9));
    startPeriodClock(() => {}, h.opts);
    expect(h.pending()).toBe(1);
    h.advanceTo(fri(13));
    expect(h.pending()).toBe(1);
    h.appState.emit('active');
    expect(h.pending()).toBe(1);
  });
});

describe('background and resume', () => {
  it('no timer in the background; on return past a boundary, the right period at once', () => {
    const h = harness(fri(17, 30));
    const seen = [];
    startPeriodClock((k) => seen.push(k), h.opts);
    h.appState.emit('background');
    expect(h.pending()).toBe(0);
    h.setNow(fri(19, 0));
    h.appState.emit('active');
    expect(seen).toEqual(['evening|evening']);
    expect(h.pending()).toBe(1);
  });

  it('return without a boundary passed = no call', () => {
    const h = harness(fri(14));
    const seen = [];
    startPeriodClock((k) => seen.push(k), h.opts);
    h.appState.emit('background');
    h.setNow(fri(15));
    h.appState.emit('active');
    expect(seen).toEqual([]);
  });

  it('starting while backgrounded schedules nothing; stop() clears the timer and the listener', () => {
    const bg = harness(fri(10), fakeAppState('background'));
    startPeriodClock(() => {}, bg.opts);
    expect(bg.pending()).toBe(0);
    const h = harness(fri(10));
    const stop = startPeriodClock(() => {}, h.opts);
    stop();
    expect(h.pending()).toBe(0);
    expect(h.appState.listenerCount).toBe(0);
  });
});

describe('scope guards', () => {
  const src = path.join(__dirname, '..');
  const read = (f) => fs.readFileSync(path.join(src, f), 'utf8');

  it('only Home uses the period clock', () => {
    const users = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); return; }
      if (!/\.js$/.test(e.name) || /\.test\.js$/.test(e.name)) return;
      if (/usePeriodClock|startPeriodClock/.test(fs.readFileSync(p, 'utf8'))) users.push(path.relative(src, p));
    });
    walk(src);
    expect(users.sort()).toEqual(['hooks/usePeriodClock.js', 'screens/HomeScreen.js', 'utils/periodClock.js']);
  });

  it('text only: neither file touches motion; Home still reads the one period rule at render', () => {
    for (const f of ['utils/periodClock.js', 'hooks/usePeriodClock.js']) {
      expect(read(f)).not.toMatch(/from '\.\.?\/(motion|\.\.\/motion)|Animated|LayoutAnimation|motionBudget|setInterval/);
    }
    const home = read('screens/HomeScreen.js');
    expect(home).toMatch(/usePeriodClock\(\);\n\s*const period = getTimePeriod\(\);/);
    expect(read('hooks/usePeriodClock.js')).toMatch(/useIsFocused/);
  });
});
