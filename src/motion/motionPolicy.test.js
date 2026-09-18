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

test('motion allowed: spring and loop pass through untouched', () => {
  __setReduceMotionForTests(false);
  const A = fakeAnimated();
  installReducedMotionPolicy(A);
  expect(A.spring({}, { toValue: 1 }).kind).toBe('spring');
  expect(A.loop({}).kind).toBe('loop');
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
