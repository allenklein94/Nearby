# Item 47 - offer countdown: device checklist (2026-10-11)

**Built, NOT device-verified.** Record device, OS, appearance mode and result per line. No new strings.

What was built: an open offer in its real last 30 minutes (the existing "⏳ Ends in 18 min" phase of the one time engine,
`utils/timeWindow.js`) now reads in the amber in-progress tone (`colors.inProgress`, AA in both modes, never red) with a thin 3 px
bar under it showing the share of those 30 minutes still left. The screen already re-renders at each real minute change
(`nextValidityRefreshMs`); on each, the bar eases to its new length (240 ms, small tier, native driver). The text itself never
animates, nothing loops, pulses, flashes or buzzes. Earlier than 30 minutes: unchanged ("Valid until 7 PM"). Expired: unchanged
("This offer has expired", no bar). Booked/declined: no countdown. Decided by `offerCountdown` (utils/offerPresentation.js) through
`presentOffer().countdown` (the Offer Presentation Engine, item 21); drawn by `components/OfferCountdown.js` inside
`OfferCustomerBody` (customer card + the owner's Customer Preview). Wording kept as "Ends in N min" (already translated), not
"Offer expires in".

| # | Check | Result |
|---|---|---|
| 1 | An offer valid until 45 min from now: plain "Valid until ..." line, no bar, normal colour | |
| 2 | Leave the screen open past the 30-minute mark: the line becomes "Ends in 30 min" in amber with a full bar | |
| 3 | Each minute: the number changes and the bar eases slightly shorter; nothing flashes, pulses or jumps the layout | |
| 4 | At 18 min: "Ends in 18 min", bar about 60 % | |
| 5 | At expiry: "This offer has expired", no bar, accept button follows its existing rule | |
| 6 | Accept during the countdown: the booked card shows no countdown | |
| 7 | Amber reads clearly but calmly in light AND dark mode (never alarming, never red) | |
| 8 | Reduce Motion on: the bar just steps each minute | |
| 9 | Screen reader reads "Ends in 18 min" once; the bar is not announced | |
| 10 | Two offers from different businesses with the same end time look identical | |
| 11 | Owner's Customer Preview with an end time under 30 min shows the same amber line and bar (business web too) | |
| 12 | Overall: urgency feels informative, not pushy | |

Coverage: `src/utils/offerCountdown.test.js` (14 tests: thresholds, nothing invented, open-only gate, fairness, tone/motion/a11y
guards, tier); journey `offer` now submits a real offer valid 18 more minutes and checks the host's row reads "Ends in 18 min" with
its countdown, and none once accepted. Uncovered: the look and the easing (device).
