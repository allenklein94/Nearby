# Offer screens: no screen-wide motion (owner decision, 2026-10-12) - device checklist

Rule: motion communicates a real event or helps navigation; it never decorates a screen-wide content change. A card may animate
its OWN state change; the whole screen does not move because the layout changed, and nothing darkens the whole screen.

Built (Jest only; nothing below has been seen on a phone):
1. Offer acceptance (`BusinessRequestDetailScreen.handleAccept`): the `animateLayout()` call is removed. Kept: the accepted card's
   own morph (item 12, `OfferAcceptedMorph`), item 32's merge + gentle scroll to Your Plan. No replacement animation.
2. Offer-arrival pill travel: no full-screen dim (the scrim layer and `dimMs` are gone from `OfferTravelOverlay` / `offerTravel`).
   Kept: the travelling light (arc + halo), the growing frame, the landing ring, the card build-in. Matches item 23.
3. GroupPlan "You're booked" (`BookedCelebration`): LOCAL and kept = entrance (ring closes, ✓ settles, one ripple, facts fade in,
   card rises 6 px within itself) and exit fade + shrink to 0.96 (180 ms). SURROUNDING and removed = the card's slot height
   animating to 0 (220 ms, JS driver), which slid every section below it (title, status, proposal, ...) upward. Now the faded card
   is removed and the content below moves up in one layout update.
Guard: `src/motion/offerScreenWideMotion.test.js`.

Record device, OS, appearance mode, Reduce Motion on/off for each. Report what you see; do NOT add animation without approval.

- [ ] Accept an offer ("I'll take this one"): only the accepted card animates into the booked card; other sections (other replies,
      timeline, Your Plan) change without a slide/fade. Does it feel jumpy? (yes/no + what moved)
- [ ] Same, with the accepted card NOT the last on screen: does content below it visibly jump when the button is replaced by the
      booked facts? Note the size of the jump.
- [ ] Item 32's merge still plays after the accept (chip travels up, gentle scroll, one glow); a touch still stops the scroll.
- [ ] Tap the arrival pill: no darkening at any point; the light and frame are clearly visible in light AND dark mode without the
      dim behind them (contrast of the coral light/frame against a busy screen).
- [ ] Reply arriving while the request is open (item 23): unchanged, no dim.
- [ ] GroupPlan, lock in the reservation: "You're booked" plays as before; after ~4.5 s it fades/shrinks; the content below then
      moves up in one step. Does that read as a jump? (yes/no)
- [ ] Reduce Motion on: accept and GroupPlan behave as before (settled states, no animation).
