# Item 51 - the business's first-ever offer confirmation - device checklist (2026-10-12)

Status: BUILT, LIVE (migration 20270299 applied, screen-business-content deployed), NOT DEVICE-VERIFIED.
Needs: Anthropic credit (every owner send is screened first), a real business account that has NEVER had an offer reach a
customer, a real customer with an open request, a phone (iOS + Android) and the business website. Record device, OS, language,
light/dark and the result of each check.

| # | Check | Result |
|---|-------|--------|
| 1 | One-tap reply ("Standard availability") as the business's first ever: the toast reads "Your first reply is on its way" + "The customer will see you can take them." | |
| 2 | Or a full offer (e.g. "20% off tonight") as the first ever: "Offer saved" first (unchanged; nothing sent yet), then, once it clears, the Your offers card reads "Your first offer is on its way". | |
| 3 | The SECOND offer from the same business reads exactly as before ("Offer sent" / "Reply sent"), on this device and on another device or a reinstall. | |
| 4 | Two owner devices sending at the same moment: at most one shows the first-offer line. | |
| 5 | A business whose first offer went out automatically (standing availability / package / policy match) never sees the line on a later manual send. | |
| 6 | Calm: the same toast/card as any send, no confetti, extra motion, sound or vibration. | |
| 7 | Reviewer-approved first offer ("Being reviewed" -> approved): the Your offers card reads "Your first offer is on its way". | |
| 8 | Customer side unchanged: the customer's first reply still reads "Your first reply from a local business" with the longer arrival notice and the same animations. | |
| 9 | Native review of `ui.bizHelp.confirm.firstOfferTitle` / `firstReplyTitle` in the 10 non-English languages. | |
