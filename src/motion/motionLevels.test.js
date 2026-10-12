// Owner item 57 (2026-10-12, documentation only): the three motion levels map exactly onto the existing timing tiers, and
// Level 3 holds exactly one moment, a business responding. This guard keeps the vocabulary and the tiers agreeing; it changes
// no animation. "Cards and lists stay static" (Level 1) is not provable from tokens: it stays guarded by item 15's review rule
// and consistencyAudit.test.js (no raw LayoutAnimation outside the motion system).
const { MOTION_LEVELS, motionLevelOf } = require('../constants/motionLanguage');
const { MOTION_BUDGET, SEQUENCES, SIGNATURE_MOMENT } = require('./motionBudget');

const TIERS = new Set(Object.keys(MOTION_BUDGET));
const sequences = Object.entries(SEQUENCES).filter(([, s]) => s && TIERS.has(s.tier));

test('the levels are exactly the existing tiers, each tier in one level', () => {
  const all = MOTION_LEVELS.flatMap((l) => l.tiers);
  expect(new Set(all).size).toBe(all.length);
  expect([...all].sort()).toEqual([...TIERS].sort());
  expect(MOTION_LEVELS.map((l) => [l.level, l.tiers])).toEqual([
    [1, ['tiny', 'small']], [2, ['medium', 'special']], [3, ['signature']],
  ]);
});

test('every sequence has a level', () => {
  for (const [key, s] of Object.entries(SEQUENCES)) {
    if (s && typeof s === 'object' && 'tier' in s) expect([key, motionLevelOf(s.tier)]).toEqual([key, expect.any(Number)]);
  }
});

test('Level 3 is exactly one moment: a business responds', () => {
  const level3 = sequences.filter(([, s]) => motionLevelOf(s.tier) === 3).map(([k]) => k);
  expect(level3).toEqual([SIGNATURE_MOMENT]);
  expect(SIGNATURE_MOMENT).toBe('businessResponds');
});

test.each([
  ['offerAccepted', 2], ['booked', 2], ['offerToPlan', 2], ['planTogether', 2], ['friendJoin', 2],
  ['interestedToAttending', 2], ['offerTravel', 2], ['offerAssembly', 2],
  ['visitConfirmed', 1], ['offerProgress', 1], ['interestedSaved', 1],
])('%s stays at its approved level %i (never promoted to Level 3)', (key, level) => {
  expect(motionLevelOf(SEQUENCES[key].tier)).toBe(level);
});

test('the first business interaction has no motion of its own (words only, items 51/52)', () => {
  expect(Object.keys(SEQUENCES).filter((k) => /first/i.test(k))).toEqual([]);
});
