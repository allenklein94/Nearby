// The Nearby Motion Language -- a locked glyph vocabulary for every animation/loading/status
// moment in the app, so each new feature draws from one shared meaning instead of reinventing
// its own. See CLAUDE.md's Standing Conventions for the locked rule; this file is the reference
// table other components should consult before picking a glyph for a new animated moment.
//
//   N  (NearbyMark)  -- system intelligence: loading, searching, finding, matching, building
//                       recommendations. Used by NLoader, FindingOptionsLoader,
//                       SuccessAnimation's opening frame.
//   ✨ -- discovery / recommendation: Nearby found something particularly relevant. Used as the
//                       "something happened" transition beat between two other glyphs (e.g.
//                       N -> ✨ -> ✓, 🎂 -> ✨ -> 🎈). Item 125 ("Make 'Nearby found this for
//                       you' visually recognizable") added one deliberate, disclosed second
//                       meaning: a standalone "✨ Nearby Pick" badge (NearbyPickBadge,
//                       src/motion/) on the single real top-scored result of a genuine, user-
//                       STATED intent search -- never a generic "found something" icon slapped
//                       on every card. Both meanings share the glyph on purpose (discovery is
//                       discovery, whether mid-transition or labeling a real pick) -- see
//                       NearbyPickBadge's own header comment for exactly which lists qualify.
//   ❤️ -- connection (romantic): a dating match. NOT used for friend connections (see 🤝 below)
//                       or for celebration.
//   🤝 -- connection (platonic): a friend match, an organizer/co-organizer relationship, "Plan
//                       Together". This app's own established handshake motif predates this
//                       vocabulary and is kept as ❤️'s platonic sibling rather than collapsed
//                       into one generic "connection" glyph -- romantic and platonic connection
//                       read as different things throughout this app and should keep reading
//                       that way.
//   🎉 -- celebration: an occasion, a successful/confirmed plan, a milestone. NOT used for a
//                       match/connection moment (that's ❤️/🤝) even though a new match is also a
//                       "positive" moment -- keeping the two separate is the whole point of
//                       having a vocabulary instead of reaching for whichever emoji feels festive.
//   ✓  -- completion: a plan confirmed, a reservation confirmed, a request accepted.
//   🔒 -- privacy / surprise: surprise mode, a private/invite-only plan.
//
// This file intentionally exports nothing executable -- it's documentation other components
// reference in their own header comments, not a runtime dependency. Per-occasion icons (🎂/💍/🎓/
// etc, see businessAttributes.js's occasionIcon()) are a separate, larger vocabulary and are not
// part of this core 6-glyph system.
//
// Motion INTENSITY, not just glyph choice (Item 122, "Don't overanimate the business
// experience"): an occasion-creation moment (a plan being born, a birthday/anniversary tile
// pick, a community going live) can stay playful -- the full N -> ✨ -> ✓ production. A real
// business TRANSACTION confirming (a business's offer accepted, a reservation locking in)
// should feel fast + trustworthy + professional instead -- reassuring, not festive. See
// SuccessAnimation's `tone` prop ("celebratory" default vs. "business": no ✨ discovery beat,
// roughly half the duration, no springy overshoot). Same content/meaning either way -- only how
// loud the motion is changes with the context.
export const NEARBY_MOTION_LANGUAGE_DOC_ONLY = true;

// The marketplace sequence (2026-10-10, owner-approved; one transaction told in six moments, never random effects).
// Every animation on the request -> offer -> booking -> visit path belongs to exactly ONE of these, in this order; a new
// marketplace animation must slot into one of them (extend it) instead of inventing another effect. Shared rules: one
// timing budget (src/motion/motionBudget.js, each moment's SEQUENCES token below), Reduce Motion = the settled state,
// vibration only after the person's own tap, transaction tone (success colour, no confetti, no bounce, no loop), and
// every moment shows a state that is already stored, never one the animation implies.
//   1 Request sent         -- an outward pulse from the confirmation line, only when a business was really reached.
//                             Its business-side mirror (owner item 48): the new opportunity card arrives on the business's
//                             dashboard with the same pulse from its ✨ headline (motion/OpportunityArrival.js).
//   2 Business response    -- the arrival signal (pill) travels into the offer card.
//   3 Offer reveal         -- the offer card builds itself step by step, ending on "I'll take this one".
//   4 Offer acceptance     -- the same card transforms into its booked state ("You're booked" only when confirmed).
//   5 Business progress    -- Offer sent -> Accepted -> Redeemed on the business's card, live, one glow per step.
//   6 Customer redemption  -- the booked card's final step, "✓ Visit confirmed", one glow when it arrives live.
export const MARKETPLACE_MOMENTS = Object.freeze([
  { key: 'request_sent', component: 'motion/RequestPulse.js', sequence: 'requestPulse',
    businessSide: { component: 'motion/OpportunityArrival.js', sequence: 'opportunityArrival' } },
  { key: 'business_response', component: 'motion/OfferTravelOverlay.js', sequence: 'businessResponds' },
  { key: 'offer_reveal', component: 'components/OfferAssembly.js', sequence: 'offerAssembly' },
  { key: 'offer_acceptance', component: 'motion/OfferAcceptedMorph.js', sequence: 'offerAccepted' },
  { key: 'business_progress', component: 'motion/OfferProgressSteps.js', sequence: 'offerProgress' },
  { key: 'customer_redemption', component: 'motion/VisitConfirmed.js', sequence: 'visitConfirmed' },
]);

// Owner item 55 (2026-10-12, LOCKED): the Nearby Pulse (motion/NearbyPulse.js) is the one motion language for a CONNECTION --
// a signal that starts at one thing and reaches another. Every connection moment is listed here with the Pulse form it uses
// (ring / still / journey) and its own approved tokens; a NEW connection moment is added here and reuses the Pulse, never a
// bespoke animation (guard: motion/nearbyPulse.test.js). The business-responds travel is the ONE signature moment and stays
// outside the Pulse, distinct and larger (SIGNATURE_MOMENT in motion/motionBudget.js).
export const PULSE_MOMENTS = Object.freeze([
  { key: 'request_sent', form: 'ring', component: 'motion/RequestPulse.js', sequence: 'requestPulse', from: 'the person\'s request', to: 'the businesses it reached' },
  { key: 'signal_received', form: 'ring', component: 'motion/OpportunityArrival.js', sequence: 'requestPulse', from: 'a request', to: 'the business\'s opportunity card' },
  { key: 'happening_near_you', form: 'ring', component: 'motion/HappeningRipple.js', sequence: 'happeningRipple', from: 'a gathering happening now', to: 'the person\'s Right Now section' },
  { key: 'right_now_mark', form: 'still', component: 'components/RightNowMark.js', sequence: null, from: 'what is happening nearby', to: 'the Right Now heading' },
  { key: 'pin_to_sheet', form: 'journey', component: 'motion/PinToSheetFrame.js', sequence: 'pinToSheet', from: 'a place on the map', to: 'its business sheet' },
]);
// Owner item 57 (2026-10-12, documentation only): three motion LEVELS, mapped exactly onto the existing timing tiers in
// motion/motionBudget.js. They name how loud a moment may be; they change no animation, timing, component or interaction, and
// they never move a moment between tiers. Use them to judge a motion request ("is this Level 1, 2 or 3?").
//   Level 1 micro       -- quiet, functional motion, only where the existing locks permit it (buttons, state changes, loading,
//                          small confirmations). Cards and lists stay static, recommendations appear statically, and map/list
//                          mode or filter changes stay instant (item 15).
//   Level 2 contextual  -- meaningful moments (incl. most of the marketplace sequence): memorable and recognizable, never a
//                          signature. Offer acceptance, redemption, the first business interaction (words only, items 51/52) and
//                          plan formation (items 25 #4, 43) stay at their approved behavior and tier.
//   Level 3 signature   -- exactly ONE moment: a business responds to a customer's request (SIGNATURE_MOMENT).
// Guard: motion/motionLevels.test.js.
export const MOTION_LEVELS = Object.freeze([
  { level: 1, key: 'micro', tiers: ['tiny', 'small'] },
  { level: 2, key: 'contextual', tiers: ['medium', 'special'] },
  { level: 3, key: 'signature', tiers: ['signature'] },
]);
export function motionLevelOf(tier) {
  const found = MOTION_LEVELS.find((l) => l.tiers.includes(tier));
  return found ? found.level : null;
}
// Owner item 58 (2026-10-12, LOCKED): animation must explain something. It shows a real change, a meaningful connection, or a
// narrowly documented exception; decoration alone is not enough. Every animation sequence (SEQUENCES in motion/motionBudget.js)
// and every file that animates on a raw tier token (MOTION_BUDGET.<tier>.ms) declares what it communicates, using only this
// vocabulary, and a label is used only when it accurately describes the animation's purpose. Registering a meaning changes no
// timing or motion. Guard: motion/motionMeaning.test.js.
export const MOTION_MEANINGS = Object.freeze([
  // the owner's six
  'new', 'available', 'connected', 'accepted', 'confirmed', 'completed',
  // the owner's approved extras
  'saved', 'working', 'ending', 'understood', 'changed', 'next_step', 'matched',
  // the booked card's exit (owner decision 4: kept because it communicates removal)
  'removed',
]);
// Approved exceptions: celebratory, not a change. Kept as they are; no particles, duration or effects may be added; revisit only
// if real usage or device testing shows a problem.
export const MOTION_EXCEPTIONS = Object.freeze({
  occasion_celebration: {
    sequences: ['occasionMorph', 'occasionLock', 'occasionParticles'],
    component: 'motion/OccasionAnimation.js',
    why: 'Choosing Birthday, Anniversary, Graduation, Celebration or Surprise is an inherently celebratory interaction.',
  },
});
export const SEQUENCE_MEANINGS = Object.freeze({
  successCelebratory: ['confirmed'], // a plan/occasion was really created
  successBusiness: ['confirmed'], // a transaction confirmed
  surpriseReveal: ['changed'], // the surprise is now revealed (after the reveal RPC succeeded)
  occasionMorph: { exception: 'occasion_celebration' },
  occasionLock: { exception: 'occasion_celebration' },
  occasionParticles: { exception: 'occasion_celebration' },
  matchIntro: ['connected'],
  offerAssembly: ['new'],
  booked: ['confirmed'],
  offerAccepted: ['accepted'],
  bookedExit: ['removed'],
  // per step: only a real move forward plays (utils/offerProgress.js offersToAnimate); 'sent' never animates
  offerProgress: { steps: { accepted: 'accepted', redeemed: 'completed' } }, // Accepted = offer accepted; Redeemed = status completed
  requestPulse: ['connected'],
  visitConfirmed: ['completed'],
  responding: ['working'],
  hostJoin: ['new'],
  planTogether: ['confirmed'],
  friendJoin: ['new'],
  offerTravel: ['new'],
  businessResponds: ['new'], // the ONE Level 3 signature
  interestedSaved: ['saved'],
  interestedToAttending: ['confirmed'],
  planCompleted: ['completed'],
  offerToPlan: ['confirmed'],
  happeningRipple: ['new'],
  weatherShift: ['changed'],
  strongMatch: ['matched'],
  friendCollision: ['connected'],
  askUnderstood: ['understood'],
  refineNextStep: ['next_step'],
  opportunityArrival: ['new'],
  offerCountdown: ['ending'],
  pinToSheet: ['connected'],
  friendsPlanning: ['new'],
});
// Files that animate on a raw tier token instead of a named sequence. Each is ONE of: a meaning (a real change, from the
// vocabulary), a reviewed RENDERING transition (routine appearance after loading; not claimed as a change), or part of a GESTURE
// (motion that follows the person's finger). Rendering and gesture entries are reviewed one by one (owner, 2026-10-12): never a
// catch-all, behavior unchanged, not retired without examining their purpose.
export const DIRECT_TIER_MEANINGS = Object.freeze({
  'screens/DiscoveryScreen.js': ['changed'], // the Undo toast: your own action just took effect and can be undone
  'motion/swipeDismiss.js': { gesture: 'swipe_dismiss', semantics: 'cancelled swipe: the item settles back to its place (restored); nothing was removed. A completed dismiss runs onDismiss at once and animates nothing here.' },
  'screens/ViewProfileScreen.js': ['connected'], // "just connected" toast
  'motion/SuccessToast.js': ['confirmed'],
  'components/OfferArrivalSignal.js': ['new'], // the arrival pill
  'components/AnimatedMessageBubble.js': ['new'], // a message arrived
  'components/FriendDiscoverySwipeCards.js': ['removed'], // the card flies off the deck after your swipe (forceSwipe)
  'components/SwipeableDiscoveryCards.js': ['removed'],
  'components/CelebrationHeaderIcon.js': ['changed'], // plays only when its changeKey really changes, never on mount
  'components/GatheringPublishedPanel.js': ['new'], // the gathering was published
  'components/LoadErrorState.js': { rendering: 'error_state_fade', purpose: 'the shared "couldn\'t load, try again" state fades in instead of snapping into place; it marks no change beyond the load having ended. Kept as is.' },
  'components/FadeInState.js': { rendering: 'empty_state_fade', purpose: 'the plain (non-opportunity) empty state fades in instead of snapping into place after a load. Kept as is; its invitation entrance is retired.' },
});
// The reviewed lists, kept exact by the guard: adding to either is a review decision, not a default.
export const RENDERING_TRANSITIONS = Object.freeze(['error_state_fade', 'empty_state_fade']);
export const GESTURE_MOTIONS = Object.freeze(['swipe_dismiss']);
// Owner item 100 (2026-10-15, documentation only): the Nearby Motion System's eight PRIMITIVES name the FORM a moment takes;
// MOTION_MEANINGS above names what it communicates. Every existing sequence (SEQUENCES in motion/motionBudget.js) is listed
// once below with its primitive, the real event or state change it shows, and the item that approved it. This map DESCRIBES
// existing behavior: it changes no animation, timing or component, authorizes no new motion, and is never a reason to move,
// alter or unify an approved moment for consistency (item 56). Ambient stays exactly its two listed cases (item 99: no
// animated backgrounds, moving cards or decorative motion). Guard: motion/motionPrimitives.test.js.
export const MOTION_PRIMITIVE_NAMES = Object.freeze([
  'pulse', // something is being transmitted
  'flow', // something moves from A to B
  'merge', // two things became connected
  'reveal', // something new became available
  'transform', // an object's state changed
  'assemble', // a plan is coming together
  'complete', // something finished
  'ambient', // the environment is alive, never demanding attention
]);
export const MOTION_PRIMITIVES = Object.freeze({
  requestPulse: { primitive: 'pulse', item: '55', communicates: 'your request really went out to the businesses it reached; the same rings mark a request reaching a business\'s card' },
  happeningRipple: { primitive: 'pulse', item: '26/55', communicates: 'a gathering happening now that this session has not shown yet appeared in the Right Now section' },
  pinToSheet: { primitive: 'pulse', item: '44/55', communicates: 'the business sheet you opened belongs to the map pin you tapped' },
  offerTravel: { primitive: 'flow', item: '23', communicates: 'the reply announced by the arrival pill is this card on the request screen' },
  businessResponds: { primitive: 'flow', item: '25', communicates: 'a real nearby business answered your request (the ONE signature moment)' },
  friendJoin: { primitive: 'flow', item: '28/73', communicates: 'a person really joined the host\'s gathering and is now in Who\'s going' },
  offerToPlan: { primitive: 'merge', item: '32', communicates: 'your confirmed booking is now part of Your Plan' },
  friendCollision: { primitive: 'merge', item: '40', communicates: 'you and the nearby friend both declared this card\'s interest' },
  matchIntro: { primitive: 'merge', item: 'match', communicates: 'two people really matched with each other' },
  offerAssembly: { primitive: 'reveal', item: '21', communicates: 'a newly received reply is on screen, built from its real parts' },
  opportunityArrival: { primitive: 'reveal', item: '48', communicates: 'a still-answerable opportunity new to this device reached the business' },
  askUnderstood: { primitive: 'reveal', item: '45', communicates: 'what Nearby understood from the words of this ask' },
  refineNextStep: { primitive: 'reveal', item: '46', communicates: 'the next unanswered refinement step became available after your tap' },
  strongMatch: { primitive: 'reveal', item: '37', communicates: 'the top pick really matches the stated activity, time and close distance' },
  surpriseReveal: { primitive: 'reveal', item: 'surprise', communicates: 'the surprise is revealed after the reveal call succeeded' },
  hostJoin: { primitive: 'reveal', item: '25 #2', communicates: 'a new join arrived on the host\'s own gathering card' },
  offerAccepted: { primitive: 'transform', item: '12', communicates: 'the same offer card became its booked state' },
  offerProgress: { primitive: 'transform', item: '13', communicates: 'the business\'s offer really moved forward (Accepted, Redeemed)' },
  interestedSaved: { primitive: 'transform', item: '30', communicates: 'your own tap saved this gathering as Interested' },
  interestedToAttending: { primitive: 'transform', item: '31', communicates: 'your confirmed attendance replaced Interested' },
  offerCountdown: { primitive: 'transform', item: '47', communicates: 'an open offer\'s real last 30 minutes, one real minute at a time' },
  bookedExit: { primitive: 'transform', item: 'booked', communicates: 'the GroupPlan booked card leaves after its hold (removed)' },
  planTogether: { primitive: 'assemble', item: '25 #4/43', communicates: 'every required piece of the plan is confirmed, or the gathering was published' },
  friendsPlanning: { primitive: 'assemble', item: '41', communicates: 'friends\' plans not shown before came together on Home' },
  planCompleted: { primitive: 'complete', item: '34', communicates: 'an attended gathering is over: Confirmed became Completed' },
  visitConfirmed: { primitive: 'complete', item: '52', communicates: 'the business confirmed your visit' },
  booked: { primitive: 'complete', item: 'booked', communicates: 'the group plan\'s reservation is really confirmed' },
  successCelebratory: { primitive: 'complete', item: 'success', communicates: 'a plan or occasion was really created' },
  successBusiness: { primitive: 'complete', item: 'success', communicates: 'a transaction was really confirmed' },
  responding: { primitive: 'ambient', item: '22/132', communicates: 'Nearby is working on your ask (a capped loader, paused in the background)' },
  weatherShift: { primitive: 'ambient', item: '36', communicates: 'the weather condition changed today (Home weather card only, once)' },
  // item 58's ONE approved exception, kept exactly as it is (incl. its existing particles); listed, never extended
  occasionMorph: { primitive: 'transform', item: '58 exception', exception: 'occasion_celebration', communicates: 'the chosen occasion tile became selected' },
  occasionLock: { primitive: 'transform', item: '58 exception', exception: 'occasion_celebration', communicates: 'the chosen occasion locked in as the plan\'s occasion' },
  occasionParticles: { primitive: 'transform', item: '58 exception', exception: 'occasion_celebration', communicates: 'the chosen occasion tile became selected (celebratory, the only particles in the app)' },
});
