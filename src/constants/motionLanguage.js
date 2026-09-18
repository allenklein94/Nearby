// The Nearby Motion Language -- a locked glyph vocabulary for every animation/loading/status
// moment in the app, so each new feature draws from one shared meaning instead of reinventing
// its own. See CLAUDE.md's Standing Conventions for the locked rule; this file is the reference
// table other components should consult before picking a glyph for a new animated moment.
//
//   N  (NearbyMark)  -- system intelligence: loading, searching, finding, matching, building
//                       recommendations. Used by BrandedLoader, FindingOptionsLoader,
//                       PlanCreatedCelebration's opening frame.
//   ✨ -- discovery / recommendation: Nearby found something particularly relevant. Used as the
//                       "something happened" transition beat between two other glyphs (e.g.
//                       N -> ✨ -> ✓, 🎂 -> ✨ -> 🎈), not as a standalone icon on its own.
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
export const NEARBY_MOTION_LANGUAGE_DOC_ONLY = true;
