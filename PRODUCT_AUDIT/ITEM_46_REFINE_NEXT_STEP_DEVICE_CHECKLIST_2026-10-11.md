# Item 46 - intent refinement shows its next step: device checklist (2026-10-11)

**Built, NOT device-verified.** Record device, OS, appearance mode and result per line. No new strings.

Owner decisions (2026-10-11): keep item 107's row as is (With friends / Date / Solo / Under $25; item 107 stays LOCKED: no new chips,
no new values, no time step, "a search never asks"); Under $25 kept (the $ tier); no sequential questionnaire. What was built: the
next useful refinement step's chips get a soft coral wash -- Who (the three who-for chips) first, then Budget (Under $25). A step
the words or a tap already answered is skipped (any party type answers Who, any budget/price tier answers Budget); both answered =
no emphasis. After the person's own tap lands, the wash fades in on the next step (small tier, 200 ms); Reduce Motion = at once.
No emphasis while a refinement runs or after one came back empty. Rule: `nextRefinementStep` in `utils/askRefinements.js`;
rendered by `components/AskRefinementChips.js` (Home + Discover).

| # | Check | Result |
|---|---|---|
| 1 | Home, type "dinner": With friends / Date / Solo carry a soft wash; Under $25 does not; nothing looks selected | |
| 2 | Tap With friends: it turns solid (selected), results refresh, then the wash fades in on Under $25 only | |
| 3 | Tap Under $25: it turns solid; no chip carries a wash any more | |
| 4 | Tap With friends off: the wash returns to the who-for chips | |
| 5 | "dinner with my family": Who is already answered, so only Under $25 carries the wash | |
| 6 | "dinner tonight under $40 with friends": no wash at all; the time is never asked | |
| 7 | While a refinement is loading, no chip carries a wash; an empty refinement ("Tap the chip again...") shows no wash | |
| 8 | The wash is clearly lighter than the selected look in light AND dark mode (never mistaken for selected) | |
| 9 | Chips are tappable at once during the fade; nothing waits on it | |
| 10 | Reduce Motion on: the wash appears at once, no fade | |
| 11 | Discover search: identical behaviour to Home | |
| 12 | Screen reader: chip labels and selected states unchanged (the wash is not announced) | |

Coverage: `src/utils/refineNextStep.test.js` (rule, skip-what-is-known, item 107 unchanged, component guards, budget); journey
`outdoorMatch` step "item 46" (real ask -> real re-runs: who -> budget -> none, time untouched). Uncovered: the look and the fade (device).
