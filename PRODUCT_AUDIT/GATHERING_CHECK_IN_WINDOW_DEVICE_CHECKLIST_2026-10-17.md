# Gathering lifecycle clock + check-in window: device checklist (owner, 2026-10-17)

Fixes G1 (one clock) and G2 (check-in window) from `PLAN_LIFECYCLE_AND_YOURE_HERE_SCOPE_2026-10-17.md`; "You're here" = option A
(manual only); no new strings or headlines. Migration 20270326 LIVE. NOT DEVICE-VERIFIED until every check below is recorded.
Record: device, OS, appearance mode, date/time, result (pass/fail + note).

Setup: a host account + an attendee account (approved). Create gatherings with these starts (host's "How long?" set where noted).

| # | Check | Expected | Result |
|---|---|---|---|
| 1 | 1-hour gathering at 6 PM, viewed at 7:30 PM (attendee) | Home: "✓ Completed · How was it?"; detail: NO "Happening now", no "I'm on my way", no "I'm here" | |
| 2 | Same gathering at 6:30 PM | Detail: "Happening now", "I'm on my way" and "I'm here — check in" shown | |
| 3 | Gathering starting in 45 min | "Starts in 45 min", "I'm on my way" shown, NO "I'm here — check in" | |
| 4 | Keep check 3's screen open until 30 min before (minute clock / reopen) | "I'm here — check in" appears once inside the window | |
| 5 | Gathering a week ahead | No "I'm here — check in"; tapping is impossible | |
| 6 | Tap "I'm here — check in" during the gathering | "Have fun! We'll see you afterwards"; "Who's here · 1 checked in" on the other attendee's phone | |
| 7 | Leave the screen open across the end time, then tap "I'm here" (if still drawn) | No error alert / no "Try again"; the section redraws without the button; no check-in recorded | |
| 8 | Checked-in attendee opens the detail after the end | No "Have fun!" panel; feedback ("How was it?") as for any completed plan | |
| 9 | Gathering with no length set: 25 min after start / 31 min after start | "Happening now" + check-in / neither (ends at start + 30 min) | |
| 10 | Host's view during the gathering | Host never sees "I'm on my way" / "I'm here" (unchanged) | |
| 11 | Check-in never redeems: a booked-offer plan's attendee checks in | Nothing on the business side changes; redemption only when the business confirms | |
| 12 | Light and dark mode, large text | Nothing new to render; no layout shift where the button is absent | |

Covered without a phone: Jest `utils/gatheringCheckInWindow.test.js` (boundaries -31/-30/0/end-1 ms/end/+1/+3 days, no-duration,
label = timeWindowParts at every minute), `screens/gatheringHubFolded.test.js`; journey `gatheringCheckIn` 9/9 (server called
directly, no app; direct inserts/updates refused; counts, plans this month and redemptions untouched) and `plansThisMonth`.
Not covered: a real signed-in API call (same open item as items 147/148), rendering on any device.
