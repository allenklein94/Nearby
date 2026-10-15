// Owner item 100 (2026-10-15): the Nearby Motion System's primitives are documentation. This guard makes every sequence name
// its primitive, the real event it shows and the item that approved it, and checks it stays inside the existing limits. It
// enforces documentation and existing rules, never visual uniformity: no component reads the map (item 56).
const fs = require('fs');
const path = require('path');
const { MOTION_PRIMITIVE_NAMES, MOTION_PRIMITIVES, MOTION_EXCEPTIONS, PULSE_MOMENTS, SEQUENCE_MEANINGS } = require('../constants/motionLanguage');
const { SEQUENCES, MOTION_BUDGET, SIGNATURE_MOMENT } = require('./motionBudget');

const SRC = path.join(__dirname, '..');
const TIERS = new Set(Object.keys(MOTION_BUDGET));
const sequenceKeys = Object.keys(SEQUENCES).filter((k) => SEQUENCES[k] && TIERS.has(SEQUENCES[k].tier));
const withPrimitive = (p) => Object.keys(MOTION_PRIMITIVES).filter((k) => MOTION_PRIMITIVES[k].primitive === p).sort();

test('exactly the eight primitives', () => {
  expect(MOTION_PRIMITIVE_NAMES).toEqual(['pulse', 'flow', 'merge', 'reveal', 'transform', 'assemble', 'complete', 'ambient']);
});

test('every sequence declares one primitive, the real event it shows and its item; no stale entry', () => {
  expect(Object.keys(MOTION_PRIMITIVES).sort()).toEqual([...sequenceKeys].sort());
  expect(Object.keys(MOTION_PRIMITIVES).sort()).toEqual(Object.keys(SEQUENCE_MEANINGS).sort());
  for (const [key, e] of Object.entries(MOTION_PRIMITIVES)) {
    expect([key, MOTION_PRIMITIVE_NAMES.includes(e.primitive)]).toEqual([key, true]);
    expect([key, typeof e.communicates === 'string' && e.communicates.length > 20]).toEqual([key, true]);
    expect([key, typeof e.item === 'string' && e.item.length > 0]).toEqual([key, true]);
  }
});

test('existing limits: 900 ms cap, the signature only for a business responding', () => {
  for (const key of sequenceKeys) {
    const tier = SEQUENCES[key].tier;
    if (key === SIGNATURE_MOMENT) expect(tier).toBe('signature');
    else expect([key, tier !== 'signature' && MOTION_BUDGET[tier].max <= 900]).toEqual([key, true]);
  }
  expect(SIGNATURE_MOMENT).toBe('businessResponds');
  expect(MOTION_BUDGET.signature.max).toBeLessThanOrEqual(1500);
});

test('Pulse = exactly the Pulse moments\' sequences (item 55)', () => {
  const pulseSeqs = [...new Set(PULSE_MOMENTS.map((m) => m.sequence).filter(Boolean))].sort();
  expect(withPrimitive('pulse')).toEqual(pulseSeqs);
  expect(MOTION_PRIMITIVES[SIGNATURE_MOMENT].primitive).not.toBe('pulse'); // the signature stays outside the Pulse
});

test('Ambient stays its two approved cases (items 22/36/99)', () => {
  expect(withPrimitive('ambient')).toEqual(['responding', 'weatherShift']);
});

test('the occasion exception is listed as is, only there, never extended', () => {
  const exc = Object.keys(MOTION_PRIMITIVES).filter((k) => MOTION_PRIMITIVES[k].exception).sort();
  expect(exc).toEqual([...MOTION_EXCEPTIONS.occasion_celebration.sequences].sort());
  for (const k of exc) expect(MOTION_PRIMITIVES[k].exception).toBe('occasion_celebration');
});

test('documentation only: no component reads the primitives map', () => {
  const readers = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js') && /MOTION_PRIMITIVE/.test(fs.readFileSync(p, 'utf8'))) readers.push(path.relative(SRC, p));
    }
  })(SRC);
  expect(readers).toEqual(['constants/motionLanguage.js']);
});
