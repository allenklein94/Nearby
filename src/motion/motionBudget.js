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
  // Owner item 25 (2026-10-11): ONE exception, for ONE moment -- a business responding to your request (SIGNATURE_MOMENT).
  // Up to ~1.5 s, still calm (no confetti, particles, bounce), information readable from the first frame, identical for every
  // business. Not permission for category animations or more motion anywhere else (guard: motionBudget.test.js).
  signature: { min: 900, max: 1500, ms: 1300 },
};
export const SIGNATURE_MOMENT = 'businessResponds';

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
// Owner item 19 (2026-10-10, LOCKED): animation never delays the person. Any text that carries information (a price, a
// time, a status, a confirmation) is readable from the FIRST frame: it never starts below INFO_REST_OPACITY and is never
// held back waiting for another animation; motion only settles it the rest of the way. Pure decoration (a ring, a ✓, a
// ripple, a glow, a pulse) may start from nothing. Use infoOpacity(v) for any information-carrying Animated.View.
export const INFO_REST_OPACITY = 0.6;
export function infoOpacity(v) {
  return v.interpolate({ inputRange: [0, 1], outputRange: [INFO_REST_OPACITY, 1] });
}

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
  offerAssembly: { tier: 'special', stepMs: 160, staggerMs: 100, maxSteps: 6, risePx: 6, actionRestOpacity: 0.6 /* = INFO_REST_OPACITY */, glowInMs: 100, glowOutMs: 200,
    washInMs: 180, washOutMs: 320, washOpacity: 0.14 },
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
  // The business side of it (owner item 13, 2026-10-10): on the opportunity card the newly reached step (Accepted /
  // Redeemed) fades in with a slight rise while the card's outline glows once. Arrival-driven: no haptic.
  offerProgress: { tier: 'small', stepMs: 200, risePx: 6, glowInMs: 100, glowOutMs: 200 },
  // Request sent (2026-10-10, moment 1 of the marketplace sequence): one or two soft rings go out from the confirmation
  // line and fade, only when at least one business was really reached. Arrival of nothing yet: no haptic of its own.
  requestPulse: { tier: 'medium', ringMs: 380, staggerMs: 100, rings: 2, fromScale: 0.6, toScale: 1.8, startOpacity: 0.35 },
  // Customer-side redemption (moment 6): "Visit confirmed" settles in on the booked card + one success outline glow.
  visitConfirmed: { tier: 'small', stepMs: 200, risePx: 6, glowInMs: 100, glowOutMs: 200 },
  // A business's sent reply is being checked (owner item 16): the responding line fades in with one small dot pulse.
  responding: { tier: 'small', fadeMs: 200, pulseMs: 260 },
  // Someone joined the host's gathering while the host had it open (item 15, 2026-10-10): the Going line glows once.
  hostJoin: { tier: 'small', glowInMs: 100, glowOutMs: 200 },
  // Owner item 25 #3: the same live join, as a moment. The Going figure rolls (the old number lifts away, the new one rises
  // in, readable from frame one), the new person's avatar settles into the front of Who's going (fade + slight grow, no
  // bounce), and a "Maya joined" line settles in under the figure. Host only, live only, no haptic (the host did not tap).
  // Owner item 25 #4: the plan comes together (every piece confirmed, seen happen). Its pieces settle in one after another
  // (slight rise, readable from frame one), then the plan's outline glows once in the success colour. Reservations are
  // business transactions, so calm (item 122): no bounce, particles or confetti.
  planTogether: { tier: 'special', staggerMs: 90, pieceMs: 200, maxPieces: 4, risePx: 4, glowInMs: 100, glowOutMs: 200 },
  // Owner item 28: the avatar flows in from flowPx before its place while the faces already there ease aside (same avatarMs).
  // Item 28 follow-up (owner, 2026-10-11): several people in ONE update arrive one after another, staggerMs apart; arrivals
  // past maxStaggered land with the last staggered one, so the whole sequence stays inside the special tier.
  friendJoin: { tier: 'special', rollMs: 260, risePx: 8, avatarMs: 320, avatarFromScale: 0.8, flowPx: 24, lineDelayMs: 80, lineMs: 220,
    staggerMs: 120, maxStaggered: 5 },
  // Item 25: the travel is part of the signature moment. The light follows a gentle arc (arcPx at most, never more than
  // arcShare of the distance) with a soft halo; the frame is an outline only (never covers the card's text); on landing one
  // ring converges onto the card (the request's rings went out, the answer's ring comes back in) while the dim and frame fade.
  offerTravel: { tier: 'special', dimMs: 180, travelMs: 420, settleMs: 300, targetWaitMs: 1500, arcPx: 72, arcShare: 0.25,
    ringMs: 380, ringFromScale: 2.2, ringToScale: 0.6, ringPeakOpacity: 0.35, ringSize: 64, haloOpacity: 0.3 },
  // The signature moment (item 25): the travel, then -- starting the moment it lands, overlapping its settle -- the card
  // building itself in (offerAssembly), whose price step gets one soft coral wash (washInMs + washOutMs, washOpacity).
  businessResponds: { tier: 'signature' },
  // Owner item 26: something is happening near you. One soft ring from the happening-now heading icon, only when that section
  // shows a gathering not yet shown this session (Home + Discover share the record). The rows never move.
  happeningRipple: { tier: 'medium', ringMs: 400, fromScale: 0.6, toScale: 2.2, startOpacity: 0.35, size: 24 },
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
    case 'offerAssembly':
      // the content steps, then the finish slot (button + one outline glow) after the last of them
      return s.maxSteps * s.staggerMs + Math.max(s.stepMs, s.glowInMs + s.glowOutMs);
    case 'booked':
      return s.ringMs + s.checkMs + Math.max(s.rippleMs, s.textFadeMs);
    case 'offerAccepted':
      return s.checkMs + s.morphMs;
    case 'bookedExit':
      return s.fadeMs + s.collapseMs;
    case 'offerProgress':
    case 'visitConfirmed':
      return Math.max(s.stepMs, s.glowInMs + s.glowOutMs);
    case 'responding':
      return Math.max(s.fadeMs, s.pulseMs);
    case 'hostJoin':
      return s.glowInMs + s.glowOutMs;
    case 'planTogether':
      return s.maxPieces * s.staggerMs + Math.max(s.pieceMs, s.glowInMs + s.glowOutMs);
    case 'friendJoin':
      // worst case: the last staggered arrival (and the faces easing aside, which finish with it)
      return Math.max(s.rollMs, s.staggerMs * (s.maxStaggered - 1) + s.avatarMs, s.lineDelayMs + s.lineMs);
    case 'requestPulse':
      return s.staggerMs * (s.rings - 1) + s.ringMs;
    case 'happeningRipple':
      return s.ringMs;
    case 'offerTravel':
      return s.dimMs + s.travelMs + s.settleMs;
    case 'businessResponds': {
      // from the card's position being known: travel, then the longest of (ring, settle, the full card assembly)
      const t = SEQUENCES.offerTravel;
      return t.travelMs + Math.max(t.ringMs, t.settleMs, settleMs('offerAssembly'));
    }
    default:
      return NaN;
  }
}

// Ambient (non-transition) loops sit outside the tiers -- a loop isn't a transition, it runs as
// long as real loading does. One token so skeletons can't drift apart.
// Owner item 22 (2026-10-11, battery): an ambient loop never runs for ever. motionPolicy.js stops every Animated.loop after
// maxLoopMs of running (the loader then simply sits still, its static state) and pauses it while the app is in the background.
export const AMBIENT = { skeletonPulseMs: 700, maxLoopMs: 20000 };
