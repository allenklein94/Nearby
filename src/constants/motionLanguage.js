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
//   2 Business response    -- the arrival signal (pill) travels into the offer card.
//   3 Offer reveal         -- the offer card builds itself step by step, ending on "I'll take this one".
//   4 Offer acceptance     -- the same card transforms into its booked state ("You're booked" only when confirmed).
//   5 Business progress    -- Offer sent -> Accepted -> Redeemed on the business's card, live, one glow per step.
//   6 Customer redemption  -- the booked card's final step, "✓ Visit confirmed", one glow when it arrives live.
export const MARKETPLACE_MOMENTS = Object.freeze([
  { key: 'request_sent', component: 'motion/RequestPulse.js', sequence: 'requestPulse' },
  { key: 'business_response', component: 'motion/OfferTravelOverlay.js', sequence: 'offerTravel' },
  { key: 'offer_reveal', component: 'components/OfferAssembly.js', sequence: 'offerAssembly' },
  { key: 'offer_acceptance', component: 'motion/OfferAcceptedMorph.js', sequence: 'offerAccepted' },
  { key: 'business_progress', component: 'motion/OfferProgressSteps.js', sequence: 'offerProgress' },
  { key: 'customer_redemption', component: 'motion/VisitConfirmed.js', sequence: 'visitConfirmed' },
]);
