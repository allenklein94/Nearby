# Item 54 — "You've been into X lately" — device checklist (2026-10-12)

Built and live (migration 20270302). Tests and the `noticedActivity` journey pass. NOT device-verified. For each check, record the
device, OS, appearance mode and result.

Setup: an account that, in the last 30 days, joined (or created) 2+ separate gatherings in one category it has NOT declared as an
interest (e.g. Hiking), with Picked For You showing on Home.

1. Under Picked For You's cards: "N  You've been into Hiking lately." and "See what Nearby noticed →". Quiet secondary text, no
   motion, no haptic.
2. Tapping it opens Settings, scrolled to Privacy, where "What Nearby has noticed" lists Hiking with Forget / Add to my interests.
3. Leave Home and come back the same day: the line is still there. The next day: it's gone and doesn't come back for Hiking.
4. Only viewing Hiking gatherings, or only searching for hiking, never brings the line. One join alone doesn't either.
5. A category already in your interests is never named. After Forget or Add to my interests, it's never named again.
6. With 3 qualifying categories, only 2 are named, joined naturally ("Hiking and Pickleball").
7. No line when Picked For You is empty, for a new account with no activity, or when offline.
8. Faith & Spirituality (never learned) is never named, whatever the activity.
9. Light and dark: readable, wraps cleanly at narrow width and in the longest language (de / tl). Category names are translated.
10. No push, badge or notification about it ever arrives.
11. Native review of `ui.home.noticedLately` / `noticedLatelyA11y` / `noticedLink` in 10 languages (machine-authored). Check
    especially that none reads as "you like" or "you enjoy".
