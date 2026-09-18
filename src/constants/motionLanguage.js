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
