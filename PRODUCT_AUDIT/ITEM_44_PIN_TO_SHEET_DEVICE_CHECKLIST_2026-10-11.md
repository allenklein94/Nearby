# Item 44 - map pin grows into the business sheet: device checklist (2026-10-11)

**Owner APPROVED as built (2026-10-11); device verification PENDING.** This is the sign-off checklist: item 44 closes only when
every line passes on a real iPhone AND a real Android phone (anchor, timing, interaction, Reduce Motion). Keep the implementation
as is: it replaces the slide (no stacked animation), medium tier under 0.35 s, text readable from frame one, no delayed or blocked
tap, Reduce Motion respected, item 17's one-tap behaviour preserved. Do not change `PIN_HEAD_LIFT` (18 px, an estimate) without
evidence from checks 1 and 8: record the measured offset there if the outline misses the pin.

**Built, NOT device-verified.** Nothing below has been seen on a phone. Record device, OS, appearance mode and result per line.

What was built: on Discover's map, tapping a business pin opens the existing business sheet (item 17) as before, but instead of
sliding up from the bottom it grows out of the pin: the sheet rises 16 px and grows from 96 % while the backdrop dims (260 ms),
and a pin-coloured outline grows from the pin's spot into the sheet's edge and fades as it lands (320 ms, medium tier). Same
content, same two buttons ("the business's action" + "View business" -> BusinessProfile). Result-row openings, and every opening
under Reduce Motion, keep the previous plain modal animation.

| # | Check | iOS | Android |
|---|---|---|---|
| 1 | Tap a business pin: the outline visibly starts AT that pin (not offset), on a pin near the top, middle and bottom of the map | | |
| 2 | The outline lands on the sheet's edge (top corners line up), then fades; it never covers the sheet's text | | |
| 3 | The sheet's name, distance, hours and qualities are readable from the first frame (never blank, never a flash) | | |
| 4 | Tap the action or "View business" immediately after tapping the pin: it works at once (nothing waits on the motion) | | |
| 5 | Tap outside during the motion: the sheet closes at once; Discover underneath is unchanged (map position, filters) | | |
| 6 | "View business" opens the business profile; Back returns to the map with no sheet left over | | |
| 7 | Tap a second pin right after closing the first: the new sheet grows from the NEW pin | | |
| 8 | Android with a visible status bar: the outline still starts on the pin (vertical offset is the likely failure) | n/a | |
| 9 | Reduce Motion on: no outline, the sheet appears with the plain fade every modal uses | | |
| 10 | Business result rows (list) still open the sheet with the old slide, no outline | | |
| 11 | Light and dark mode: the outline is visible but quiet in both | | |
| 12 | Feels connected, not decorative: under ~0.35 s, no bounce, no jank on a mid-range Android | | |

Known unknowns: the pin head is assumed 18 px above the coordinate (`PIN_HEAD_LIFT`, standard pin); the map reports the pin's
spot asynchronously, and if it takes longer than 120 ms the sheet just rises without the outline (check 1 would show this as
"no outline"). No journey covers this: it changes no data or flow (same sheet, same row, same actions); the motion is guarded by
`motion/pinToSheet.test.js` (12 tests) and the item-17 sheet tests.
