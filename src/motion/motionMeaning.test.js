// Owner item 58 (2026-10-12, LOCKED): animation must explain something -- a real change, a meaningful connection, or a narrowly
// documented exception. This guard makes "what does this explain?" a required answer: every timing sequence and every file that
// animates on a raw tier token declares a meaning from the approved vocabulary, an approved exception, or (raw-tier files only)
// a reviewed rendering transition or gesture. It changes no animation.
// PASSING THIS TEST IS NOT PROOF THAT ALL MOTION HAS MEANING. It cannot see an animation with no budget token at all
// (Animated.spring, Animated.decay, Animated.timing with no duration, LayoutAnimation inside src/motion, CSS on the web);
// consistencyAudit.test.js only bans literal durations outside src/motion. And it cannot judge whether a label is semantically
// ACCURATE: that is a review judgement, recorded beside each entry in constants/motionLanguage.js.
const fs = require('fs');
const path = require('path');
const { MOTION_MEANINGS, MOTION_EXCEPTIONS, SEQUENCE_MEANINGS, DIRECT_TIER_MEANINGS, RENDERING_TRANSITIONS, GESTURE_MOTIONS } = require('../constants/motionLanguage');
const { PROGRESS_STEPS } = require('../utils/offerProgress');
const { SEQUENCES, MOTION_BUDGET, SIGNATURE_MOMENT } = require('./motionBudget');

const SRC = path.join(__dirname, '..');
const TIERS = new Set(Object.keys(MOTION_BUDGET));
const sequenceKeys = Object.keys(SEQUENCES).filter((k) => SEQUENCES[k] && TIERS.has(SEQUENCES[k].tier));
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(path.relative(SRC, p));
  }
  return out;
}
const validMeaning = (m) => (Array.isArray(m) && m.length > 0 && m.every((x) => MOTION_MEANINGS.includes(x)))
  || (!!m && !!m.steps && Object.keys(m.steps).length > 0 && Object.values(m.steps).every((x) => MOTION_MEANINGS.includes(x)));
const validDirect = (m) => validMeaning(m)
  || (!!m && RENDERING_TRANSITIONS.includes(m.rendering) && typeof m.purpose === 'string' && m.purpose.length > 20)
  || (!!m && GESTURE_MOTIONS.includes(m.gesture) && typeof m.semantics === 'string' && m.semantics.length > 20);

test('every timing sequence declares a meaning or an approved exception, and no entry is stale', () => {
  expect(Object.keys(SEQUENCE_MEANINGS).sort()).toEqual([...sequenceKeys].sort());
  for (const [key, m] of Object.entries(SEQUENCE_MEANINGS)) {
    const ok = validMeaning(m) || (m && MOTION_EXCEPTIONS[m.exception] && MOTION_EXCEPTIONS[m.exception].sequences.includes(key));
    expect([key, !!ok]).toEqual([key, true]);
  }
});

test('every file animating on a raw tier token is registered with a meaning', () => {
  const users = walk(SRC).filter((f) => f !== 'motion/motionBudget.js'
    && /MOTION_BUDGET\.(tiny|small|medium|special|signature)\.ms/.test(fs.readFileSync(path.join(SRC, f), 'utf8')));
  expect(Object.keys(DIRECT_TIER_MEANINGS).sort()).toEqual(users.sort());
  for (const [f, m] of Object.entries(DIRECT_TIER_MEANINGS)) expect([f, validDirect(m)]).toEqual([f, true]);
});

test('the only exception is the occasion celebration, exactly its three sequences, kept as they are', () => {
  expect(Object.keys(MOTION_EXCEPTIONS)).toEqual(['occasion_celebration']);
  const exceptionUsers = Object.entries(SEQUENCE_MEANINGS).filter(([, m]) => m && m.exception).map(([k]) => k);
  expect(exceptionUsers).toEqual(['occasionMorph', 'occasionLock', 'occasionParticles']);
  // no added particles, duration or effects: the approved tokens stay exactly as they are
  expect(SEQUENCES.occasionMorph).toEqual({ tier: 'special', stepMs: 200, glyphFadeMs: 150, textFadeMs: 200, maxGlyphs: 3 });
  expect(SEQUENCES.occasionLock).toEqual({ tier: 'special', snapDelayMs: 300, textFadeMs: 200 });
  expect(SEQUENCES.occasionParticles).toEqual({ tier: 'special', maxDelayMs: 150, riseMs: 420, fadeMs: 260 });
  const occ = fs.readFileSync(path.join(SRC, 'motion/OccasionAnimation.js'), 'utf8');
  const block = occ.slice(occ.indexOf('OCCASION_SELECT_ANIMATIONS = {'), occ.indexOf('};', occ.indexOf('OCCASION_SELECT_ANIMATIONS = {')));
  expect((block.match(/^\s+\w+: \{ kind: '(\w+)'/gm) || []).map((l) => l.trim().split(':')[0]))
    .toEqual(['birthday', 'anniversary', 'graduation', 'celebration', 'surprise']);
  expect((block.match(/kind: 'particles'/g) || []).length).toBe(1);
  expect(block).toContain("glyphs: ['🎉', '✨', '🎊', '🎈', '🎉', '✨']");
});

test('the signature and the retired invitation', () => {
  expect(SEQUENCE_MEANINGS[SIGNATURE_MOMENT]).toEqual(['new']);
  expect(SEQUENCE_MEANINGS.bookedExit).toEqual(['removed']);
  expect(SEQUENCE_MEANINGS.emptyInvitation).toBeUndefined();
});

test('business progress: Accepted = accepted, Redeemed = completed, one label per animated step (Offer sent never animates)', () => {
  expect(SEQUENCE_MEANINGS.offerProgress).toEqual({ steps: { accepted: 'accepted', redeemed: 'completed' } });
  expect(Object.keys(SEQUENCE_MEANINGS.offerProgress.steps)).toEqual(PROGRESS_STEPS.filter((st) => st !== 'sent'));
});

test('rendering transitions and gestures are reviewed one by one, never a catch-all', () => {
  expect(RENDERING_TRANSITIONS).toEqual(['error_state_fade', 'empty_state_fade']);
  expect(GESTURE_MOTIONS).toEqual(['swipe_dismiss']);
  const rendering = Object.entries(DIRECT_TIER_MEANINGS).filter(([, m]) => m && m.rendering).map(([f]) => f).sort();
  const gesture = Object.entries(DIRECT_TIER_MEANINGS).filter(([, m]) => m && m.gesture).map(([f]) => f);
  expect(rendering).toEqual(['components/FadeInState.js', 'components/LoadErrorState.js']);
  expect(gesture).toEqual(['motion/swipeDismiss.js']);
  // a reviewed rendering transition or gesture is never mislabelled as a change, and never used for a named sequence
  for (const f of [...rendering, ...gesture]) expect(Array.isArray(DIRECT_TIER_MEANINGS[f])).toBe(false);
  for (const m of Object.values(SEQUENCE_MEANINGS)) expect(!!(m && (m.rendering || m.gesture))).toBe(false);
  expect(DIRECT_TIER_MEANINGS['motion/swipeDismiss.js'].semantics).toMatch(/nothing was removed/);
});
