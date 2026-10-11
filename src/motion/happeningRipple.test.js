// Owner item 26 (2026-10-11): "Something is happening near you" -- one ring, only for genuinely new activity, shared
// across Home and Discover, rows never animate.
const fs = require('fs');
const path = require('path');
const { takeNewHappening, resetHappeningSeen } = require('../utils/happeningSeen');
const { SEQUENCES, settleMs, isWithinBudget } = require('./motionBudget');

const SRC = path.join(__dirname, '..');
const read = (r) => fs.readFileSync(path.join(SRC, r), 'utf8');

describe('takeNewHappening: one shared seen record', () => {
  test('first sighting is new, the same ids again are not', () => {
    const store = new Set();
    expect(takeNewHappening(['a', 'b'], store)).toEqual(['a', 'b']);
    expect(takeNewHappening(['a', 'b'], store)).toEqual([]);
  });
  test('only a gathering newly entering the section counts', () => {
    const store = new Set();
    takeNewHappening(['a', 'b'], store);
    expect(takeNewHappening(['b', 'c'], store)).toEqual(['c']);
  });
  test('seen on one surface = not new on the other (one module store)', () => {
    resetHappeningSeen();
    expect(takeNewHappening(['g1', 'g2'])).toEqual(['g1', 'g2']); // Home
    expect(takeNewHappening(['g2', 'g1'])).toEqual([]); // Discover, same activity, other order
    resetHappeningSeen();
  });
  test('empty, missing and null ids never count', () => {
    const store = new Set();
    expect(takeNewHappening([], store)).toEqual([]);
    expect(takeNewHappening(undefined, store)).toEqual([]);
    expect(takeNewHappening([null, undefined], store)).toEqual([]);
  });
  test('a gathering leaving and coming back does not replay', () => {
    const store = new Set();
    takeNewHappening(['a'], store);
    takeNewHappening([], store);
    expect(takeNewHappening(['a'], store)).toEqual([]);
  });
});

test('one ring, medium tier, under 500 ms', () => {
  expect(SEQUENCES.happeningRipple.tier).toBe('medium');
  expect(settleMs('happeningRipple')).toBeLessThan(500);
  expect(isWithinBudget(settleMs('happeningRipple'), 'medium')).toBe(true);
});

test('the ripple is decoration: native driver, no touches, no haptic, Reduce Motion = none, only while in front', () => {
  const s = read('motion/HappeningRipple.js');
  expect(s).toMatch(/useNativeDriver: true/);
  expect(s).toMatch(/pointerEvents="none"/);
  expect(s).toMatch(/useIsFocused/);
  expect(s).toMatch(/if \(fresh\.length === 0 \|\| reduceMotion\) return/);
  expect(s).not.toMatch(/playHaptic|Animated\.loop|Animated\.stagger/);
  // the seen record is marked BEFORE the reduce-motion check, so nothing replays when Reduce Motion is turned off later
  expect(s.indexOf('takeNewHappening(ids)')).toBeLessThan(s.indexOf('reduceMotion) return'));
});

test('Home and Discover wrap only the heading glyph, never the rows', () => {
  const home = read('screens/HomeScreen.js');
  expect(home).toMatch(/<HappeningRipple ids=\{rightNow\.map\(\(g\) => g\.id\)\}[^>]*>\s*<Ionicons name="time-outline"[^>]*\/>\s*<\/HappeningRipple>/);
  const discover = read('screens/DiscoverHubScreen.js');
  expect(discover).toMatch(/<HappeningRipple leading ids=\{section\.items\.map\(\(g\) => g\.id\)\}[^>]*>\s*<Text style=\{\[styles\.sectionHeader[^>]*>\{sectionTitle\(section\)\}<\/Text>\s*<\/HappeningRipple>/);
  // exactly one use per surface
  expect(home.match(/<HappeningRipple/g)).toHaveLength(1);
  expect(discover.match(/<HappeningRipple/g)).toHaveLength(1);
});
