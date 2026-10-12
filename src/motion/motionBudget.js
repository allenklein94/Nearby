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
  // Owner item 30 (2026-10-11): marking Interested by your own tap. The label scales back from pulseFrom once (a small pulse,
  // no bounce) and reads "✓ Saved" for savedHoldMs (a dwell, not counted), then returns to "★ Interested". No haptic
  // (item 129: low-commitment and private, not an important state change).
  interestedSaved: { tier: 'small', pulseMs: 240, pulseFrom: 1.12, savedHoldMs: 1200 },
  // Owner item 31 (2026-10-11): Interested -> Attending, the person's own commitment (auto-approved join from Interested).
  // Contrast (owner, 2026-10-11): the struck former label (textSecondary) never drops below 4.5:1 on the panel in either theme
  // at ANY frame: it fades only to oldRestOpacity 0.88 (0.85 measured 4.47:1 in light). "✓ Attending" never fades: full opacity
  // from frame one (large text: 20 px bold, and fromScale 0.94 keeps even its first frame at 18.8 px >= 18.66, 3.78:1 light /
  // 7.65:1 dark); its motion is the slide, the grow and the glow. Easing never overshoots, so the rest values are the minimums.
  // "★ Interested" dims to oldRestOpacity and is struck through while "✓ Attending" flows in flowPx from beside it (scale
  // fromScale -> 1, readable from frame one), then one success glow around it. Calm: no bounce, confetti or loop.
  interestedToAttending: { tier: 'special', dimMs: 220, arriveDelayMs: 120, arriveMs: 320, flowPx: 12, fromScale: 0.94, oldRestOpacity: 0.88,
    glowInMs: 100, glowOutMs: 220 },
  // Owner item 34 (2026-10-11): a gathering you attended is over. Its Home plan card shows the move once, quietly: "Confirmed"
  // dims and is struck through (to oldRestOpacity, still readable) while "✓ Completed" slides in beside it (flowPx, from
  // fromScale, full opacity from frame one). No glow, no haptic: a calm close, smaller than item 31's join (medium tier).
  planCompleted: { tier: 'medium', dimMs: 200, arriveDelayMs: 80, arriveMs: 240, flowPx: 8, fromScale: 0.96, oldRestOpacity: 0.88 },
  // Owner item 32 (2026-10-11): the accepted offer merges into Your Plan. startDelayMs after the booked card mounts (its ✓ is
  // settling), a "✓ Business" chip travels from the offer card up into the plan card (travelMs; it fades only over its last
  // stretch, from chipFadeFrom, and shrinks to chipToScale). Then, in the same moment (owner decision B, 2026-10-11: one
  // moment, not a second "lock" after it), the plan assembles (offerToPlanAssembly): its four lines (activity, time, place,
  // people) settle one after another (lineStaggerMs apart, lineMs each, from lineFlowPx below, never below the info floor),
  // the business's logo settles into the place line as that line does (logoMs, from logoFromScale), the connecting line draws
  // top to bottom as the last line arrives (drawMs), then the card's outline glows once (glowInMs + glowOutMs). Start and
  // travel were shortened (180 -> 100, 380 -> 280) to make room; the whole moment stays under 0.9 s (special tier).
  offerToPlan: { tier: 'special', startDelayMs: 100, travelMs: 280, chipFadeFrom: 0.7, chipToScale: 0.92,
    lines: 4, placeLine: 2, lineStaggerMs: 35, lineMs: 120, lineFlowPx: 6, logoMs: 140, logoFromScale: 0.7, drawMs: 120,
    glowInMs: 80, glowOutMs: 160 },
  happeningRipple: { tier: 'medium', ringMs: 400, fromScale: 0.6, toScale: 2.2, startOpacity: 0.35, size: 24 },
  // Owner item 36: the weather card's wash fades in once when the weather changes (motion/WeatherShift.js). Slow on purpose.
  weatherShift: { tier: 'special', washMs: 800 },
  // Owner item 37: the strong-match pieces tick in one after another, then the badge settles (motion/StrongMatch.js).
  strongMatch: { tier: 'medium', pieces: ['activity', 'time', 'place'], pieceMs: 180, staggerMs: 80, badgeDelayMs: 260, badgeMs: 180, badgeFromScale: 0.9 },
  // Owner item 40: you + a nearby friend converge on a gathering you both like: the two faces slide together and overlap, then
  // the line settles (motion/FriendCollision.js). Once per (friend, gathering) per session.
  friendCollision: { tier: 'medium', avatarMs: 280, travelPx: 10, textDelayMs: 160, textMs: 200 },
  // Owner item 41: "Your people are doing things" -- the friends' faces appear one after another, each plan's activity glyph
  // lands on its face, then the line settles (motion/FriendsPlanning.js). Only when the set of friends' plans has something new.
  // Owner item 45 (2026-10-11): the search understanding moment. The chips of what Nearby read from a typed ask (WHAT / WHEN /
  // WHERE / WHO, utils/askUnderstood.js) settle in one after another (staggerMs apart, pieceMs each, risePx below, never below
  // the info floor) the first time that ask is understood; afterwards they are simply there. No glow, no haptic, no loop.
  askUnderstood: { tier: 'small', maxPieces: 4, pieceMs: 160, staggerMs: 40, risePx: 4 },
  // Owner item 46 (2026-10-11): after the person's own refinement tap lands, the soft emphasis on the next refinement step's
  // chips (components/AskRefinementChips.js) fades in. Pure decoration behind the label (the label never moves or fades).
  refineNextStep: { tier: 'small', fadeMs: 200 },
  // Owner item 48 (2026-10-11): the business's mirror of moment 1. A new opportunity card rises risePx into place (text
  // readable from frame one, buttons live at once) while requestPulse's own rings go out from its ✨ headline glyph. Several
  // arriving together play one after another (slotStaggerMs apart, at most maxSlots; motion/OpportunityArrival.js).
  opportunityArrival: { tier: 'medium', riseMs: 240, risePx: 8, ringSize: 44, slotStaggerMs: 120, maxSlots: 3 },
  // Owner item 47 (2026-10-11): an open offer's countdown bar (components/OfferCountdown.js) eases to its new length when the
  // real minute changes (the screen re-renders at each change). No loop, no pulse, no flash; the text itself never animates.
  offerCountdown: { tier: 'small', easeMs: 240, barPx: 3 },
  // Owner item 44 (2026-10-11): a business pin tapped on Discover's map grows into its business sheet. The sheet still opens at
  // the tap (its text readable from frame one, never below the info floor; its buttons live at once): it rises risePx and
  // grows from fromScale while the backdrop dims (sheetMs), and a pin-coloured outline frame grows from the pin's spot into
  // the sheet's outline and fades as it lands (frameMs). Outline only, takes no touches. The pin's on-screen spot is read from
  // the map; if it is not known within originWaitMs (a hold, not counted) the sheet just rises without the frame.
  // Replaces the sheet's plain slide (no added motion); Reduce Motion = the plain fade every modal uses.
  pinToSheet: { tier: 'medium', originWaitMs: 120, sheetMs: 260, frameMs: 320, risePx: 16, fromScale: 0.96, pinSize: 28, framePeakOpacity: 0.9 },
  friendsPlanning: { tier: 'medium', maxPeople: 3, avatarMs: 200, staggerMs: 60, fromScale: 0.85, chipDelayMs: 160, chipMs: 180, chipRise: 6, lineDelayMs: 340, lineMs: 160 },
};

// Owner item 32 + confirmed-plan look (2026-10-11): the plan's assembly after the chip lands, in ms from the landing. One
// schedule shared by the component (OfferToPlanMerge.js) and the budget, so what runs is what is checked. Order: the lines
// one after another; the logo with the place line; the connecting line draws as the last line arrives and finishes with it;
// then the one glow.
export function offerToPlanAssembly(s = SEQUENCES.offerToPlan) {
  const lines = Array.from({ length: s.lines }, (_, i) => ({ start: i * s.lineStaggerMs, end: i * s.lineStaggerMs + s.lineMs }));
  const last = lines[lines.length - 1];
  const logo = { start: lines[s.placeLine].start, end: lines[s.placeLine].start + s.logoMs };
  const draw = { start: Math.max(last.end - s.drawMs, 0), end: last.end };
  const glowStart = Math.max(last.end, logo.end, draw.end);
  return { lines, logo, draw, glowStart, settleMs: glowStart + s.glowInMs + s.glowOutMs };
}

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
    case 'offerToPlan':
      return s.startDelayMs + s.travelMs + offerToPlanAssembly(s).settleMs;
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
    case 'weatherShift':
      return s.washMs;
    case 'strongMatch':
      return Math.max(s.staggerMs * (s.pieces.length - 1) + s.pieceMs, s.badgeDelayMs + s.badgeMs);
    case 'opportunityArrival':
      return Math.max(s.riseMs, settleMs('requestPulse'));
    case 'offerCountdown':
      return s.easeMs;
    case 'refineNextStep':
      return s.fadeMs;
    case 'askUnderstood':
      return s.staggerMs * (s.maxPieces - 1) + s.pieceMs;
    case 'pinToSheet':
      return Math.max(s.sheetMs, s.frameMs);
    case 'friendCollision':
      return Math.max(s.avatarMs, s.textDelayMs + s.textMs);
    case 'friendsPlanning':
      return Math.max(s.staggerMs * (s.maxPeople - 1) + s.avatarMs, s.chipDelayMs + s.staggerMs * (s.maxPeople - 1) + s.chipMs, s.lineDelayMs + s.lineMs);
    case 'interestedSaved':
      return s.pulseMs;
    case 'planCompleted':
      return Math.max(s.dimMs, s.arriveDelayMs + s.arriveMs);
    case 'interestedToAttending':
      return Math.max(s.dimMs, s.arriveDelayMs + s.arriveMs + s.glowInMs + s.glowOutMs);
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
