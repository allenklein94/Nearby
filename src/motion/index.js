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
// '../motion'`. The original component locations (BrandedLoader,
// PlanCreatedCelebration, MatchCelebrationModal, FriendMatchCelebrationModal,
// OccasionSelectAnimation, SurpriseRevealAnimation under src/components/)
// still work -- they're now thin re-export shims pointing here, kept only so
// the many existing call sites across the app don't all need to change at
// once. New code should import the canonical name from this module directly.
export { default as NLoader } from './NLoader';
export { default as SuccessAnimation } from './SuccessAnimation';
export { default as MatchAnimation } from './MatchAnimation';
export { default as OccasionAnimation, OCCASION_SELECT_ANIMATIONS } from './OccasionAnimation';
export { default as SurpriseRevealAnimation, SURPRISE_REVEAL_TOTAL_MS } from './SurpriseRevealAnimation';
export { default as ModeTransition } from './ModeTransition';
export { default as FilterTransition } from './FilterTransition';
export { default as PullToRefresh } from './PullToRefresh';
