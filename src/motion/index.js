// The Nearby Motion System (CLAUDE.md Item 113, locked 2026-09-18).
//
// A small, reusable motion library so a future feature automatically
// inherits Nearby's own visual language instead of hand-coding a new
// animation from scratch. Every piece here follows the two standing
// conventions already locked in CLAUDE.md:
//   - The Nearby Motion Language: a fixed glyph vocabulary (N = system
//     intelligence, ✨ = discovery, ❤️/🤝 = connection, 🎉 = celebration,
//     ✓ = completion, 🔒 = privacy/surprise) -- see motionLanguage.js.
//   - Animation discipline: animations reinforce meaning, hierarchy, state
//     changes or feedback -- never "because we can." Short, subtle,
//     interruptible, Reduce-Motion-aware (useReduceMotion.js), and never
//     gate or slow down a real button/action.
//
// Import from here going forward, e.g. `import { NLoader } from
// '../motion'`. TapActiveChip/useTapActivate (Item 117) are the control-side half of the
// cause-and-effect pattern ModeTransition/FilterTransition (Items 114-116) started on the results
// side: a chip/tab/toggle should visibly confirm it was the thing tapped, not just its results.
// All six of the original component locations under
// src/components/ (BrandedLoader, PlanCreatedCelebration,
// OccasionSelectAnimation, SurpriseRevealAnimation, MatchCelebrationModal,
// FriendMatchCelebrationModal) were thin shims kept only so the many
// existing call sites didn't all need to change at once -- every real call
// site has since been migrated to import from here directly, so all six
// shim files were deleted (2026-09-18).
export { default as NLoader } from './NLoader';
export { default as SuccessAnimation } from './SuccessAnimation';
export { default as MatchAnimation } from './MatchAnimation';
export { default as OccasionAnimation, OCCASION_SELECT_ANIMATIONS } from './OccasionAnimation';
export { default as SurpriseRevealAnimation, SURPRISE_REVEAL_TOTAL_MS } from './SurpriseRevealAnimation';
export { default as ModeTransition } from './ModeTransition';
export { default as FilterTransition } from './FilterTransition';
export { default as PullToRefresh } from './PullToRefresh';
export { default as TapActiveChip } from './TapActiveChip';
export { default as useTapActivate } from './useTapActivate';
