# Item 41 - "Your people are doing things": device checklist (2026-10-11)

Status: APPROVED (owner, 2026-10-11), BUILT, NOT device-verified. Rule `utils/friendsPlanningMoment.js`, moment
`motion/FriendsPlanning.js` (`SEQUENCES.friendsPlanning`, medium, 500 ms), query `selectFriendsActivity` in
`services/homeDashboard.js` (friends' visible gatherings created in the last 3 days, one per friend, max 3); unit tests
`utils/friendsPlanningMoment.test.js`; live journey `friendsPlanning`.

Owner decisions (locked):
1. Wording stays "{count} of your friends are already making plans." -- never "nearby" (the plans are not distance-filtered;
   no Discover-radius filter added just to justify the word).
2. Avatars first, then up to 3 one-line gathering chips (activity glyph + the plan's real title, nothing else), then the line.
   The chips move once, when the plans are genuinely new, then stay static: a narrow exception to "no animated cards" for
   this moment only. A chip opens that gathering's existing detail; "See gatherings" appears only when friends have plans beyond the chips, and lists only those (owner, 2026-10-11). No new screen.

Setup: an account with 0, 1, 2 and 3+ accepted friends who each created a visible gathering in the last 3 days, and no stronger Home line.

| # | Check | Light | Dark |
|---|---|---|---|
| 1 | First time: faces appear one after another (overlapping), then the chips fade and rise a little into place under them, then the line settles; calm, about half a second | | |
| 2 | The line and chips are readable from the first frame; nothing pops from nothing; nothing around the row shifts or jumps | | |
| 3 | Back, tab switch, pull to refresh, app restart with the same plans: settled row, no replay | | |
| 4 | A friend creates a new plan: plays once more; afterwards the chips are static (no pulse, loop or expand) | | |
| 5 | Tapping a chip (also mid-motion) opens that gathering's detail at once; Back returns to Home where it was | | |
| 6 | With only the chip plans: no "See gatherings". With a further friends' plan (a 4th friend, or a friend's second plan): "See gatherings" shows, lists only that/those plans (never a chip's), opens at once, even during the moment | | |
| 7 | 0 or 1 eligible friend: no line, no chips; 2 or 3: count = faces = chips; never more than 3 chips | | |
| 8 | A long title truncates on one line; a plan without an activity: chip shows title only; missing photo: the person glyph | | |
| 9 | Reduce Motion: the settled row at once | | |
| 10 | VoiceOver/TalkBack: faces skipped, each chip read as a button with its title, the line read once | | |
| 11 | Large text / narrow phone: chips and line wrap or truncate cleanly | | |
| 12 | No haptic; nothing says or implies a friend is nearby or attending | | |

Device: ____  OS: ____  Date: ____  Result: ____
