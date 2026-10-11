# Item 43 - Create: the formation when a gathering is published - device checklist (2026-10-11)

Status: BUILT, NOT device-verified. Pieces `utils/gatheringFormation.js` (`formationPieces`), shown in
`components/GatheringPublishedPanel.js` through the shared `motion/PlanComesTogether.js` (pieces rise 4 px one after another,
then one success glow; special tier, 660 ms). Unit tests `utils/gatheringFormation.test.js`; live journey `gatheringFormation`.
No new strings. Owner's sketch said "Your plan is ready"; the headline stays "Your gathering is live!" (nobody has accepted yet,
so "ready" would claim more than publishing did) -- flagged for the owner.

Setup: publish gatherings that cover: a picked place; a dropped pin; Near Me; Friends / Everyone / Community / Invite Only;
with and without friends invited on the Who step; a first-ever gathering on a fresh account.

| # | Check | Light | Dark |
|---|---|---|---|
| 1 | After Publish: what, when, who, where settle into the card one after another, then it glows once; calm, under a second | | |
| 2 | Every line is readable from the first frame; nothing jumps; the buttons below are tappable at once | | |
| 3 | The lines match what was published: title + activity icon, the same when as the gathering page, who can join (+ "We invited N of M" only when invites were sent), the place as on the review step | | |
| 4 | First-ever gathering: "Your First Gathering Is Live!" + 🎉🌟 from the first frame (never switches after the card appears) | | |
| 5 | Plays once: scrolling, pull to refresh, leaving and returning, or Done -> the panel does not replay | | |
| 6 | Reduce Motion: the finished card at once, no glow | | |
| 7 | VoiceOver/TalkBack reads each line once, in order | | |
| 8 | Long title / long place / large text: lines wrap cleanly inside the card | | |

Device: ____  OS: ____  Date: ____  Result: ____
