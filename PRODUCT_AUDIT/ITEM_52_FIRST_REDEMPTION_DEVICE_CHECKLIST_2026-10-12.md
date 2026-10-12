# Item 52 — first successful redemption — device checklist (2026-10-12)

Built, tests + `offer` journey pass; NOT device-verified. Record device, OS, appearance mode and result for each check.

Setup: a customer account with NO completed offer yet, a real business, a request -> offer -> accept -> confirmed reservation.

1. Business (or the customer) marks the visit complete while the customer has the request open: "✓ Visit confirmed" and,
   under it, "You used Nearby to turn a request into a real-world experience." settle in TOGETHER (one fade + rise, one green
   glow); the line never appears a beat later or flickers.
2. Close and reopen the request: both lines are there, nothing animates.
3. Sign in on a second phone (or reinstall): the line is still on that same offer (server decided, not the device).
4. A SECOND completed redemption (another request): "✓ Visit confirmed" only, no line. The first offer keeps its line.
5. Reduce Motion on: both lines appear settled at once.
6. No haptic, no confetti, no extra motion beyond the existing visit-confirmed settle and glow.
7. Light and dark: the line is secondary text, readable, wraps cleanly at narrow width and in the longest language (de / tl).
8. Offline when the screen loads: the card shows "✓ Visit confirmed" without the line (never an error).
9. Native review of `ui.requestDetail.firstVisitNote` in 10 languages (machine-authored).
