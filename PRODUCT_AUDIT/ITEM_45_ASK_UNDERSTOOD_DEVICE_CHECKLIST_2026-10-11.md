# Item 45 - the search "understanding" moment: device checklist (2026-10-11)

**Built, NOT device-verified.** Nothing below has been seen on a phone. Record device, OS, appearance mode and result per line.
Item 45 closes only when every line passes on a real device. No new strings (labels reuse the date filter, environment chip,
category/group and party names already shown elsewhere), so no native review is needed for this item.

What was built: when a typed ask (Home intent box, Discover search) has been understood, a row of quiet chips shows what Nearby
read from the words, e.g. "Tonight · Outdoor", in the order WHAT, WHEN, WHERE, WHO (`utils/askUnderstood.js`, the one rule;
`components/AskUnderstoodChips.js` renders it on both surfaces). They appear under the "Finding..." loader as soon as the ask is
classified and stay above the results. Only what the words really gave: unknown = no chip, no chip for vibe words ("fun"), nothing
a refinement chip already shows (with friends / date / solo / budget). The first time an ask is understood the chips settle in one
after another (small tier, ~280 ms total, readable from frame one); a repeat of the same ask, a refine or Reduce Motion shows them
already in place. On Discover they replace the old static tag row (Nearby / group / date / party) in the results block.

| # | Check | Result |
|---|---|---|
| 1 | Home: type "something fun outside tonight": "Tonight" and "Outdoor" chips appear under the loader, and nothing for "fun" | |
| 2 | The same two chips stay above the results when they arrive (same set, same order, no flicker or swap) | |
| 3 | Discover search with the same words: same chips, same order, above the results; the old tag row is gone | |
| 4 | "sushi this weekend with the family": What (Sushi), When (This Weekend), Who (Family), in that order | |
| 5 | "dinner with friends": no "friends" chip here (the refinement chip shows it); no duplicate anywhere | |
| 6 | An ask with nothing recognisable ("anything"): no chip row at all (no empty gap) | |
| 7 | Chips text is readable from the first frame; the settle is quick and calm (no bounce, no glow, no haptic) | |
| 8 | Run the same ask again, or tap a refinement chip: chips are already there, no replay | |
| 9 | Chips are not tappable and never block the refinement chips or results below | |
| 10 | Reduce Motion on: the chips appear finished at once | |
| 11 | Light and dark mode: chips are quiet (secondary text, border), never coral | |
| 12 | Screen reader reads the row once as a list of the labels | |
| 13 | A non-English language: labels show in that language (they reuse existing translated strings) | |

Coverage: `src/utils/askUnderstood.test.js` (rules, order, unknown, negation, one-play, motion budget, both surfaces wired);
journey `outdoorMatch` step "item 45" runs "something fun outside tonight" through the real pipeline (deterministic classifier,
AI down as in production) and checks the chips at "finding" equal the chips with the results. Uncovered: the rendering and the
motion themselves (device only).
