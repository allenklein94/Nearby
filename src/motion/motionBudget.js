// Item 131 ("Create a motion budget"): Nearby's motion time budget, defined once. Nothing should
// feel sluggish, so every transition is authored against one of four tiers:
//
//   tiny     50-150 ms   button state changes, icon transitions
//   small   150-300 ms   filters, tabs, cards
//   medium  300-500 ms   plan confirmation, match state
//   special 500-900 ms   occasion celebration, surprise reveal
//
// What the budget measures: time from the trigger to the SETTLED end state (the moment the real
// content/meaning is fully on screen). It does NOT count (a) a deliberate dwell/hold before an
// auto-dismiss, or (b) ambient loading loops (NLoader/skeleton/FindingOptionsLoader pulses) -- a
// loop isn't a transition, it runs for as long as real work does. Reduce Motion (Item 127) only
// ever shortens things, so it can't exceed a tier either.
export const MOTION_BUDGET = {
  tiny: { min: 50, max: 150, ms: 120 },
  small: { min: 150, max: 300, ms: 220 },
  medium: { min: 300, max: 500, ms: 400 },
  special: { min: 500, max: 900, ms: 700 },
};

export function tierOf(ms) {
  if (ms <= MOTION_BUDGET.tiny.max) return 'tiny';
  if (ms <= MOTION_BUDGET.small.max) return 'small';
  if (ms <= MOTION_BUDGET.medium.max) return 'medium';
  if (ms <= MOTION_BUDGET.special.max) return 'special';
  return null; // over budget
}

export function isWithinBudget(ms, tier) {
  const t = MOTION_BUDGET[tier];
  return !!t && ms >= t.min && ms <= t.max;
}

// Per-sequence timing tokens, shared by the components AND the budget test so the numbers that
// run are the numbers that are checked.
export const SEQUENCES = {
  // N -> ✨ -> ✓ then text. Celebratory = occasion/plan creation; business = a transaction
  // confirming (plan/reservation confirmed).
  successCelebratory: { tier: 'special', stageMs: 240, glyphFadeMs: 150, textFadeMs: 220, stages: 3 },
  successBusiness: { tier: 'medium', stageMs: 160, glyphFadeMs: 100, textFadeMs: 160, stages: 2 },
  // 🔒 -> ✨ -> 🎉 with text landing on the last stage.
  surpriseReveal: { tier: 'special', stageMs: 280, glyphFadeMs: 170, textFadeMs: 220, stages: 3 },
  // Occasion tile micro-celebrations.
  occasionMorph: { tier: 'special', stepMs: 200, glyphFadeMs: 150, textFadeMs: 200, maxGlyphs: 3 },
  occasionLock: { tier: 'special', snapDelayMs: 300, textFadeMs: 200 },
  occasionParticles: { tier: 'special', maxDelayMs: 150, riseMs: 420, fadeMs: 260 },
  // ❤️ -> N intro, then the real match content.
  matchIntro: { tier: 'medium', stageMs: 140, stages: 2, entranceMs: 200 },
  // Result cascades.
  cascade: { tier: 'medium', maxDelayMs: 200, itemMs: 250 },
};

// Time from trigger to settled state for each sequence.
export function settleMs(name) {
  const s = SEQUENCES[name];
  switch (name) {
    case 'successCelebratory':
    case 'successBusiness':
    case 'surpriseReveal':
      // text starts as the last stage begins, then fades in.
      return s.stageMs * (s.stages - 1) + s.textFadeMs;
    case 'occasionMorph':
      return s.stepMs * s.maxGlyphs + s.textFadeMs;
    case 'occasionLock':
      return s.snapDelayMs + s.textFadeMs;
    case 'occasionParticles':
      return s.maxDelayMs + s.riseMs + s.fadeMs;
    case 'matchIntro':
      return s.stageMs * s.stages + s.entranceMs;
    case 'cascade':
      return s.maxDelayMs + s.itemMs;
    default:
      return NaN;
  }
}
