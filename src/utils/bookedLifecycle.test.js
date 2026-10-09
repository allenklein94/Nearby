// "You're booked" exit (owner, 2026-10-09): settles, shrinks away, closes its space, then is removed; never replays.
const fs = require('fs');
const path = require('path');
import { createBookedLifecycle } from './bookedLifecycle';
import { SEQUENCES, settleMs, isWithinBudget } from '../motion/motionBudget';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

function harness({ reduceMotion = false, holdMs = 4500 } = {}) {
  const log = [];
  let enterCb = null;
  let exitCb = null;
  const lc = createBookedLifecycle({
    reduceMotion,
    holdMs,
    enter: (cb) => { log.push('enter'); enterCb = cb; },
    exit: (cb) => { log.push('exit'); exitCb = cb; },
    onDone: () => log.push('done'),
  });
  return { lc, log, entered: () => enterCb && enterCb(), exited: () => exitCb && exitCb() };
}

test('exit transition: enter, hold, then exit, and only after the exit finishes is it removed', () => {
  const h = harness();
  h.lc.start();
  expect(h.log).toEqual(['enter']);
  h.entered();
  jest.advanceTimersByTime(4499);
  expect(h.log).toEqual(['enter']);
  jest.advanceTimersByTime(1);
  expect(h.log).toEqual(['enter', 'exit']); // space still reserved while it fades, shrinks and closes
  h.exited();
  expect(h.log).toEqual(['enter', 'exit', 'done']);
  expect(h.lc.isFinished()).toBe(true);
});

test('layout cleanup: done is called exactly once, so the card is removed and leaves no space behind', () => {
  const h = harness();
  h.lc.start(); h.entered(); jest.advanceTimersByTime(4500);
  h.exited(); h.exited();
  expect(h.log.filter((e) => e === 'done')).toHaveLength(1);
});

test('Reduce Motion: no entrance or exit animation; held, then removed at once', () => {
  const h = harness({ reduceMotion: true });
  h.lc.start();
  expect(h.log).toEqual([]);
  jest.advanceTimersByTime(4500);
  expect(h.log).toEqual(['done']);
});

test('repeat triggers never replay it: a second start does nothing', () => {
  const h = harness();
  expect(h.lc.start()).toBe(true);
  expect(h.lc.start()).toBe(false);
  h.entered(); jest.advanceTimersByTime(4500); h.exited();
  expect(h.log).toEqual(['enter', 'exit', 'done']);
});

test('unmounting mid-way stops everything and never calls done', () => {
  const during = harness();
  during.lc.start(); during.entered(); jest.advanceTimersByTime(1000);
  during.lc.stop();
  jest.advanceTimersByTime(10000);
  expect(during.log).toEqual(['enter']);

  const inExit = harness();
  inExit.lc.start(); inExit.entered(); jest.advanceTimersByTime(4500);
  inExit.lc.stop();
  inExit.exited();
  expect(inExit.log).toEqual(['enter', 'exit']);

  const beforeEnterEnds = harness();
  beforeEnterEnds.lc.start(); beforeEnterEnds.lc.stop(); beforeEnterEnds.entered();
  jest.advanceTimersByTime(10000);
  expect(beforeEnterEnds.log).toEqual(['enter']);
  expect(beforeEnterEnds.lc.start()).toBe(false);
});

test('the exit is quick and restrained: medium tier, a slight shrink only', () => {
  expect(isWithinBudget(settleMs('bookedExit'), SEQUENCES.bookedExit.tier)).toBe(true);
  expect(SEQUENCES.bookedExit.tier).toBe('medium');
  expect(SEQUENCES.bookedExit.shrinkTo).toBeGreaterThanOrEqual(0.9);
});

describe('wiring (source guards)', () => {
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const card = read('motion/BookedCelebration.js');
  const detail = read('screens/BusinessRequestDetailScreen.js');
  const group = read('screens/GroupPlanScreen.js');
  test('the card runs its lifecycle once per mount, and stops it on unmount', () => {
    expect(card).toMatch(/lifecycle\.start\(\);\s*return \(\) => \{ lifecycle\.stop\(\); running\.forEach\(\(a\) => a\.stop\(\)\); \};/);
    expect(card).toMatch(/\/\/ eslint-disable-next-line react-hooks\/exhaustive-deps\n  \}, \[\]\);/);
  });
  test('space is reserved at its measured height, then closed, before removal', () => {
    expect(card).toMatch(/space\.setValue\(measured\.current\)/);
    expect(card).toMatch(/collapsing && \{ height: space, overflow: 'hidden' \}/);
    expect(card).toMatch(/Animated\.timing\(space, \{ toValue: 0/);
  });
  test('the screens remove it only when it says it is done (no screen-side timer pulls it out)', () => {
    expect(detail).toMatch(/onDone=\{\(\) => setJustAccepted\(false\)\}/);
    expect(detail).not.toMatch(/setTimeout\(\(\) => setJustAccepted\(false\)/);
    expect(group).toMatch(/if \(kind !== 'reservation'\) successBannerTimerRef/);
    expect(group).toMatch(/<BookedCelebration haptic title=\{t\('ui\.requestDetail\.youreBooked'\)\} onDone=/);
  });
  test('one success vibration (the person tapped), no extra vibration or sound', () => {
    const code = card.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code.match(/playHaptic\(/g)).toHaveLength(1);
    expect(code).not.toMatch(/Vibration|expo-av|Audio\./);
  });
  test('the booking itself never waits on the card', () => {
    const accept = detail.slice(detail.indexOf('async function handleAccept'), detail.indexOf('async function collectPayment'));
    expect(accept.indexOf('acceptBusinessOffer')).toBeLessThan(accept.indexOf('setJustAccepted(true)'));
    expect(accept).not.toMatch(/await[^\n]*(Booked|justAccepted)/);
  });
});
