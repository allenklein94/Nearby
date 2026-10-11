jest.mock('react-native', () => ({
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(false),
    addEventListener: () => ({ remove() {} }),
  },
}));

const { installReducedMotionPolicy, __setReduceMotionForTests, getReduceMotion, subscribeReduceMotion } = require('./motionPolicy');

function fakeAnimated() {
  const calls = [];
  return {
    calls,
    spring: (v, c) => { calls.push(['spring', c]); return { kind: 'spring' }; },
    timing: (v, c) => { calls.push(['timing', c]); return { kind: 'timing', c }; },
    loop: (a, c) => { calls.push(['loop']); return { kind: 'loop' }; },
  };
}

test('motion allowed: spring passes through untouched; loop runs, governed (item 22)', () => {
  __setReduceMotionForTests(false);
  const A = fakeAnimated();
  installReducedMotionPolicy(A);
  expect(A.spring({}, { toValue: 1 }).kind).toBe('spring');
  const l = A.loop({});
  expect(A.calls.filter((c) => c[0] === 'loop')).toHaveLength(1);
  expect(typeof l.start).toBe('function');
  expect(typeof l._isUsingNativeDriver).toBe('function');
});

// Item 22: battery. A fake inner loop + a fake clock.
function fakeLoop() {
  const log = [];
  let cb = null;
  return {
    log,
    start(c) { log.push('start'); cb = c; },
    stop() { log.push('stop'); const c = cb; cb = null; c?.({ finished: false }); },
    reset() { log.push('reset'); },
    _startNativeLoop() {},
    _isUsingNativeDriver() { return true; },
  };
}
function fakeClock() {
  let t = 0;
  let next = 1;
  const timers = new Map();
  return {
    now: () => t,
    schedule: (fn, ms) => { const id = next++; timers.set(id, { fn, at: t + ms }); return id; },
    cancel: (id) => timers.delete(id),
    advance(ms) {
      t += ms;
      for (const [id, x] of [...timers]) if (x.at <= t) { timers.delete(id); x.fn(); }
    },
  };
}

test('governLoop: an ambient loop stops by itself after maxMs, owner told once', () => {
  const { governLoop } = require('./motionPolicy');
  const inner = fakeLoop();
  const clock = fakeClock();
  const g = governLoop(inner, { maxMs: 20000, ...clock });
  const ends = [];
  g.start((r) => ends.push(r));
  clock.advance(19999);
  expect(inner.log).toEqual(['start']);
  clock.advance(1);
  expect(inner.log).toEqual(['start', 'stop']);
  expect(ends).toEqual([{ finished: true }]);
});

test('governLoop: background pauses without ending it; resume keeps only the time it had left', () => {
  const { governLoop } = require('./motionPolicy');
  const inner = fakeLoop();
  const clock = fakeClock();
  const g = governLoop(inner, { maxMs: 20000, ...clock });
  const ends = [];
  g.start((r) => ends.push(r));
  clock.advance(15000);
  g._pause();
  clock.advance(60000); // an hour in the background would be the same: nothing runs, nothing ends
  expect(inner.log).toEqual(['start', 'stop']);
  expect(ends).toEqual([]);
  g._resume();
  expect(inner.log).toEqual(['start', 'stop', 'reset', 'start']);
  clock.advance(4999);
  expect(ends).toEqual([]);
  clock.advance(1);
  expect(ends).toEqual([{ finished: true }]);
});

test('governLoop: the owner stopping it (unmount) ends it once, and a pause after that is a no-op', () => {
  const { governLoop } = require('./motionPolicy');
  const inner = fakeLoop();
  const clock = fakeClock();
  const g = governLoop(inner, { maxMs: 20000, ...clock });
  const ends = [];
  g.start((r) => ends.push(r));
  g.stop();
  g._pause();
  g._resume();
  clock.advance(30000);
  expect(ends).toEqual([{ finished: false }]);
  expect(inner.log).toEqual(['start', 'stop']);
});

test('governLoop delegates the hooks Animated.parallel/sequence call on children', () => {
  const { governLoop } = require('./motionPolicy');
  expect(governLoop(fakeLoop())._isUsingNativeDriver()).toBe(true);
});

test('reduce motion: spring becomes an instant timing, loop becomes inert', () => {
  __setReduceMotionForTests(true);
  const A = fakeAnimated();
  // Already installed on a different object in the previous test; install is once-per-process,
  // so exercise the policy through the module's own state via a fresh module registry.
  jest.isolateModules(() => {
    const m = require('./motionPolicy');
    m.__setReduceMotionForTests(true);
    m.installReducedMotionPolicy(A);
  });
  const s = A.spring({}, { toValue: 1, useNativeDriver: true, friction: 3 });
  expect(s.kind).toBe('timing');
  expect(s.c).toEqual({ toValue: 1, duration: 0, useNativeDriver: true });
  const l = A.loop({});
  let done;
  l.start((r) => { done = r; });
  expect(done).toEqual({ finished: true });
  expect(A.calls.find((c) => c[0] === 'loop')).toBeUndefined();
});

test('setting changes notify subscribers and take effect on the next call', () => {
  __setReduceMotionForTests(false);
  const seen = [];
  const off = subscribeReduceMotion((v) => seen.push(v));
  __setReduceMotionForTests(true);
  __setReduceMotionForTests(true);
  __setReduceMotionForTests(false);
  off();
  expect(seen).toEqual([true, false]);
  expect(getReduceMotion()).toBe(false);
});
