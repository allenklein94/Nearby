# Perk redemption: claimed vs confirmed (owner, 2026-10-12) - device checklist

Rule: claiming a perk creates a code; only the business's confirmation establishes a real visit. One state rule
(`utils/perkRedemptionState.js`): available = Redeem; claimed = the "Your code" box every time the perk opens; confirmed by the
business = "✓ Redeemed". Same on Discover -> Perks (panel + card), a community's perks, a business profile's perks.
Built and verified by Jest, journey `perkRedemption` and `scripts/live-verify/confirmed-visit-counts.sql` (16/16 live).
Nothing below has been seen on a phone. Do not call the flow verified until every box is ticked.

Record device, OS, appearance mode, language for each.

Customer (one phone) + business (business dashboard, phone or website):
- [ ] Discover -> Perks: open a perk, tap Redeem. The "Your code" box appears in place: "Show staff at {business} this code to
      confirm: 123456", then the business's own instructions only if it wrote some. No "Redeemed" anywhere yet. No "check your
      account" line. The card in the list shows no "Redeemed ✓".
- [ ] Close the perk, leave Discover, come back, open the perk again: the SAME code is shown.
- [ ] Kill and relaunch the app, open the perk: the same code is still shown.
- [ ] Business profile perk: tap Redeem. Alert titled "Your code" with the same message; after OK the perk shows the code box
      (not a Redeem button, not "Redeemed"). Leave and reopen the profile: code still there.
- [ ] Community perk: same as the business profile.
- [ ] Tap Redeem on a perk already claimed on another device / stale list: no "already redeemed" alert; the code box appears.
- [ ] Business: enter the code in the dashboard -> "{name}'s redemption of {offer} is confirmed".
- [ ] Customer: reopen the perk (each of the three places): "✓ Redeemed" badge, no code box. (There is no live update while the
      perk is already open; reopening is the step.)
- [ ] Code is selectable/copyable and readable in light and dark mode; long instructions wrap without cutting off.
- [ ] Screen reader: the code box is announced once when it appears.

Counts (claimed code is not a visit):
- [ ] Before the business confirms: business dashboard Total redemptions / This month / Repeat customers unchanged; the
      customer's perk tier line (Discover -> Perks) unchanged.
- [ ] After confirming: each goes up by exactly one, once (reload twice: no double count).
- [ ] "redemptions vs last month" moves only with confirmed visits.
