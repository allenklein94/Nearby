# Item 37 - "Perfect Match" -> the strong-match moment: device checklist (2026-10-11)

Status: APPROVED by the owner (2026-10-11), READY FOR DEVICE VERIFICATION, not device-verified. Wording ("A strong match for you",
never "Perfect fit"), ticks-as-intent (no separate "Your intent" step) and the interaction are locked. The label explains why the
result fits, never that it is the best. This item does not verify device appearance or ranking behavior.

Item 37 stays OPEN until every check below is recorded as passed on a real device (device, OS, appearance mode, result) AND a
native speaker has reviewed `vocab.confidence.high` in each of the 10 non-English languages (below). Then close it without
expanding scope. Tests, the `strongMatch` journey and parse checks
are not visual sign-off. Built: `utils/strongMatch.js` (the one rule), `motion/StrongMatch.js` (the moment), token
`SEQUENCES.strongMatch` (medium tier, ~420 ms), Home and Discover typed-ask top result. No new strings (item 61's
"A strong match for you"; "perfect" is never claimed).

How to force it: be near a public gathering of a known activity that starts on a day you name, under 2 mi away, then type e.g.
"coffee tomorrow" on Home and on Discover. Its top result must be that gathering (or a business posting with a start).

| # | Check | Light | Dark |
|---|---|---|---|
| 1 | Top result shows "Coffee ✓  Tomorrow 12 PM ✓  0.3 mi ✓" then "✨ A strong match for you", in place of "✨ Nearby Pick" | | |
| 2 | The three ✓ tick in left to right, the badge settles last; whole moment well under half a second, calm | | |
| 3 | The activity, time and distance words are readable from the first frame; nothing below the block shifts | | |
| 4 | A tick appears only for a piece the result really meets (activity, time, place); never for an unmet constraint. Ask without a time ("coffee"), with a far or other-day top result: plain "✨ Nearby Pick", no pieces | | |
| 5 | Tapping the row during the moment opens it at once | | |
| 6 | Back to the results, tab switch: no replay; a new typed ask replays it once | | |
| 7 | Reduce Motion on: the finished block at once | | |
| 8 | Narrow phone / long category name / large text: the pieces wrap cleanly, never clip | | |
| 9 | VoiceOver/TalkBack reads "A strong match for you" on that row | | |
| 10 | Non-English (e.g. es, zh): pieces and badge read naturally (native review of the existing string still pending) | | |

Device: ____  OS: ____  Date: ____  Result: ____

Native review of "A strong match for you" (`vocab.confidence.high`): es ____ de ____ fr ____ pt ____ ht ____ zh ____ vi ____ tl ____ ru ____ ko ____
