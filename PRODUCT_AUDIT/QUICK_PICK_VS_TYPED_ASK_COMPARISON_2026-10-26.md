# Home quick pick vs typed ask: read-only comparison (owner, 2026-10-26)

Inputs compared: Home "Coffee" Tonight tile vs typing "coffee tonight", same person, same location, same data.
Method: code reading + one deterministic resolver probe (AI off). No app code changed, nothing run against production, nothing on a phone.
Not required: identical results (browse and explicit search behave differently by design).

## Paths

| Step | Home tile | Typed ask |
|---|---|---|
| Source list | `getNearbyGatherings('wide')` (Discover `loadCore`) | `getNearbyGatherings('wide')` (`resolveGatherings`, `services/intentResolver.js:125`) |
| Distance / visibility / started | shared: `get_bounded_nearby_gathering_ids` (`scheduled_at > now()`), `applyGatheringVisibilityFilters`, the wide tier's distance cut | same function, same tier |
| Category | `interest_tag === 'Coffee'` (`applyGatheringFilters`) | words -> Coffee (probe: `subcategory: 'Coffee'`, `dateWindow: 'tonight'`, sources = words), then `interest_tag === category` |
| Time | `matchesDateFilter('tonight')`: today, from 6 PM (item 137) | `matchesDateWindow('tonight')`: all of today |
| Hidden ("Not interested") | hidden (`withoutHidden`, browsing) | still found; its kind is not lowered for an ask naming it (idea "153") |
| Eligibility | none beyond the chips | `runAskEligibility` (hard filters from the words; "coffee tonight" states none) |
| Result set | every match | top `RESULT_CAP` = 4, mixed types (gatherings, communities, businesses, perks) after dedupe |
| Order | nearest first (`enrichGatheringsWithDistanceAndSort`) | ranking ladder (`compareRanked`, `signalPriority.js`) + learned / feedback / weather passes |

## Findings

1. **Distance, visibility, started gatherings: CONSISTENT.** Same source function and tier; a rule fixed there reaches both.
2. **Category: CONSISTENT for Coffee with AI off.** With AI on, an AI tag can override the words' tag (idea "296"'s documented risk); not testable until Anthropic credit exists.
3. **Time: two definitions of "tonight", NOT DRIFT in practice for the tile route.** Typed "tonight" = all of today (documented, Aug 2026);
   the tile's Tonight = today from 6 PM (item 137). A Tonight tile only exists on weekday evenings (`getTimePeriod` evening = 6 PM+), and both
   drop started gatherings, so whenever the tile can be tapped both cover the same remaining window. They DIFFER for a typed "coffee tonight"
   before 6 PM (a 4 PM coffee shows to the typed ask, never to a Tonight chip). UNEXPLAINED BY ANY DECISION: recorded for the owner, not changed.
4. **Not interested: DELIBERATE** (browsing hides, a search still finds; LOCKED).
5. **Cap of 4 and mixed types: DELIBERATE** (a typed ask answers with its best few across kinds; the tile browses all gatherings). A 5th
   matching gathering appears only on the tile route; expected.
6. **Order: EXPLAINABLE, not a bug.** Nearest-first browse vs the ranking ladder (friends, availability, time, interests, ...).

Unexplained differences for investigation: only finding 3's before-6 PM case (typed route only). Proposed nothing; any change needs an owner decision.

## Phone (run order Quick pick check, step 11)

On a weekday evening, same place: tap Coffee Tonight, note the gatherings; then type "coffee tonight" on Discover. Every gathering in the
typed results should also be on the tile's list (unless marked Not interested). A typed result missing from the tile list, or a tile result
that should rank in the typed top 4 but is missing for no stated reason = record both lists + screenshots as possible drift; no code change before it is recorded.
