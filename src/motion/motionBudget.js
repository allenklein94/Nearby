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
  // Empty state -> invitation: the N appears, then the invitation + action settle in.
  emptyInvitation: { tier: 'medium', markMs: 200, delayMs: 180, invitationMs: 220 },
  // An open reply's card assembling itself (2026-10-09, replaces the two-beat offerReveal): business -> "Heard your request"
  // -> what they said -> the order -> price -> when, one step at a time (only the steps the reply really has). Business tone:
  // gentle fades + a slight upward settle, no bounce, no haptic. Starts after an offer travel into this card has finished.
  // Then the finish (2026-10-10): "I'll take this one" settles in as the final slot (same fade + rise, never below
  // actionRestOpacity, always tappable) while the card's coral outline glows once: in glowInMs, back out glowOutMs.
  offerAssembly: { tier: 'special', stepMs: 160, staggerMs: 100, maxSteps: 6, risePx: 6, actionRestOpacity: 0.6, glowInMs: 100, glowOutMs: 200 },
  // Offer travel (2026-10-09): dim in, the light travels from the arrival signal while the frame grows into the offer card,
  // then frame + dim fade into the real card. Waiting for the card to be on screen is a hold, not part of the transition.
  // You're booked (2026-10-09): the ring closes, the ✓ settles, one soft ripple while the facts fade in. A booking is a
  // transaction (item 122): success colour, no particles, no bounce, one ripple, done in under 0.8 s.
  booked: { tier: 'special', ringMs: 200, checkMs: 160, rippleMs: 380, textFadeMs: 220 },
  // Its exit (2026-10-09): fade + a slight shrink, then the space it took closes, so nothing below jumps.
  // The accepted offer card morphs in place (owner item 12, 2026-10-10): the ✓ settles beside the heading (owner target
  // 180-250 ms), then the booked facts and the rest of the card settle in (250-350 ms). Never delays the booking itself.
  offerAccepted: { tier: 'special', checkMs: 220, morphMs: 300, risePx: 6 },
  bookedExit: { tier: 'medium', fadeMs: 180, collapseMs: 220, shrinkTo: 0.96 },
  offerTravel: { tier: 'special', dimMs: 180, travelMs: 380, settleMs: 220, targetWaitMs: 1500 },
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
    case 'emptyInvitation':
      return s.delayMs + s.invitationMs;
    case 'cascade':
      return s.maxDelayMs + s.itemMs;
    case 'offerAssembly':
      // the content steps, then the finish slot (button + one outline glow) after the last of them
      return s.maxSteps * s.staggerMs + Math.max(s.stepMs, s.glowInMs + s.glowOutMs);
    case 'booked':
      return s.ringMs + s.checkMs + Math.max(s.rippleMs, s.textFadeMs);
    case 'offerAccepted':
      return s.checkMs + s.morphMs;
    case 'bookedExit':
      return s.fadeMs + s.collapseMs;
    case 'offerTravel':
      return s.dimMs + s.travelMs + s.settleMs;
    default:
      return NaN;
  }
}

// Ambient (non-transition) loops sit outside the tiers -- a loop isn't a transition, it runs as
// long as real loading does. One token so skeletons can't drift apart.
export const AMBIENT = { skeletonPulseMs: 700 };
