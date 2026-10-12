# Item 48 - business "signal received": device checklist (2026-10-11)

**Built, NOT device-verified.** Record device, OS, appearance mode and result per line. No new strings. Needs a real business
account plus a second (customer) account sending it a request; realtime delivery to a real signed-in business has never run.

What was built: the business-side mirror of marketplace moment 1 ("request sent"). An opportunity the business can still answer
that this device has never shown arrives on the Opportunities list with a signal: the card rises 8 px into place (text readable
from frame one, Accept / Alternative / Decline live at once) while the very same two soft rings the customer saw when sending go
out from the card's ✨ headline ("✨ New opportunity" / "✨ Good match for your business"). Plays when the dashboard opens after it
arrived, and live when a new opportunity row arrives while the dashboard is open (realtime INSERT on the business's own offer
rows -> the dashboard re-reads; the payload is never read). Once per opportunity per device; at most 3 cards per load, top-down,
120 ms apart; the rest simply appear. Medium tier (< 0.5 s), no haptic/sound/bounce/loop/counter. Reduce Motion = card settled.
Rule: `utils/opportunityArrival.js`; motion: `motion/OpportunityArrival.js`; memory: `services/offerProgressShown.js`.
Wording and buttons are unchanged ("Someone nearby is looking for this" and "View Request -> Make Offer" were NOT added: see
CLAUDE_HISTORY.md item 48).

| # | Check | Result |
|---|---|---|
| 1 | Customer sends a request to the business; business then opens the dashboard: that card rises in with two soft rings from its ✨ | |
| 2 | The rings are centred on the ✨ (not offset), quiet, and gone in under half a second | |
| 3 | Close and reopen the dashboard: the same card does NOT play again | |
| 4 | Dashboard open on Opportunities; customer sends a new request: within a few seconds the new card arrives with the signal | |
| 5 | Tap Accept on the arriving card immediately: it responds at once | |
| 6 | Four or more new opportunities at once: the top three arrive one after another, the rest are simply there | |
| 7 | An opportunity already replied to / booked / expired never plays | |
| 8 | Switch section and back during or after the signal: no replay | |
| 9 | Reduce Motion on: cards appear settled, no rings | |
| 10 | Light and dark mode: rings visible but calm (info blue) | |
| 11 | Business web (docs/business) in a real browser: same behaviour | |
| 12 | Overall: feels like real demand arriving, calm and professional, not a slot machine | |

Coverage: `src/utils/opportunityArrival.test.js` (11: once only, real answerable demand only, cap and order, moment-1 registration,
same rings, budget, never delays, calm tone, live INSERT wiring); journey `offer` step "item 48" runs the very row
`get_business_opportunities` returned. Uncovered: realtime delivery and the look (device / browser).
