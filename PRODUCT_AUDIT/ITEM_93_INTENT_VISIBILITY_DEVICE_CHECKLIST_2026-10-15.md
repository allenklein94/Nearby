# Item 93 — "People you know are also asking" aligned with item 92 — device checklist (2026-10-15)

Built and live (migration 20270307). Unit tests (`sharedRequestFacts.test.js`) and the `intentVisibility`, `groupPlanJourney` and
`groupBookingLifecycle` journeys pass. NOT device-verified. Record device, OS, appearance mode and result for each check.

Setup: two phones, A and B, accepted friends; a third account M that is a dating match of A but not a friend.

1. Settings > "Who can see my requests" on a fresh or existing account shows **Nobody** selected (nobody was opted in by the
   migration). The two choices are Friends and Nobody; no "Friends & Matches".
2. With B on Nobody: A sends a Coffee request to businesses; the request screen shows no "People you know are also asking"
   candidates, and A's typed Coffee ask shows no "{B} is also looking" result.
3. B switches to Friends and has an open Coffee request (typed with private words, e.g. "vegan, nut allergy"). On A: the candidate
   row and the typed-ask result show B's name with "Coffee · {day} · {N} people" only, never B's words. No Message button.
4. M (dating match) switches to Friends with an open Coffee request: M never appears on A's phone, in candidates, typed asks or
   the "A few people you know want this too" push.
5. A selects B and taps Make It a Group Plan: B gets an invite to accept or decline; B is not added until B accepts.
6. B switches back to Nobody: B disappears from A's candidates/results on the next load.
7. Light and dark; longest language (de / tl): the Settings hint wraps cleanly.
8. Native review of `ui.settings.aCoffeeTonightRequestYou`, `friendsOnly`, `friendsOnlyA11y` in 10 languages (machine-authored).
