# Item 82 — "Create it" shows what you said on Create's first screen — device checklist (2026-10-12)

Built. Tests (`src/utils/fromWhatYouSaid.test.js`) and the `outdoorMatch` journey (item 82 step) pass. NOT device-verified. No
new strings, no migration. For each check, record the device, OS, appearance mode and result.

Setup: Home or Discover, a typed ask with no results you're happy with, then "Create it yourself" / "Create What You're Looking For".

1. Type "hang out with 4 friends tomorrow" -> Create it. Create opens on step 1 (What) and the "From what you said" card is at the
   TOP, above Title, the moment the screen appears: Purpose Friends, Time Tomorrow, People 5. No wait, no separate intro screen.
2. In check 1, the rows settle in once, one after another, quickly (well under half a second). Readable from the first frame,
   no glow, no haptic. It must not feel like an onboarding step.
3. Same ask: Next to step 2 -> the card is there as before, with "Check the time below, then pick a place…", and it does NOT
   animate. Back to step 1: the card is there and does NOT animate again.
4. Step 1's card has NO "Pick a time, then a place" line (that line is step 2's).
5. Hide on step 1 -> the card is gone on step 1 AND on step 2. Title, activity and time stay filled.
6. Type "Pickleball tonight" -> Create it. Create opens on step 2 (as before) with the card (Activity Pickleball, Time Tonight),
   no animation. Back to step 1: the card is at the top, no animation, Pickleball selected below.
7. "something fun outside tonight" -> Create it: the card says Time Tonight only. No place, setting or "near me" row ever
   appears, whatever the words; "Where" on step 2 still defaults to near you.
8. Opening Create from the Create tab (no ask): no card on any step.
9. Reduce Motion ON: check 1's card is simply there, settled, no movement.
10. Tapping "Create it" opens Create at once with the normal screen transition: nothing morphs or travels between screens.
11. Light and dark: card readable; longest language (de / tl) wraps cleanly at narrow width; the card doesn't push Title below
    the fold on a small phone (record the device if it does: report, don't change).
