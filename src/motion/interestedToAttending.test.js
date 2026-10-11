// Owner item 31 (2026-10-11): Interested -> Attending is a bigger moment, showing the move between the two states.
import fs from 'fs';
import path from 'path';
import { SEQUENCES, settleMs, isWithinBudget } from './motionBudget';
import actions from '../i18n/ui/actions';

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const motion = read('motion/InterestedToAttending.js').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const detail = read('screens/GatheringDetailScreen.js');

test('bigger than item 30, still inside the budget, calm and on the native driver', () => {
  const M = SEQUENCES.interestedToAttending;
  expect(isWithinBudget(settleMs('interestedToAttending'), M.tier)).toBe(true);
  expect(settleMs('interestedToAttending')).toBeGreaterThan(settleMs('interestedSaved'));
  expect(motion).not.toMatch(/Animated\.spring|Animated\.loop|Easing\.bounce|Easing\.elastic|confetti|particle|playHaptic|expo-haptics/i);
  expect(motion).toMatch(/useNativeDriver: true/);
  expect(motion).not.toMatch(/useNativeDriver: false/);
});

test('shows the move: Interested dims and is struck through, Attending flows in readable from frame one, one glow', () => {
  expect(motion).toMatch(/textDecorationLine: 'line-through'/);
  expect(motion).toMatch(/outputRange: \[1, M\.oldRestOpacity\]/);
  expect(motion).toMatch(/opacity: infoOpacity\(arrive\)/);
  expect(motion).toMatch(/outputRange: \[-M\.flowPx, 0\]/);
  expect(motion).toMatch(/Animated\.timing\(glow, \{ toValue: 1/);
  expect(motion).toMatch(/pointerEvents="none"/); // never in the way of a tap
});

test('Reduce Motion and any replay: decided once at mount; the settled row still reads Interested -> Attending', () => {
  expect(motion).toMatch(/const animate = useRef\(play && !reduceMotion\)\.current;/);
  expect(motion).toMatch(/new Animated\.Value\(animate \? 0 : 1\)/);
  expect(motion).toMatch(/\{fromLabel\}[\s\S]*→[\s\S]*\{toLabel\}/);
  expect(motion).toMatch(/accessibilityLabel=\{a11yLabel\}/);
});

test('only for the person\'s own auto-approved join from Interested in this visit (never pending, waitlist, or a plain join)', () => {
  const i = detail.indexOf('async function handleConfirmIntent');
  const fn = detail.slice(i, detail.indexOf('async function handleAskBusinessesNow', i));
  expect(fn).toMatch(/const wasInterested = myInterested;/);
  expect(fn.indexOf('const wasInterested')).toBeLessThan(fn.indexOf('await expressInterest'));
  const approved = fn.slice(fn.indexOf("if (result.status === 'approved') {"), fn.indexOf('} else {', fn.indexOf("if (result.status === 'approved') {")));
  expect(approved).toMatch(/if \(wasInterested\) setJoinedFromInterested\(true\);/);
  expect(fn.match(/setJoinedFromInterested/g)).toHaveLength(1);
  // shown inside the You're in panel, which renders only from the stored approved attendance
  const panel = detail.slice(detail.indexOf("gathering.myStatus === 'approved' ? ("), detail.indexOf("t('ui.gatheringDetail.youreIn')"));
  expect(panel).toMatch(/joinedFromInterested && \(\s*<InterestedToAttending/);
});

test('every language has the Attending label and its spoken line; the "from" side reuses the Interested label', () => {
  for (const ns of Object.values(actions)) {
    expect(ns.attendingNow).toMatch(/^✓ \S/);
    expect(ns.interestedToAttendingA11y).toBeTruthy();
    expect(ns.interestedOn).toMatch(/^★ /);
  }
  expect(detail).toMatch(/fromLabel=\{t\('ui\.actions\.interestedOn'\)\}/);
});
