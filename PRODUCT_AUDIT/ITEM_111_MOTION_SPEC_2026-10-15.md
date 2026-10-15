# Motion spec — Best Pick first reveal (item 111, 2026-10-15)

Status: SPEC ONLY, nothing built. Owner approved in principle on condition that the reveal fits the locked motion rules and is
not a recurring Home animation; implementation follows item 101 (this file).

## Verification against the locks (done before building)

| Lock | As proposed (label -> "Coffee + live music" -> name last) | Compliant variant below |
|---|---|---|
| Animation never delays information (info opacity >= 0.6 from frame one; `animationNeverDelays.test.js`) | FAILS: the place name is hidden until stage 3 | Passes: all three lines readable from frame one; only emphasis settles in order |
| Motion truth: never narrate staged progress on a timer | FAILS: staged suspense with no event behind each stage | Passes only as emphasis order, not a reveal of hidden content |
| Item 58: motion explains a real change / connection / documented exception | Weak: opening Home is not a change | The one real event: Nearby's FIRST-EVER Best Pick for this person (once ever) |
| Cards static / no recurring card motion | Passes only because it is once per user | Once per user ever (stored flag), never per open/redraw |
| Truth: real data only | "Coffee + live music" is not a field Best Pick has (it is always a gathering) | Stage 2 = the card's own real WHY line (`heroCard.why`), no new string |
| One moment per card | Could stack with item 40 (FriendCollision) or item 37 on the same hero | Skipped whenever the hero carries item 40's collision or item 37's strong match |

Conclusion: the proposal as written cannot be built without breaking `animationNeverDelays` and motion truth. A compliant
version is possible, but it is an emphasis settle (eyebrow -> why -> title), not a reveal: the place name is on screen at once.

## The eight questions (compliant variant)

1. **What changed?** The person's first-ever Best Pick appears on Home (stored once-ever flag, set when it plays). Meaning to declare
   in `MOTION_MEANINGS`/`SEQUENCE_MEANINGS`: "Nearby's first pick for you" (a narrowly documented first-time introduction).
2. **Why is motion useful?** It teaches, once, how to read the hero: what kind of pick it is, why, then what. Weak by item 58's bar;
   the static card already says all three.
3. **Start state:** the full hero card with real data; eyebrow, why line and title all at >= 0.6 opacity (`infoOpacity`).
4. **End state:** identical to today's static hero.
5. **Duration:** small tier, three staggered opacity settles (0.6 -> 1), total <= 450 ms; tokens only, a new `SEQUENCES.bestPickFirst`.
6. **Interaction:** the card's tap opens the gathering at once, mid-settle (item 20); no overlay.
7. **Reduce Motion:** settled card at once; the flag is still set (no later replay).
8. **Reads without the animation?** Yes: every word is on screen from frame one.

Primitive: Reveal. Trigger: first render of a Best Pick hero ever, only when Home is focused and the hero has no item 40/37 moment.
Frequency: once per user ever (AsyncStorage, like `utils/happeningSeen.js`; account sync not needed). Haptics: none. No loop,
particles, transition, or new strings. Touches: items 20, 37, 40, 57 (small tier), 58, 100, 101; Home limits and navigation unchanged.

Guards the build must pass: `motionMeaning`, `motionPrimitives`, `animationInterruptible`, `animationNeverDelays`, `motionPerformance`.
