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

test('decided by the ONE eligibility rule from this visit\'s own join and the stored attendance', () => {
  const i = detail.indexOf('async function handleConfirmIntent');
  const fn = detail.slice(i, detail.indexOf('async function handleAskBusinessesNow', i));
  expect(fn).toMatch(/const wasInterested = myInterested;/);
  expect(fn.indexOf('const wasInterested')).toBeLessThan(fn.indexOf('await expressInterest'));
  expect(fn).toMatch(/setOwnJoin\(\{ wasInterested, joinStatus: result\.status \}\);/);
  expect(detail.match(/setOwnJoin\(/g)).toHaveLength(1); // memory only: never restored from storage, so a reload never replays
  expect(detail).toMatch(/const \[ownJoin, setOwnJoin\] = useState\(null\);/);
  // shown inside the You're in panel (rendered only from the stored approved attendance), through the shared rule
  const panel = detail.slice(detail.indexOf("gathering.myStatus === 'approved' ? ("), detail.indexOf("t('ui.gatheringDetail.youreIn')"));
  expect(panel).toMatch(/interestedToAttendingMoment\(\{ \.\.\.ownJoin, storedStatus: gathering\.myStatus \}\) && \(\s*<InterestedToAttending/);
});

describe('the eligibility rule (utils/interestedMoment.js)', () => {
  const { interestedToAttendingMoment: m } = require('../utils/interestedMoment');
  test('only an approved join from Interested that the stored attendance confirms', () => {
    expect(m({ wasInterested: true, joinStatus: 'approved', storedStatus: 'approved' })).toBe(true);
    expect(m({ wasInterested: true, joinStatus: 'pending', storedStatus: 'pending' })).toBe(false);
    expect(m({ wasInterested: true, joinStatus: 'waitlisted', storedStatus: 'waitlisted' })).toBe(false);
    expect(m({ wasInterested: false, joinStatus: 'approved', storedStatus: 'approved' })).toBe(false);
    expect(m({ wasInterested: true, joinStatus: 'approved', storedStatus: null })).toBe(false); // reload failed / not confirmed
    expect(m({ storedStatus: 'approved' })).toBe(false); // a reload or later visit: no join of this visit
    expect(m()).toBe(false);
  });
});

describe('regression: the other join outcomes and the success vibration are unchanged', () => {
  const i = detail.indexOf('async function handleConfirmIntent');
  const fn = detail.slice(i, detail.indexOf('async function handleAskBusinessesNow', i));
  test('approved: the one Success vibration + justJoined; pending/waitlist: the Medium impact, no justJoined', () => {
    const approved = fn.slice(fn.indexOf("if (result.status === 'approved') {"), fn.indexOf('} else {', fn.indexOf("if (result.status === 'approved') {")));
    expect(approved).toMatch(/Haptics\.notificationAsync\(Haptics\.NotificationFeedbackType\.Success\);\s*setJustJoined\(true\);\s*$/);
    const other = fn.slice(fn.indexOf('} else {', fn.indexOf("if (result.status === 'approved') {")));
    expect(other).toMatch(/^\} else \{\s*Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Medium\);\s*\}/);
    expect(fn.match(/Haptics\.(notificationAsync|impactAsync)\(/g)).toHaveLength(2);
    expect(motion).not.toMatch(/Haptics|playHaptic/); // the moment adds none
  });
  test('the You\'re in panel keeps its title and prompt for every approved viewer (plain joins included)', () => {
    const panel = detail.slice(detail.indexOf("gathering.myStatus === 'approved' ? ("), detail.indexOf("gathering.myStatus === 'approved' ? (") + 1200);
    expect(panel).toMatch(/<Text style=\{styles\.youreInTitle\}>\{t\('ui\.gatheringDetail\.youreIn'\)\}<\/Text>\s*<Text style=\{styles\.youreInSub\}>\{t\('ui\.gatheringDetail\.sayHelloPrompt'\)\}<\/Text>/);
  });
});

test('contrast: Attending is large text (>= 18.66 px bold), the struck former state stays >= 3:1 (textSecondary at 0.75)', () => {
  expect(motion).toMatch(/toText: \{ fontSize: 19, fontWeight: '700' \}/);
  expect(motion).toMatch(/color: colors\.textSecondary, opacity:/);
  expect(SEQUENCES.interestedToAttending.oldRestOpacity).toBeGreaterThanOrEqual(0.75);
  expect(motion).toMatch(/flexWrap: 'wrap'/); // long languages wrap instead of overflowing the panel
});

test('every language has the Attending label and its spoken line; the "from" side reuses the Interested label', () => {
  for (const ns of Object.values(actions)) {
    expect(ns.attendingNow).toMatch(/^✓ \S/);
    expect(ns.attendingNow).not.toMatch(/已参加/); // zh: 'already attended' (past) was wrong for an upcoming gathering
    expect(ns.interestedToAttendingA11y).toBeTruthy();
    expect(ns.interestedOn).toMatch(/^★ /);
  }
  expect(detail).toMatch(/fromLabel=\{t\('ui\.actions\.interestedOn'\)\}/);
});
