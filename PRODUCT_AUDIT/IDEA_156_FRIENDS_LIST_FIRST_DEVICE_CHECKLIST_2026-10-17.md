# Idea 156: Friends discovery list-first: device checklist (2026-10-17)

Owner decision: swiping is a choice, not a requirement for meeting friends. Friends discovery opens as a list (like Dating);
the swipe deck is optional (header button or Settings); every choice is a labelled Pass / Connect.
Built: migration `20270328` (LIVE), journey `friendDiscoveryChoice` 6/6, guard `utils/friendDiscoveryView.test.js`.

**Status: NOT RUN.** Nothing below has been checked on a phone. Record device, OS, appearance mode and result per check.

Setup: two test accounts (A, B) with "Meet New Friends" turned ON, same area; a third (C) with it OFF. A has never opened Friends.

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 1 | A: Discover -> People -> Friends, first open | A scrolling LIST of cards (photo, name, what you share, bio, interests), each with **Pass** and **Connect** buttons in words. No deck. | |
| 2 | A with Friends OFF | Intro reads "Meet new people nearby who are also open to making friends…"; nowhere says "swipe" or "deck" | |
| 3 | List: tap **Pass** on a person | Card leaves the list at once, no animation, no haptic; the next card is in place | |
| 4 | List: tap **Connect** on B (B has not connected yet) | B leaves the list; no match pop-up | |
| 5 | B: Connect with A | Friend match pop-up for B; A gets the "New friend!" push | |
| 6 | Header 📋 button (screen reader: "Currently on list view, switch to card view") | Switches to the deck in place; header shows 🃏 | |
| 7 | Deck: drag a card right / left past the threshold | Right = Connect, left = Pass (stamps read "Connect" / "Pass"); the next person appears; the person recorded is the one that was on top (check several swipes in a row) | |
| 8 | Deck: tap the **Pass** / **Connect** buttons instead of swiping | Same result as the swipe; buttons are worded, not ✕ / 🤝 | |
| 9 | Decide someone in the deck, switch back to the list (and the reverse) | A person decided in one mode never shows in the other | |
| 10 | Leave Friends and come back; kill and reopen the app | Opens in the mode last chosen | |
| 11 | Settings -> "Friends Display Style": choose List / Cards | Friends opens in that mode; Dating's "Nearby Display Style" is unchanged, and changing Dating's leaves Friends alone | |
| 12 | Airplane mode, tap Connect (list and deck) | Person comes back (list row / top of deck) + "Couldn't save that" with Retry; Retry after reconnecting records it | |
| 13 | C (Friends OFF) | C never appears for A or B in either mode | |
| 14 | VoiceOver / TalkBack on both modes | Buttons read "Pass on {name}" / "Connect with {name}"; the mode toggle reads its state | |
| 15 | Long names / German / Russian / Korean | Pass and Connect labels fit on one row in the list and the deck, both light and dark | |
| 16 | Empty list (all decided) | "No one nearby right now" + Invite Friends, same as the deck's | |

Also outstanding: native-speaker review of the 10 machine-authored languages for `ui.friends.passAction`, `connect`,
`connectWithA11y`, `meetNewPeopleIntro`, `likeFailed` (reworded) and `ui.settings.friendsDisplayStyle`, `chooseHowFriendsAreShown`.
