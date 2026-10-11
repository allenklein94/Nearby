// Owner item 25 #4 (2026-10-11, LOCKED meaning): "Gathering is confirmed" = the plan comes together: every required piece
// ready (primary reservation + every live add-on confirmed), never an attendee count.
import fs from 'fs';
import path from 'path';
import { isPlanFullyConfirmed, planComesTogetherNow } from './planAddonReadiness';
import { SEQUENCES, settleMs, isWithinBudget } from '../motion/motionBudget';

const primary = (state) => ({ kind: 'primary', state });
const addon = (state) => ({ kind: 'addon', state });

describe('isPlanFullyConfirmed', () => {
  test('primary + every add-on confirmed = ready', () => {
    expect(isPlanFullyConfirmed([primary('confirmed'), addon('confirmed'), addon('confirmed')])).toBe(true);
  });
  test('one piece still open, or the primary not confirmed = not ready', () => {
    expect(isPlanFullyConfirmed([primary('confirmed'), addon('confirmed'), addon('offered')])).toBe(false);
    expect(isPlanFullyConfirmed([primary('offered'), addon('confirmed')])).toBe(false);
  });
  test('a one-piece plan is "You\'re booked" (its own moment), not a plan coming together', () => {
    expect(isPlanFullyConfirmed([primary('confirmed')])).toBe(false);
    expect(isPlanFullyConfirmed([])).toBe(false);
    expect(isPlanFullyConfirmed(null)).toBe(false);
  });
});

describe('planComesTogetherNow', () => {
  test('plays only for a transition seen on screen, once per plan', () => {
    const played = new Set();
    expect(planComesTogetherNow({ previousReady: false, ready: true, planId: 'p1', played })).toBe(true);
    played.add('p1');
    expect(planComesTogetherNow({ previousReady: false, ready: true, planId: 'p1', played })).toBe(false);
  });
  test('opening a plan that was already complete is the baseline: nothing plays', () => {
    expect(planComesTogetherNow({ previousReady: null, ready: true, planId: 'p1', played: new Set() })).toBe(false);
    expect(planComesTogetherNow({ previousReady: true, ready: true, planId: 'p1', played: new Set() })).toBe(false);
    expect(planComesTogetherNow({ previousReady: false, ready: false, planId: 'p1', played: new Set() })).toBe(false);
  });
});

test('the "Ready — everything is confirmed" words use the same rule as the moment', () => {
  const src = fs.readFileSync(path.join(__dirname, 'planAddonReadiness.js'), 'utf8');
  expect(src).toMatch(/if \(isPlanFullyConfirmed\(timeline\)\) return txt\('allConfirmed'\);/);
});

test('attendance is never part of it', () => {
  const src = fs.readFileSync(path.join(__dirname, 'planAddonReadiness.js'), 'utf8');
  const fn = src.slice(src.indexOf('export function isPlanFullyConfirmed'), src.indexOf('export function planComesTogetherNow'));
  expect(fn).not.toMatch(/attendee|going|participants|guest/i);
});

test('motion: special tier, calm (business transactions), Reduce Motion respected, readable from frame one', () => {
  expect(isWithinBudget(settleMs('planTogether'), SEQUENCES.planTogether.tier)).toBe(true);
  const m = fs.readFileSync(path.join(__dirname, '../motion/PlanComesTogether.js'), 'utf8');
  const code = m.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  expect(code).not.toMatch(/Animated\.spring|Animated\.loop|playHaptic|expo-haptics|confetti|particle/i);
  expect(code).toMatch(/useReduceMotion/);
  expect(code).toMatch(/infoOpacity\(v\)/);
});

test('the screen judges only after the add-ons loaded, and wraps the plan pieces', () => {
  const screen = fs.readFileSync(path.join(__dirname, '../screens/BusinessRequestDetailScreen.js'), 'utf8');
  expect(screen).toMatch(/if \(!addonsLoadedRef\.current \|\| request\?\.addon_type\) return;/);
  expect(screen).toMatch(/\.then\(\(rows\) => \{ addonsLoadedRef\.current = true; setAddons\(rows\); \}\)/);
  expect(screen).toMatch(/<PlanComesTogether playKey=\{planTogetherKey\} pieces=\{planTimeline\.length\}/);
  expect(screen).toMatch(/<PlanPiece key=\{entry\.id\} index=\{entryIndex\}>/);
});
