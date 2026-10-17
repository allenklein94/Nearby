# An offer that becomes available exactly when relevant: scope (owner idea "149", 2026-10-17)

"149" is already item 149 (potential value on opportunity cards, LOCKED), so this is called "offer validity window" here.
Nothing is built; this maps the idea onto what exists and asks for one decision.

## What exists (one card, changing state in place; no separate screens)

**A reply to the customer's request** (`business_request_offers`): has an END only, `valid_until` (optional, set in Make an Offer).
One rule: `offerLifecycleState` (`utils/objectLifecycle.js`) -> `offerCard` / `presentOffer` (`utils/offerPresentationEngine.js`), label from the
shared time engine (`timeWindowState(..., 'offer')`). On the request screen the same card goes "Valid until 8 PM" -> "Ends in 30 min" (item 47's amber
line + bar) -> "This offer has expired" (closed card, accept gone), re-rendering at each real change while open
(`nextValidityRefreshMs`, `BusinessRequestDetailScreen.js`). Once booked, the plan carries the reply's own time (`proposed_time`, item 119) via
`displayWhen`.

**A business availability posting** shown in typed-ask results (`business_availability.starts_at/ends_at`, item 80/114: only for a matching
ask): has START and END. Same engine (`localWindow(..., 'availability')`, `recommendationContext.js`) kept current by item 108's minute clock
on Home + Discover: "Starts in 15 min" -> "Happening now" -> "Available until 8 PM" -> "Ends in N min"; the RPC drops it once `ends_at` passes.

So the idea's example (5:45 "starts in 15 min", 6:00 active, 8:00 expired, same card) already happens for availability postings, and the
end half already happens for replies.

## The one real difference: a reply has no start

Adding a start (a reply the customer can see but not take until 6 PM) is **not recommended**:
- Acceptance IS the booking (locked doctrine). A 6-8 PM reply already says when to come (`proposed_time`, up to two times, item 119);
  the customer should be able to book it at 3 PM for 6 PM. A not-yet-acceptable reply would block exactly that.
- It would be a second time concept on a reply beside `proposed_time` (master principle 2), new Make an Offer field + strings + migration,
  and new copy ("Offer is active") that adds nothing over the existing labels.
- Item 118 (one revision, price/time only) and item 119 (two times) are LOCKED around today's fields.

Locks that apply either way: no motion added to the state changes (item 47: no flash/pulse/loop; item 108: plain text, no urgency
styling); no separate screens (item 45); no availability broadcast (item 114).

## Decision needed
1. Record as MET AS BUILT (reply end + availability start/end on the shared engine), nothing built, start-time on replies DECLINED?
   Recommended: yes.
2. If you want a reply to have a start anyway, say so and I'll write a build plan (migration, Make an Offer field, server refusal before
   the start, journey `offer`, native review of new strings) before building.

Verification status either way: none of these state changes has been seen on a phone (offer experience checklist; item 47 and item 108
checklists; needs Anthropic credit for live offers).

## Owner decision (2026-10-17): option 1, LOCKED
Met as built. No separate start-time field on business replies or offers; the proposed visit time (incl. item 119's second time) stays the
source of timing; accepting is the booking, no activation delay; no migration, no Make an Offer field, no "Offer is active" wording; the
offer and booking lifecycle are preserved. Phone verification NOT done: offer experience checklist (needs Anthropic credit), item 47's
checklist, item 108's check C10.
