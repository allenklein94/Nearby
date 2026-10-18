# Haptics for major moments (owner idea "170", 2026-10-18): MET AS BUILT, LOCKED, nothing built

Numbered "170" by the owner; not any earlier item 170. Idea: tiny iPhone haptics for offer received / accepted / confirmed,
"I felt something happen", never "vibrated like a casino".

## Decision (owner, 2026-10-18, LOCKED)
- Offer accepted by the customer: keep the existing success haptic after the customer's own tap
  (`OfferAcceptedMorph` / `BookedCelebration`, `haptic` prop).
- Confirmed group plan, reservation, plan creation: keep the existing success haptic after the person's own action.
- Offer received while the app is open: the visual arrival pill only, no haptic (item 165 / offer arrival lock unchanged).
- Offer received while the app is closed: the OS handles the push per the phone's own settings; the app adds nothing.
- Redemption / "✓ Visit confirmed" (confirmed by the business): no haptic.
- NOT reopened: the arrival lock, item 165, "haptics only after the person's own tap". No new haptic moment, pattern or setting.

## As built (unchanged)
One helper `src/motion/haptics.js` (`playHaptic`, `HAPTIC_MOMENTS`: match / friendAccepted = light impact, success = iOS
success notification), one beat per moment, never a loop or pattern, fails silently, none on web. Regression guards kept:
`motion/haptics.test.js`, `motion/hapticsRespect.test.js` (no haptic on push handling or arrival-driven call sites),
`services/offerArrivals.test.js` ("no vibration or sound").

## Device verification (separate from the decision; NOT RUN)
On a real iPhone, record device, iOS version, results:
1. "I'll take this one" -> booked: one short success tap, at the moment of the booked card, never before the server confirms.
2. Group plan confirm / reservation / publishing a gathering: one success tap each, only after your own tap.
3. A reply arriving while the app is open (any screen): the arrival pill appears, the phone does NOT vibrate.
4. A reply arriving with the app closed: only the phone's own notification behaviour (per its settings); nothing extra on opening.
5. "✓ Visit confirmed" after the business confirms: no vibration.
6. System haptics off (Settings > Sounds & Haptics): no app haptic is felt.
A mismatch is a defect to fix in the shared helper or call site, never a reason to reopen the decision.
