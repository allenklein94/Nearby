# Motion spec — {moment name} (item {N}, {date})

Owner item 101: answer all eight before building or changing any motion. Paste the answers into the build plan or the item's
`CLAUDE_HISTORY.md` entry. Existing approved moments are not retrofitted.

1. **What changed?** The real, final event or state change (server result, stored state), and its meaning from `MOTION_MEANINGS`.
2. **Why is motion useful here?** What it explains that the static view alone does not (item 58; item 55: never a reason to animate more).
3. **Start state:** what is on screen before (real data only, never a placeholder that swaps mid-play).
4. **End state:** the settled view, identical to the static view of the same data.
5. **How long does it last?** Tier and `SEQUENCES` tokens (`motion/motionBudget.js`); <= 900 ms unless it is the signature.
6. **Can the user interact immediately?** Yes, required: taps act at once, overlays are `pointerEvents="none"` (item 20).
7. **Reduce Motion:** the end state at once.
8. **Does the change still read without the animation?** The words/state on screen say it (info opacity >= 0.6 from frame one).

Also name: the primitive (`MOTION_PRIMITIVES`, one of the eight), the trigger and how often it plays (once per object/session/ever),
haptics (only after the person's own tap), and every lock it touches.

Guards the build must pass: `motion/motionMeaning.test.js`, `motion/motionPrimitives.test.js`, `motion/animationInterruptible.test.js`,
`motion/animationNeverDelays.test.js`, `motion/motionPerformance.test.js`.
