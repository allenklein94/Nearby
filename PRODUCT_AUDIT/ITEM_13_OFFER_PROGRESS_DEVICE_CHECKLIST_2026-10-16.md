# Item 13: the business's offer card moves Offer sent -> Accepted -> Redeemed, closing checklist (2026-10-16)

Owner (2026-10-16, with item 127): keep the implementation as built (item 13, LOCKED 2026-10-10); no other funnel visualisation
or sliding-card animation. The one-time green glow is the dashboard's one approved motion exception because it marks a real
status change, and it stays exactly as approved. Close item 13 only after every check below passes AND the labels are reviewed.

Built: `utils/offerProgress.js`, `motion/OfferProgressSteps.js`, `services/offerProgressShown.js`, `SEQUENCES.offerProgress`
(small tier), migration `20270291` (push), realtime on the business's own `business_request_offers` rows. Summaries over the
same rows: item 147's pipeline (`utils/businessPipeline.js`), item 150's month figures (`offerFunnelView`). Section 7 of
`OFFER_EXPERIENCE_DEVICE_CHECKLIST_2026-10-10.md` covers the same moments; a pass there can be recorded here too.

Needs: a real signed-in business account, a customer account, a phone (iOS or Android) and the business website in a desktop
browser and a phone browser. Accepting needs the offer flow, which needs Anthropic credit for screening (never bypass it).

Record for each run: device / browser, OS, appearance (light/dark), Reduce Motion on/off, result, notes.

| # | Check | Phone | Browser |
|---|-------|-------|---------|
| 1 | Signed in as the business: the dashboard loads the real opportunity card for a sent offer, reading "Offer sent". | | |
| 2 | Customer accepts while the dashboard is open: the same card moves to Accepted within about 1 s (push "A customer accepted your offer"; no vibration). Matches the saved status (`offered` -> `accepted`). | | |
| 3 | The business confirms the visit (code or Mark as completed): the card shows Redeemed (saved status `completed`). Never Redeemed before that confirmation; a no-show stays at Accepted + "Didn't show up". | | |
| 4 | Each newly reached step fades in with one green glow, once per offer and step. | | |
| 5 | Leave and reopen the dashboard (and reload the page in the browser): no glow replays. | | |
| 6 | Reduce Motion on: the steps appear settled, no glow. | | |
| 7 | The pipeline strip (New / Reviewing / Offered / Won / Completed) and the month figures (Performance tile, Offer Performance) agree with the saved records for this business (check the counts against a service-role query of its `business_request_offers` rows). | | |
| 8 | Light and dark: steps, ✓ marks and glow readable. | | |

Copy review (not a device check): native-speaker review of the `ui.bizDash2.progress.*` labels in the 10 non-English languages.
