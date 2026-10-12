# Item 55 — the Nearby Pulse (consolidation) — device checklist (2026-10-12)

The five existing connection moments now draw through one shared piece (`motion/NearbyPulse.js`). Tests pass (`nearbyPulse.test.js`
15/15, every existing motion guard kept). NOT device-verified. Shared code and passing tests do not show that the moments line up on
real hardware. Every check below is PENDING until it's recorded on BOTH a real iPhone and a real Android phone (device, OS, appearance
mode, result). Each moment should look exactly as its own approved checklist describes. The consolidation was meant to change nothing
visible.

| # | Moment (Pulse form) | Check (iOS / Android) |
|---|---|---|
| 1 | Request sent (ring) | Send a request that reaches a business: two soft rings go out from behind the confirmation line, centred on it, gone in under 0.5 s. A duplicate, or nobody reached: no rings. The line is readable at once. |
| 2 | Signal received (ring, business side) | A new opportunity arrives on the dashboard: the card rises while the same two rings go out from its ✨ (centred on the glyph, not offset). Several at once go one after another. Buttons are live from the first frame. |
| 3 | Happening near you (ring) | A new gathering in Home's Nearby Right Now or Discover's Happening Now: one ring from the radar mark, centred on it. Back or a tab switch: nothing replays. |
| 4 | Right Now mark (still) | The dot and faint ring look exactly as before (14 px, same colour). They never move on their own. |
| 5 | Pin to sheet (journey) | Tap a business pin: the outline starts at the pin head and travels into the sheet's edge, landing on its rounded corners. Check the Android status bar offset. The sheet's content and buttons work at once. |
| 6 | Reduce Motion ON | None of 1-3 or 5 animates. The mark (4) is unchanged. Everything still appears at once. |
| 7 | Signature untouched | A business reply arriving still plays the larger business-responds travel exactly as before. Nothing Pulse-like is added to it. |
| 8 | Light and dark | Rings and the journey outline are visible but quiet in both modes. |
| 9 | Performance | No dropped frames while rings play over a scrolling list (native driver). |

Cross-check with the existing checklists: `ITEM_44_PIN_TO_SHEET_DEVICE_CHECKLIST_2026-10-11.md`,
`ITEM_48_SIGNAL_RECEIVED_DEVICE_CHECKLIST_2026-10-11.md`, and the marketplace-moment and Right Now checks in
`FIRST_DEVICE_SESSION_CHECKLIST_2026-09-19.md`.

Known difference, by design: before a ring plays, it now rests invisible. Previously the first ring could sit faint for the one frame
before its animation started. It can't be seen at normal frame rates.
