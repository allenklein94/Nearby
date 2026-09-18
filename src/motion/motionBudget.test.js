const fs = require('fs');
const path = require('path');
const { MOTION_BUDGET, SEQUENCES, tierOf, isWithinBudget, settleMs } = require('./motionBudget');

test('tiers are the defined budget and are contiguous', () => {
  expect(MOTION_BUDGET.tiny).toMatchObject({ min: 50, max: 150 });
  expect(MOTION_BUDGET.small).toMatchObject({ min: 150, max: 300 });
  expect(MOTION_BUDGET.medium).toMatchObject({ min: 300, max: 500 });
  expect(MOTION_BUDGET.special).toMatchObject({ min: 500, max: 900 });
  Object.values(MOTION_BUDGET).forEach((t) => expect(t.ms).toBeGreaterThanOrEqual(t.min) && expect(t.ms).toBeLessThanOrEqual(t.max));
});

test('tierOf classifies and flags over-budget', () => {
  expect(tierOf(120)).toBe('tiny');
  expect(tierOf(220)).toBe('small');
  expect(tierOf(400)).toBe('medium');
  expect(tierOf(800)).toBe('special');
  expect(tierOf(901)).toBeNull();
});

test.each(Object.keys(SEQUENCES))('sequence %s settles within its declared tier', (name) => {
  const ms = settleMs(name);
  expect(isWithinBudget(ms, SEQUENCES[name].tier)).toBe(true);
});

test('a glyph fade always fits inside its stage', () => {
  ['successCelebratory', 'successBusiness', 'surpriseReveal'].forEach((n) => {
    expect(SEQUENCES[n].glyphFadeMs).toBeLessThanOrEqual(SEQUENCES[n].stageMs);
  });
  expect(SEQUENCES.occasionMorph.glyphFadeMs).toBeLessThanOrEqual(SEQUENCES.occasionMorph.stepMs);
});

test('business transaction confirms are faster than celebrations', () => {
  expect(settleMs('successBusiness')).toBeLessThan(settleMs('successCelebratory'));
});

// No literal transition duration anywhere in the motion system may exceed the top of the budget.
// Ambient loops (loading pulses/sweeps) are excluded: a loop isn't a transition.
test('no literal Animated duration exceeds the special tier', () => {
  const AMBIENT = new Set(['NLoader.js']);
  const dirs = [
    path.join(__dirname),
    path.join(__dirname, '..', 'components'),
  ];
  const offenders = [];
  for (const dir of dirs) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && !x.endsWith('.test.js'))) {
      if (AMBIENT.has(f) || /Skeleton|FindingOptionsLoader/.test(f)) continue;
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      const re = /duration:\s*(\d+)/g;
      let m;
      while ((m = re.exec(src))) {
        if (Number(m[1]) > MOTION_BUDGET.special.max) offenders.push(`${f}: ${m[1]}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});
