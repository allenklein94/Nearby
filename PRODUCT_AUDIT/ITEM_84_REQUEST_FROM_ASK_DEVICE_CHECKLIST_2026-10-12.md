# Item 84 — request from an ask: what was carried + what's still missing — device checklist (2026-10-12)

Built. Tests (`src/services/askToBusiness.test.js`, `src/utils/askMissing.test.js`) and the `outdoorMatch` journey (item 84
step) pass. NOT device-verified. No new strings, no migration. Record device, OS, appearance mode and result for each check.

Setup: Home or Discover, a typed ask, then "Ask Nearby Businesses" (shown only when a business could fulfil it).

1. "Coffee tonight" -> Ask Nearby Businesses: the request opens at once (normal modal, nothing morphs) with "From what you said"
   at the top: Activity Coffee, Time Tonight. No People row.
2. Same: under "Party size" the amber line "How many people?" is visible right away, before tapping Send. Nothing else is marked
   (budget, radius, time, extras never are).
3. Type 4 in Party size: the line disappears as you type. Tap Send: no alert.
4. "Coffee for four tonight": the card adds People 4; no field is marked.
5. "something fun": no card (nothing carried). "Pick a category", "What day?" and "How many people?" are marked, each under its
   own field. Fill them one by one: each mark disappears on its own.
6. Clear the description text: "Tell us what you want" appears under it. Tap Send while something is still marked: the
   existing alert names the FIRST marked field (backstop).
7. The rows settle in once (quick, readable from the first frame, no glow, no haptic). Reduce Motion ON: simply there.
8. Hide removes the card; the form stays fully usable, values unchanged. With the card visible, every field still works.
9. "coffee right now": Time says Now (the When chip below shows Today, the day that is sent).
10. Opening the request any other way (a gathering's Ask Local Businesses, a match, a community, "Try a wider radius"): no card
    and no inline marks (Send's alert only, as before).
11. Light and dark: the amber marks are readable and not mistaken for errors; longest language (de / tl) wraps cleanly.
12. Judge on the phone whether three marks at once (check 5) feels heavy: report, don't change.
13. (Added 2026-10-18 for owner idea "183"; item 190 placement.) "Dinner for 4 Saturday": "Ask Nearby Businesses" shows as a
    secondary link AFTER the results, even when there are good results. Tapping it: the card shows Activity Dinner, Time Saturday,
    People 4; no field is marked for anything the words said.
14. (Added 2026-10-18, item 190.) A public-place ask (e.g. "a park to walk my dog"): no "Ask Nearby Businesses" link anywhere in
    the results or the empty state.
