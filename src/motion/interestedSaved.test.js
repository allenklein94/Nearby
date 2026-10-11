// Owner item 30 (2026-10-11): marking Interested answers with "✓ Saved" and one small pulse, then returns to "★ Interested".
import fs from 'fs';
import path from 'path';
import { SEQUENCES, settleMs, isWithinBudget } from './motionBudget';
import actions from '../i18n/ui/actions';

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const code = (f) => read(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const motion = code('motion/InterestedSaved.js');
const detail = read('screens/GatheringDetailScreen.js');
const home = read('screens/HomeScreen.js');

test('a small, calm pulse inside its budget; the Saved hold is a dwell, not motion', () => {
  const S = SEQUENCES.interestedSaved;
  expect(isWithinBudget(settleMs('interestedSaved'), S.tier)).toBe(true);
  expect(S.pulseFrom).toBeGreaterThan(1);
  expect(S.pulseFrom).toBeLessThanOrEqual(1.15);
  expect(S.savedHoldMs).toBeGreaterThanOrEqual(800);
  expect(S.savedHoldMs).toBeLessThanOrEqual(2000);
  expect(motion).not.toMatch(/Animated\.spring|Animated\.loop|Easing\.bounce|Easing\.elastic|playHaptic|expo-haptics|confetti|particle/i);
  expect(motion).toMatch(/useNativeDriver: true/);
  expect(motion).not.toMatch(/opacity/); // the label is information: full opacity from the first frame
});

test('"Saved" shows briefly, then the normal label returns; a cleared key ends it at once', () => {
  expect(motion).toMatch(/setShowSaved\(true\)/);
  expect(motion).toMatch(/setTimeout\(\(\) => setShowSaved\(false\), S\.savedHoldMs\)/);
  expect(motion).toMatch(/\{showSaved \? savedLabel : label\}/);
  expect(motion).toMatch(/if \(!flashKey\) \{\s*setShowSaved\(false\);/);
  expect(motion).toMatch(/clearTimeout\(timer\)/);
});

test('Reduce Motion: no pulse, the same brief Saved swap (understandable without animation)', () => {
  expect(motion).toMatch(/if \(!reduceMotion\) \{/);
  expect(motion).toMatch(/reduceMotion \? null : \{ transform: \[\{ scale \}\] \}/);
  // the swap itself is outside the reduce-motion branch
  const i = motion.indexOf('setShowSaved(true)');
  expect(i).toBeGreaterThan(-1);
  expect(i).toBeLessThan(motion.indexOf('if (!reduceMotion)'));
});

test('every language has the Saved label next to the existing on/off labels', () => {
  for (const ns of Object.values(actions)) {
    expect(ns.interestedSaved).toMatch(/^✓ \S/);
    expect(ns.interestedOn).toBeTruthy();
  }
});

describe('gathering detail', () => {
  test('answers at the tap (optimistic + flash), ignores a second tap while saving, a failure puts it back', () => {
    const i = detail.indexOf('async function toggleInterested()');
    const fn = detail.slice(i, detail.indexOf('async function undoInterested', i));
    expect(fn).toMatch(/if \(togglingInterested\) return;/);
    expect(fn.indexOf('setInterestedFlash((k) => (next ? k + 1 : 0))')).toBeLessThan(fn.indexOf('await setGatheringInterested'));
    expect(fn).toMatch(/catch \(e\) \{\s*setInterestedFlash\(0\);/);
    expect(fn).toMatch(/setInterestedPending\(null\);/);
    expect(fn).toMatch(/showSuccessToast\(\.\.\.interestedConfirmation\(next\), \{ undo:/); // the toast stays
    expect(detail).toMatch(/onPress=\{toggleInterested\}\s*disabled=\{togglingInterested\}/);
  });
  test('the button reads the stored state (after the save, a reload) and shows the moment', () => {
    expect(detail).toMatch(/const myInterested = interestedPending \?\? gathering\?\.myInterested === true;/);
    expect(detail).toMatch(/<InterestedSaved\s+flashKey=\{interestedFlash\}/);
    expect(detail).toMatch(/savedLabel=\{t\('ui\.actions\.interestedSaved'\)\}/);
    expect(detail).toMatch(/if \(previous === false\) \{ setShowDemandDisclosure\(false\); setInterestedFlash\(0\); \}/); // Undo ends it
  });
});

describe('Home card (the only other Interested button; Discover has none)', () => {
  test('one save per card at a time; flash on marking only; failure and Undo end it; toast kept', () => {
    const i = home.indexOf('async function toggleCardInterested');
    const fn = home.slice(i, home.indexOf('async function undoCardInterested', i));
    expect(fn).toMatch(/if \(interestedBusyRef\.current\.has\(g\.id\)\) return;/);
    expect(fn).toMatch(/finally \{\s*interestedBusyRef\.current\.delete\(g\.id\);/);
    expect(fn).toMatch(/\[g\.id\]: on \? 0 : \(f\[g\.id\] \?\? 0\) \+ 1/);
    expect(fn.indexOf('setInterestedFlash')).toBeLessThan(fn.indexOf('await setGatheringInterested'));
    expect(fn).toMatch(/showSuccessToast\(\.\.\.interestedConfirmation\(!on\)/);
    expect(home).toMatch(/<InterestedSaved flashKey=\{interestedFlash\[g\.id\]\}/);
    expect(home).toMatch(/if \(!previous\) setInterestedFlash\(\(f\) => \(\{ \.\.\.f, \[g\.id\]: 0 \}\)\);/);
  });
  test('Discover has no Interested button to keep consistent', () => {
    expect(read('screens/DiscoverHubScreen.js')).not.toMatch(/setGatheringInterested|kind === 'interested'/);
  });
});
