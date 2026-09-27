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
2. **Best Pick hero: next.** Give each fit reason a tier (friends 3, today 5, declared interest 6, attendance 9, distance 10,
   first-timers 10) and pick by tier vector. Effect: a well-attended stranger event no longer beats a friend's or a declared
   interest's.
3. **Gatherings feed.** Keep its job (a personal ordering of the nearby list): declared interest (6), broad/related (7),
   behavior (6, maturity-dampened, still below declared), comfort (10), plus friends going (3) and today (5) where the feed
   already has them. Same comparator.
4. **Discover sections.** Order inside each section by the same comparator (`fit` becomes a tier vector). Section ORDER is
   presentation, but it currently contradicts the ladder: **needs an owner decision** (item 91 locked it). Proposed: Now,
   Tonight, Because you like, Friends are into, Trending, This Weekend (Trending moves below the two personal sections).
5. **Home.** Move from the flag form to the vector form (same tiers; reason count becomes points within a tier). Small.
6. **Business routing.** Keep its filters first (eligibility, never ranking). Name each key of its order with a business-side
   tier so the audit reads the same way; no consumer tiers are imposed on it. Steps 6 (want-more) and 7 (economics) remain
   owner decisions.

## 4. Decisions the owner needs to make

- Discover section order (step 4).
- Whether business routing adopts want-more (step 6) and minimum-spend vs budget (step 7).
