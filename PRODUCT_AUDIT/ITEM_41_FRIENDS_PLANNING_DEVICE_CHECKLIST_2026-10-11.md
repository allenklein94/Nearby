# Item 41 - "Your people are doing things": device checklist (2026-10-11)

Status: BUILT, NOT device-verified, awaiting owner review (two deviations from the ask, below). Rule
`utils/friendsPlanningMoment.js`, moment `motion/FriendsPlanning.js` (`SEQUENCES.friendsPlanning`, medium, 500 ms); unit tests
`utils/friendsPlanningMoment.test.js`. No journey covers the friends-planning line: it is a client query in
`services/homeDashboard.js` (friends' visible gatherings created in the last 3 days, one per host, max 3), not a server function.

Deviations from the owner's sketch, kept on purpose until the owner decides:
1. The line still reads "{count} of your friends are already making plans." -- NOT "...nearby": those plans are not
   distance-filtered, so "nearby" would be an unbacked claim (truthfulness rule).
2. "Gathering cards appear" is shown as each plan's activity glyph landing on its friend's face, not as cards: Home never
   expands sections in place, and "See gatherings" already lists exactly those plans inline on tap (item 136).

Setup: an account with 2-3 accepted friends who each created a visible gathering in the last 3 days, and no stronger Home line.

| # | Check | Light | Dark |
|---|---|---|---|
| 1 | First time: the friends' faces appear one after another (overlapping), each plan's activity glyph lands on its face, then the line settles; calm, about half a second | | |
| 2 | The line is readable from the first frame; faces never pop from nothing; nothing below shifts | | |
| 3 | Back, tab switch, pull to refresh, app restart with the same plans: settled row, no replay | | |
| 4 | A friend creates a new plan (the count changes or a plan is replaced): plays once more | | |
| 5 | "See gatherings" opens exactly those plans inline, at once, even during the moment | | |
| 6 | Missing photo: the person glyph; a plan without an activity: no glyph on that face | | |
| 7 | Reduce Motion: the settled row at once | | |
| 8 | VoiceOver/TalkBack reads the line once (not each face) | | |
| 9 | Large text / narrow phone: faces and line wrap cleanly | | |

Device: ____  OS: ____  Date: ____  Result: ____
