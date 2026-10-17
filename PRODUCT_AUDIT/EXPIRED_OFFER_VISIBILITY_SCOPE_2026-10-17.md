# Expired offers shouldn't disappear: scope (owner idea "151", 2026-10-17)

Nothing is built; this maps the idea onto what exists and asks for one decision. (No item 151 exists yet; the name here is
"expired offer visibility".)

## What exists: an expired offer never vanishes

- **Never deleted.** No migration deletes from `business_request_offers`. Expiry is a status: the live hourly sweep
  `expire_stale_business_requests` (cron `18 * * * *`) sets `status = 'expired'` on an offer whose `valid_until` passed, whose request
  expired, or whose availability posting ended. Server accepts already refuse past `valid_until` at once.
- **Customer:** the same card on the request screen goes "Valid until" -> "Ends in N min" (item 47) -> closed card "This offer has
  expired", accept gone, at the exact moment (`offerLifecycleState` treats `offered` past `valid_until` as expired before the sweep;
  `nextValidityRefreshMs` re-renders while open). It stays listed in the request's replies.
- **Business:** the opportunity stays on the dashboard, below the ones still awaiting a decision (resolved history is never reordered),
  with the status line "No longer open" (`ui.bizDash2.noLongerOpen`). The pipeline (`utils/businessPipeline.js`) leaves it out of the
  current stages (Offered = not past `valid_until`), as defined.

## Gap found (G1): the business card can say "Offer sent" for up to an hour after expiry

`offerProgress` (`utils/offerProgress.js`, item 13) and the dashboard's status line read the RAW stored status. Between `valid_until` and
the next hourly sweep, an offer is still stored `offered`, so the business card shows item 13's "Offer sent" step, while the customer
already sees "This offer has expired" and the pipeline already excludes it from Offered. Same object, three surfaces, two answers
(master principle 2).
Fix (small, shared source): `offerProgress` and the status line read `offerLifecycleState(offer, now)` (the rule the customer and the
pipeline already use), so the business card reads "No longer open" at the exact moment. No new strings, no migration, no motion;
item 13's steps and glow unchanged for offered/accepted/completed. Test: a frozen-clock case at valid_until -1 ms / 0 / +1 ms on
`offerProgress`, plus journey `offer` (an `offered` row past `valid_until` read through the dashboard's helpers). The card would update
on the dashboard's next load/realtime change, not on a timer (no new clock on the business dashboard unless asked).

Not recommended: renaming the business's "No longer open" to "Expired" (it covers expiry by the request, the posting and `valid_until`
alike; the customer's wording stays "This offer has expired"; item 129: the two sides never share wording).

## Analytics
Expired rows are kept, so they remain countable. No new expired figure or tile is proposed (item 127: no other funnel view; any new
business figure needs its own ask and real data).

## Decision needed
1. Record as MET AS BUILT (never deleted; customer closed card; business "No longer open" in history)? Recommended: yes.
2. Fix G1 (business card reads the shared lifecycle state at the exact expiry)? Recommended: yes (no strings, no migration).

Verification either way: none of this has been seen on a phone or in a browser (offer experience checklist, needs Anthropic credit;
item 13's checklist). Live prod has 0 offer rows, so nothing about expiry has run on real data.
