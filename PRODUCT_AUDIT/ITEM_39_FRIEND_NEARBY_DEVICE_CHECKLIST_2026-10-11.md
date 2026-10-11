# Item 39 - "A friend is nearby": device checklist (2026-10-11)

Status: BUILT and LIVE on the database (migration 20270296), NOT device-verified. Server rules are proven by the
`friendNearby` journey (14/14, rolled back); client rules by `services/friendNearby.test.js`. Neither is visual or
on-device sign-off. Item 39 stays OPEN until every check below is recorded on real devices (two phones, two accounts
that are accepted friends) AND a native speaker has reviewed the 8 `ui.friendNearby.*` strings in the 10 non-English languages.

Setup: phones A and B, signed in as accepted friends, both within ~1 mi of each other (same building is fine).

| # | Check | A | B |
|---|---|---|---|
| 1 | Fresh install / existing account: Settings > Privacy shows "Let friends know when I'm nearby" OFF; Home shows no line, no reminder | | |
| 2 | Only A turns it on: no line on either phone (mutual); A's Home shows "Friends can see you're nearby · Turn off" | | |
| 3 | Turning it on asks for location only if not already granted; location denied -> the row says "Location is off, so friends can't see you're nearby." | | |
| 4 | Both on, both apps open: within ~1 min of focus, Home shows the friend's avatar + "{Name} is nearby" + "Invite {Name} →" (only when no plan/gathering line outranks it) | | |
| 5 | The line never shows a distance, place, time, map or "last seen" | | |
| 6 | Invite opens Create with that friend preselected in Who; nothing is sent until Publish | | |
| 7 | A taps "Turn off" on Home: A's reminder disappears; B's line disappears on next Home focus (after up to 1 min cache) | | |
| 8 | Background the app on B for > 30 min, then open A's Home: no line (B's fix is stale; the app never reports in the background) | | |
| 9 | Move one phone > 1 mi away and reopen its app: no line on either | | |
| 10 | A blocks B: no line either way; unblock restores it | | |
| 11 | A dating match (not a friend) with both on, nearby: never shown | | |
| 12 | No push notification is ever received for this, on either phone | | |
| 13 | Dark mode, large text, narrow phone: avatar + line + reminder wrap cleanly; a missing photo shows the person glyph | | |
| 14 | VoiceOver/TalkBack: the line, the Invite button and "Stop letting friends know when you're nearby" read correctly | | |
| 15 | Non-English (e.g. es, zh): toggle, helper, line, Invite, reminder read naturally (native review pending) | | |

Device A: ____  OS: ____  Device B: ____  OS: ____  Date: ____  Result: ____
