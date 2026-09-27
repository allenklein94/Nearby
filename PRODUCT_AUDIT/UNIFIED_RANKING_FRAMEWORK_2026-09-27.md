# Unified ranking framework (2026-09-27)

Owner ask: one canonical, explainable ranking framework across Nearby, with surface-specific eligibility and presentation.
Consistent principles, not identical rankings. Typed search first, then the rest, without leaving competing engines behind.

## 1. The framework (built, `src/constants/signalPriority.js`)

**The ladder** (owner item 115), strongest first:

| Tier | Name | Meaning |
|---|---|---|
| 1 | intent | how well it matches what the person asked for right now |
| 2 | constraint | a requirement they stated (budget, skill, time they have, distance, dietary, access, party fit) |
| 3 | planFriend | friends / social context (a friend hosting, going, or asking for the same thing; the person the plan is for) |
| 4 | availability | it can actually happen (a live posting, a package, a gathering with room, confirmed open now) |
| 5 | time | time relevance (today, starting soon) |
| 6 | interest | who the person usually is (declared interest, hobby link, past booking, follow) |
| 7 | business | business opportunity (may be able to help, perks, related-interest and friend-interest lifts) |
| 8 | weather | weather fit |
| 9 | popularity | trending / attendance |
| 10 | discovery | distance and everything else |

**The rule.** Every signal a surface scores with belongs to exactly one tier. An item's key is its **tier vector**: the
points it earned in each tier. Items compare tier by tier from the strongest; a stronger tier always beats any amount of a
weaker one; within a tier, points add (so two asked qualities beat one). `tierVector`, `compareTierVectors`,
`compareRanked` are the one implementation. `bestTier` is the flag form of the same rule for surfaces whose signals are yes/no.

**What stays per surface.** Eligibility (what may appear at all: filters, hard constraints, privacy rules) and presentation
(sections, caps, labels, CTAs) belong to each surface. Only the ORDER of what is eligible comes from the framework.

**Adding a signal.** Give it a code and a tier in that surface's tier table first; a test fails on an unplaced code.

## 2. Surface audit (before this work)

| Surface | Scorer | Conflicts with the ladder |
|---|---|---|
| Typed search (Home, Discover, Surprise Me, Celebrate) | additive points across ~30 passes | a declared interest (+5) beat an asked genre (+2); a met requirement tied with weather; availability was not credited to gatherings; a category match was credited to businesses and perks but not to gatherings in that category |
| Best Pick hero (`getGatheringFitReasons`) | additive: attendance up to +10, interest +5, friends +4, distance +3, today +2, first-timers +1 | popularity (tier 9) can beat interest (6) and friends (3) |
| Gatherings feed (`rankByBlend`) | declared interest 5 / broad group 2 / related 2 / behavior up to 4 / comfort 1 | interest only; friends going, time and availability do not order it |
| Discover sections (`buildDiscoverSections`) | fixed section order Now, Tonight, Trending, Because you like, Friends are into, Weekend; inside a section `fit.score` then distance | Trending (tier 9) sits above Because you like (6) and Friends are into (7) |
| Home attention list (`selectHomeAttention`) | strongest tier (`bestTier`), then reason count | already on the ladder; uses the flag form |
| Business routing (`_business_request_fanout`) | hard filters (restrictions, hours, category, geo, largest group), then a lexicographic key: size fit, occasion, exact tag, group fits, dietary, overlap, record, completion, distance | already filter-then-lexicographic; its own business-side order (not a consumer ladder) |

## 3. Migration plan and status

1. **Typed search: DONE (2026-09-27).** Every base score is split into named parts (business, perk, community, friend-request,
   package, policy, occasion-offering, gathering). A ranking ledger (`createRankLedger`, separate from the audit trace so the
   audit can never change an order) records each pass's change per result, including the dietary and child-age passes the
   audit never records. `TYPED_ASK_SIGNAL_TIER` places every code; results carry `rankVector` and are ordered by
   `compareRanked`, and so are every place that re-orders them (Surprise Me pool + rows, plan assembly, Celebrate).
   Deliberate changes: a gathering in the asked category now gets the same category credit a matching business/perk gets; a
   gathering with room gets the same availability credit a live posting gets (a full one does not); intent beats interest;
   a stated requirement beats time + interest together; a friend asking for the same thing beats a business posting. Filters
   and presentation unchanged. Audit rules version `typed-ask-audit-v2`.
2. **Best Pick hero: DONE (2026-09-27).** `getGatheringFitReasons` returns named `parts` with tiers (`GATHERING_FIT_TIER`:
   friends attending 3, room to join 4, today 5, declared interest 6, attendance 9, distance and first-timers 10) and a
   `rankVector`; `pickBestGathering` keeps the surface's eligibility (fit score >= 5, unchanged) and picks among the eligible
   with `compareRanked`. Home now counts accepted friends among the visible approved attendees (it never passed them before,
   so the friends tier could not count). "Room to join" is rank-only, so `score`, Discover's hero/standard thresholds and the
   eligibility bar are unchanged. Not counted: a friend HOSTING (hosts are not attendee rows; Home's merge still adds that
   reason to the card).
3. **Gatherings feed: DONE (2026-09-27).** `utils/gatheringFeedRanking.js` (`feedRankParts`, `rankGatheringFeed`,
   `FEED_SIGNAL_TIER`): friends going 3, room to join 4, today 5, declared interest + own activity + stated comfort 6, broad
   group / related hobby 7, weather 8, then the incoming nearest-first order (stable). Replaces the old two-step sort (weather
   first, then `rankByBlend`) and For You's own category-rank sort: For You now only narrows the list and orders by the same
   ladder. `rankByBlend` removed (its tests moved to the feed's). The weather banner now says options "move up", not "first".
4. **Discover: DONE (2026-09-27).** Sections reordered to the ladder: Now, Tonight, Because you like, Friends are into,
   Trending, This Weekend (one dedupe chain, so a popular gathering in a declared interest now lands under Because you like).
   Discover's `scoreGathering` gives every gathering `fit.rankVector` (the fit parts with their tiers + weather 8, own activity
   6, related/broad 7, and an accepted friend going 3, rank-only so card reasons and `fit.score` are unchanged). ONE in-section
   order, `compareDiscover` (tier vector, then nearest), for every section including Happening Now (was nearest-only) and
   Trending (was attendance-only), the repeat-search section, the Gatherings tab's notable list and the category view.
   `fit.score` still drives the hero/standard tiles and the notable list's eligibility bar.
5. **Home: DONE (2026-09-27).** `selectHomeAttention` ranks by a tier vector (one point per real reason in that reason's
   tier, plus one each for the intent-match, Right Now and perk flags) with `compareTierVectors`, then the engines' own order.
   Same tiers as before; the one behavior change: among candidates with the same strongest tier, more reasons IN that tier
   now win before weaker reasons are counted (before: total reason count, so interest + trending + weather beat two
   interests). Tests in `homeAttention.test.js`. All five consumer surfaces are now on the one framework.
6. **Business routing.** **DECIDED (owner, 2026-09-27): its eligibility rules stay separate from recommendation ranking.**
   Filters first, then its own lexicographic order; no consumer tiers imposed. Minimum spend and want-more are NOT changed
   until each has an exact definition of how it should work.

## 4. Decisions

- Discover section order: decided (step 4).
- Business routing: eligibility stays separate; minimum-spend and want-more unchanged until defined (step 6).
- Confirmed availability outranks "may be able to help" even when the latter is closer: confirmed by the owner.
