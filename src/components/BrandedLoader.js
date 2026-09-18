// Canonical implementation moved to src/motion/NLoader.js (the Nearby Motion
// System, CLAUDE.md Item 113) -- kept here as a re-export so the ~44 existing
// import sites across the app don't all need to change at once. New code
// should import NLoader from '../motion' directly.
export { default } from '../motion/NLoader';
