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
  // item 55: the ring is the Nearby Pulse's ring form; native driver + untouchable live there
  expect(s).toMatch(/<PulseRings pulse=\{pulse\}/);
  const pulse = read('motion/NearbyPulse.js');
  expect(pulse).toMatch(/useNativeDriver: true/);
  expect(pulse).toMatch(/<View pointerEvents="none" style=\{style\}>/);
  expect(s).toMatch(/useIsFocused/);
  expect(s).toMatch(/if \(fresh\.length === 0 \|\| reduceMotion\) return/);
  expect(s).not.toMatch(/playHaptic|Animated\.loop|Animated\.stagger/);
  // the seen record is marked BEFORE the reduce-motion check, so nothing replays when Reduce Motion is turned off later
  expect(s.indexOf('takeNewHappening(ids)')).toBeLessThan(s.indexOf('reduceMotion) return'));
  expect(s.indexOf('reduceMotion) return')).toBeLessThan(s.indexOf('pulse.start()'));
});

test('Home and Discover wrap only the still radar mark, never the rows (item 27)', () => {
  const home = read('screens/HomeScreen.js');
  expect(home).toMatch(/<HappeningRipple ids=\{rightNow\.map\(\(g\) => g\.id\)\}[^>]*>\s*<RightNowMark [^>]*\/>\s*<\/HappeningRipple>/);
  const discover = read('screens/DiscoverHubScreen.js');
  expect(discover).toMatch(/<HappeningRipple ids=\{section\.items\.map\(\(g\) => g\.id\)\}[^>]*>\s*<RightNowMark [^>]*\/>\s*<\/HappeningRipple>/);
  expect(home.match(/<HappeningRipple/g)).toHaveLength(1);
  expect(discover.match(/<HappeningRipple/g)).toHaveLength(1);
});

// Owner item 27 (2026-10-11): the Right Now radar.
describe('the Right Now radar mark', () => {
  test('is drawn and still: no Animated, no loop, hidden from screen readers', () => {
    const s = read('components/RightNowMark.js');
    expect(s).not.toMatch(/Animated|useEffect|setInterval|setTimeout/);
    // item 55: it is the Pulse's still form, with the same size, dot and ring opacity as before
    expect(s).toMatch(/<PulseMark color=\{color\} size=\{14\} dot=\{6\} ringOpacity=\{0\.45\} style=\{style\} \/>/);
    const pulse = read('motion/NearbyPulse.js');
    const mark = pulse.slice(pulse.indexOf('export function PulseMark'), pulse.indexOf('// ---------- form 2'));
    expect(mark).not.toMatch(/Animated|useEffect|setInterval|setTimeout/);
    expect(mark).toMatch(/importantForAccessibility="no-hide-descendants"/);
  });
  test('the headings keep their wording and open the existing Happening Now view', () => {
    const home = read('screens/HomeScreen.js');
    expect(home).toMatch(/navigateKeepingTrail\(navigation, 'Discover', \{ \.\.\.RIGHT_NOW_VIEW \}\)[\s\S]{0,200}accessibilityLabel=\{t\('ui\.discover\.rightNowA11y'\)\}/);
    expect(home).toMatch(/t\('ui\.home\.nearbyRightNow'\)/);
    const discover = read('screens/DiscoverHubScreen.js');
    expect(discover).toMatch(/onPress=\{\(\) => openDateView\('now'\)\}\s*accessibilityLabel=\{t\('ui\.discover\.rightNowA11y'\)\}/);
    expect(discover).toMatch(/withoutLeadGlyph\(sectionTitle\(section\)\)/);
    // the ⚡ chip keeps its own title (with the ⚡)
    expect(discover).toMatch(/: t\(`ui\.discover\.section\.\$\{f\}`\)/);
  });
  test('the ⚡ is the only thing the heading drops', () => {
    const langs = Object.values(require('../i18n/ui/discover.js').default);
    expect(langs).toHaveLength(11);
    const strip = (title) => String(title ?? '').replace(/^⚡\s*/u, '');
    for (const lang of langs) {
      expect(lang.section.now.startsWith('⚡ ')).toBe(true);
      expect(strip(lang.section.now)).toBe(lang.section.now.slice(2));
      expect(lang.rightNowA11y).toBeTruthy();
    }
  });
  test('a link into the date view remembers what Discover showed and puts it back on close', () => {
    const discover = read('screens/DiscoverHubScreen.js');
    expect(discover).toMatch(/linkReturnRef\.current = \{ mode, typeFilter, searchQuery, expandedContext \}/);
    expect(discover).toMatch(/function closeDateView\(\) \{\s*const back = linkReturnRef\.current;[\s\S]{0,300}setSearchQuery\(back\.searchQuery\)/);
    expect(discover).toMatch(/if \(!dateView\) linkReturnRef\.current = null/);
    expect(read('utils/recommendationContext.js')).toMatch(/RIGHT_NOW_VIEW = \{ initialMode: 'things', openDateView: 'now' \}/);
  });
});
