# Item 160: reply count on Plans rows — device checklist (2026-10-18)

Built 2026-10-18. Proven in code by `src/utils/planReplyCount.test.js`, `hostCommandCenter.test.js` and journey
`plansReplyCount` (production, rolled back). NOT run on a phone. Record device, OS, appearance mode and result per check.

Setup: a signed-in customer with (a) a standalone business request (Ask a business, not from a gathering) and (b) a gathering
they host with a business request; real businesses reply from the business side.

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 1 | Standalone request, nobody has replied, open Plans -> Upcoming | Row reads "… · Asked N businesses — waiting to hear back" | |
| 2 | Two businesses send real offers (a price, a discount, a title or included items); leave Plans and come back | "2 offers — choose one" (no count-up, no motion) | |
| 3 | A third business answers plainly ("Yes, as requested", nothing concrete); come back to Plans | "3 businesses responded", never "3 offers" | |
| 4 | Same replies on the hosted gathering's request: Home's Your Plans row and the gathering screen's Place status | Same words as the Plans row | |
| 5 | Host command center on that gathering, one plain reply only | "{Business} can take you", never "Offer received" | |
| 6 | Host command center, several replies, not all offers | "N businesses responded" | |
| 7 | An offer with a short validity: open Plans just after its end time, before an hour passes | That offer no longer counted | |
| 8 | A business withdraws its reply | No longer counted on return to Plans | |
| 9 | Plans stays open while a reply arrives | The row does NOT change until you leave and return (or pull to refresh); the request screen's reply travel is unchanged | |
| 10 | Tap the row | Opens that request's screen, unchanged | |
| 11 | Spanish (or another language) | Wording is the existing translated string; note it for native review | |
