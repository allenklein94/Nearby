# Item 40 - Friend + activity collision ("You + {Name} might like this"): device checklist (2026-10-11)

Status: APPROVED by the owner (2026-10-11, decisions LOCKED, no scope expansion), LIVE (migration 20270297), NOT device-verified. Rule: `utils/friendCollision.js` (unit-tested); server fact
(`shared_tags` = interests BOTH declared, nothing else) proven by the `friendNearby` journey (15/15). Item 40 stays OPEN until
every check below is recorded on real devices AND the 2 new strings (`ui.friendNearby.together`, `togetherA11y`) have native review,
and a from-scratch migration replay on an empty database is done before claiming fresh-install verification.

Setup: item 39's setup (two phones, accepted friends, both sharing, both apps open, < ~1 mi apart), both have declared
Pickleball in their profile interests, and a public Pickleball gathering nearby that neither hosts nor has joined, showing as
Best Pick or in Picked For You on Home.

| # | Check | Light | Dark |
|---|---|---|---|
| 1 | That card's headline reads "You + {Name} might like this" with your face and the friend's overlapping, in place of "You might like this"; its reasons below are unchanged | | |
| 2 | The two faces slide in from either side and meet, then the line settles; calm, well under half a second; the text is readable from the first frame | | |
| 3 | Back to Home, tab switch, pull to refresh: no replay (settled pair); a new app start may play it once more | | |
| 4 | Only ONE card on Home says it, even if several Pickleball gatherings show | | |
| 5 | The order of cards does not change because of it | | |
| 6 | Friend joins the gathering, or either of you hosts it: the card goes back to its normal headline ("{Name} is going" stays the reason) | | |
| 7 | Remove Pickleball from your own interests (or the friend does): it disappears on next Home load | | |
| 8 | Either person turns sharing off / moves > 1 mi away / blocks: it disappears (item 39's rules) | | |
| 9 | Tapping the card during the moment opens the gathering at once | | |
| 10 | Reduce Motion on: the settled pair at once | | |
| 11 | Missing photo (yours or theirs): the person glyph; long name / large text / narrow phone: one line, ellipsis, never clipped faces | | |
| 12 | Best Pick hero variant: white text readable on the scrim | | |
| 13 | VoiceOver/TalkBack reads "You and {Name} might both like this" | | |
| 14 | Non-English (e.g. es, zh): reads naturally (native review pending) | | |
| 15 | Three distinct facts (owner): with Claude nearby but NOT joined, nothing on the card, the "{Name} is nearby" line or the a11y text says or implies Claude is going, attending or at the gathering; with Claude joined, only "Claude is going" (attendance) speaks; the nearby line never names a gathering | | |

Device: ____  OS: ____  Date: ____  Result: ____
