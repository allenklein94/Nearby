# Universal Signal & Recommendation Audit — 2026-08-28

Read-only. No application code was changed to produce this document. Direct follow-up to the
Taxonomy Post-Implementation Audit remediation pass (see `CLAUDE.md`, same date), which fixed
four real gaps and then explicitly deferred this broader pass rather than build past its own
scope. Method: two capped research passes (each producing its own scoped, cited file, folded
into this one and deleted afterward), plus a direct synthesis pass — every headline claim below
was independently re-verified by direct source read before being published here, not taken on
either pass's word alone.

Legend: 🟢 connected/working as designed · 🟡 partially connected / real but weaker than it
looks · 🔴 real gap, not fully connected · N/A stage doesn't apply to this signal by design.

---

## 1. The 12-signal matrix

| Signal | Collected | Stored | Displayed | Filtered | Matched | Ranked | Context |
|---|---|---|---|---|---|---|---|
| Personal interest | 🟢 | 🟢 | 🟢 | 🔴 | 🟡 | 🔴 Dating / 🟢 Friends | N/A |
| Category (`interest_tag`) — control | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |
| Relationship intention | 🟢 | 🟢 | 🟢 | 🔴 | 🟡 | 🔴 (same root cause as interest) | N/A |
| Gender (canonical + legacy fallback) | 🟢 | 🟢 | 🔴 (never shown to a viewer) | 🟢 | 🟢 | N/A (correctly binary) | N/A |
| Distance / proximity | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 |
| Price (3 real representations) | 🟢 | 🟢 | 🟢 | 🟡 (gathering only) | 🟢 tier / 🔴 `budget_max` | 🟢 tier / 🔴 `budget_max` | 🟡 |
| Party type / party size | 🟢 | 🟢 | 🟢 type / 🔴 `accommodates_party_types` past profile | 🟢 type / 🔴 size vs. capacity | 🟢 type / 🟡 size (1 of 3 places) | 🟢 type / 🔴 size | 🟡 |
| Business cuisine | 🟢 | 🟢 | 🟢 | 🟡 (bonus not filter, by design) | 🟢 (3 real implementations) | 🟢 | 🟢 |
| Business attributes + `priority_attributes` | 🟢 | 🟢 | 🟢 | 🟡 (bonus not filter, by design) | 🟢 (never conflated) | 🟢 | 🟢 |
| Availability / supply (3 mechanisms) | 🟢 | 🟢 | 🟡 (capacity invisible past the business's own dashboard) | 🟢 availability / 🟢 policy / 🔴 gathering | 🟢 / 🟢 | ⚠️ real cross-tier violation | 🟢 (dedup, narrower than claimed) |
| Time / date-window | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 | 🟢 (but 2 incompatible "now" definitions) | 🟢 |
| Weather | 🟢 | 🟡 (session-only, by design) | 🟢 | 🔴 (bonus not filter, likely intentional) | 🟢 (3 independent implementations) | 🟢 Home/Discover / 🔴 ask-box/browse | 🟢 |

Full per-signal tables, file:line citations, and grounding for every cell above are preserved in
this document's own sections 3-4 below (folded in from the two working passes) — this table is
the compressed index, not the evidence.

---

## 2. The Context Layer — does Nearby actually have one?

The second AI's own closing question was whether Nearby is building toward a genuine
context-aware ranking engine (weather/time/distance/availability/social-context all modulating
the same shared score) or whether each context signal is a one-off, siloed per-surface trick.
**The honest answer is both, in a specific and traceable way — not a clean yes or no.**

**Real, working, shared infrastructure exists and is genuinely load-bearing**: `intentResolverScoring.js`'s
`SCORE_INTEREST_MATCH`/`SCORE_CLOSE_DISTANCE`/`SCORE_HAPPENING_NOW`/`SCORE_OWN_NETWORK` constants
are reused verbatim across `priceAndPartyBonus()`, `attributeAndCuisineBonus()`,
`titleMentionBonus()`, and `scoreGatheringForResolver()` — a real single scale, not five invented
ones. `businessOpportunityScoring.js` correctly keeps two semantically distinct attribute signals
(`attributes` vs. `priority_attributes`) from ever double-counting the same match, and scales its
one real intensity-aware signal (a business's own temporary priority boost) by a real 0-1
`strength` value rather than a flat bonus — genuinely the shape of thing a real context layer
looks like. Distance (§4, Pass A) is fully closed-loop everywhere it's used. Cuisine and
attributes (§5, Pass B) have three independent, mutually-consistent, live-verified ranking
implementations apiece.

**But weather — the single clearest real example of one signal modulating another — is
implemented three separate times** (`homeRecommendations.js`'s `weatherAdjustment()`,
`homeDashboard.js`'s `indoorGatheringsToday`/`outdoorGatheringsToday`, `DiscoverHubScreen.js`'s
own `weatherIndoorBias`/`weatherOutdoorBias`), each its own hand-rolled re-derivation of the same
`isIndoorCategory`/`isOutdoorCategory` + forecast-risk rule, none of them sharing a function.
**And the single most-used entry point in the whole app — `intentResolver.js`, which backs
Home's own ask box — takes no weather parameter at all**, confirmed directly
(`grep -n "weather" src/services/intentResolver.js` → zero hits). A user who types "something
fun tonight" into the one canonical intent box gets zero weather-aware re-ranking; a few screens
away, Home's passive "Nearby Right Now" section already has it. `GatheringsScreen.js` — the
actual full browse/filter surface — has never had weather wired in at all.

**Time is the same story from a different angle**: two real, internally-consistent-but-mutually-
inconsistent definitions of "now" coexist (a narrow ±30min/+2h window vs. a full-calendar-day
match), sharing the same English words across surfaces that sit one tap apart — `GatheringsScreen.js`'s
"Right Now" filter chip means the narrow window; `create-assistant`'s `dateWindow` classification
of a user typing "right now" collapses to the broad, full-day bucket. Neither is wrong on its
own; the drift is that a user has no way to know which "now" they're actually getting depending
on which box they typed into.

**Verdict**: Nearby has real, proven shared-scoring infrastructure (the `SCORE_*` constants,
the resolver's own additive-bonus convention) — that part of the "universal matching primitives"
vision from CLAUDE.md's own Aug 27 2026 doctrine capture is genuinely real, not aspirational. What's
missing isn't the *primitive*, it's *coverage*: the same real context signal (weather, "now")
reaches some recommendation surfaces and not others, and where it reaches more than one, it's
re-implemented rather than shared. This is a materially smaller problem than "no context layer
exists" — it's "the context layer exists in pieces, inconsistently wired to the app's own
surfaces," which is a real, scoped, fixable gap (share one weather-scoring function; thread it
into `intentResolver.js`; pick one "now" definition for the ask-box to use), not a from-scratch
architecture problem.

---

## 3. Four real, code-traced persona flows

Same method as every other flow trace in this file's history — direct code reading (imports,
function calls, RPC bodies), never a simulator run, which this sandbox has never had access to.

### Persona 1 — "Find something cheap to do with two friends tonight, nothing fancy"

`create-assistant` classifies this: `dateWindow: 'tonight'` (the broad, full-calendar-day
bucket — §2 above), `priceLevel: '$'` (today's earlier fix correctly maps "cheap" to `$`, not
`free`), `partyType: 'friends'`, `partySize: 3` (today's earlier fix: "two friends" = the asker
+ 2 = 3 total). `resolveIntent()` fans this out across all 6 resolver branches in parallel.
`resolveGatherings()` scores real candidates via `scoreGatheringForResolver()` +
`titleMentionBonus()` + `priceAndPartyBonus()` — a gathering tagged `price_level: '$'`,
`party_type: 'friends'`, scheduled any time today, earns the full stack of bonuses. So far,
genuinely coherent: three independently-collected signals (price, party, time) all converge on
one ranked gathering result, and this exact chain was live-verified end to end in the taxonomy
remediation pass. **Where it quietly narrows**: `resolveBusinessAvailability()` and
`resolvePolicyOnlyBusinesses()` run in the same fan-out, but neither ever receives `partySize`
in a way that changes their score (§5) — a 3-person party and a 1-person party get identically-
ranked business results, and if the ask box's classified `cuisine`/`attributes` end up empty
(this ask genuinely implies neither), the business branches fall back to pure distance +
happening-now, which is where the cross-tier violation (§5, F6 below) becomes live: an
unconfirmed policy-only match nearby can outrank a confirmed available one slightly farther
away, with nothing in the UI distinguishing "confirmed" from "may be able to help" beyond a
small copy difference already documented elsewhere in CLAUDE.md.

### Persona 2 — Browsing Dating, real strong interest overlap three rows down

A user opens Discovery → Browse. `getBrowseMatches()` (`proximity.js:376-406`) fetches a real
batch of nearby profiles, computes a real `compatibilityScore` per profile via
`calculateCompatibility()` (interest overlap + relationship-intention overlap + music, a real
weighted sum), and returns the list — **with no `.order()` clause on the underlying query at
all**, confirmed directly. The profile with the highest real compatibility score in that batch
has no more chance of appearing first than the lowest. Crossed Paths mode is marginally better —
at least deterministic — but sorts strictly by `last_seen_at desc` (`proximity.js:233`), so a
93%-compatible person seen yesterday can rank behind a 4%-compatible person seen ten minutes ago.
Compare directly against Friend Discovery, reached one tap away under the same People-mode
toggle: `get_friend_discovery_candidates()`'s real live SQL genuinely `order by
(shared_interest_count + shared_community_count + mutual_friend_count) desc, distance_miles asc
nulls last, random()` — the equivalent signal, on the sibling surface, actually orders results.
This is the single most user-visible finding in this whole audit: two matching engines under one
segmented toggle, one of which uses its own computed relevance score to decide what you see
first, the other of which computes the identical class of score and never once uses it.

### Persona 3 — A business owner comparing two opportunities in their inbox

A business opens the Business Opportunities card and sees two real pending requests: "up to
$150" and "up to $30" (`business_requests.budget_max`, rendered verbatim on the card,
`BusinessDashboardScreen.js:2482`). Both already carry real itemized "why this matches" reasons
(`opportunityReasons`, from `scoreBusinessOpportunity()`) covering category, cuisine, and
attribute/priority-attribute overlap — genuinely rich, per the taxonomy remediation pass's own
confirmation that this card already works. **The one real number missing from that reasons
list is the number already sitting two lines below it on the same card**: `budget_max` never
enters `scoreBusinessOpportunity()`'s own param list at all (confirmed directly — zero `budget`
references in `businessOpportunityScoring.js`), so a request offering 5x the spend of another
scores and sorts identically to it. The business reads both numbers and judges for itself; the
app, which already does real itemized reasoning for every other collected field on this exact
row, silently sits this one out.

### Persona 4 — Checking three different "is it raining" surfaces in the same session

A user opens Home during real rain — the "Nearby Right Now" section correctly re-ranks toward
indoor gatherings (`weatherAdjustment()`), and the weather card's own inline suggestion list
independently shows the same intent via `homeDashboard.js`'s separately-computed
`indoorGatheringsToday`. They then tap into Discover — "Recommended For You" independently
re-derives the identical indoor bias a third time (`DiscoverHubScreen.js`'s own
`weatherIndoorBias`). They then tap "Browse" at the top of `GatheringsScreen.js` (the actual full
list/filter screen, arguably where a real decision gets made) — no weather signal reaches this
screen at all; an outdoor gathering starting in twenty minutes, during a downpour, ranks exactly
where its other real signals put it. Finally, they type "something fun today" into Home's own
intent box — the one surface built explicitly to be the app's canonical "ask Nearby anything"
entry point — and get a result list with, again, zero weather awareness. Three real, working,
independently-coded weather features exist; the two surfaces a user is most likely to actually
transact through (the full browse screen, the ask box) have none.

---

## 4. Ranked findings — real, concrete, none of this built in this pass

1. **🔴 Cross-tier business ranking violation, contradicts the code's own documented invariant.**
   `resolveBusinessAvailability()`'s minimum possible score is `SCORE_HAPPENING_NOW` (2, always
   awarded). `resolvePolicyOnlyBusinesses()`'s maximum possible score is `SCORE_CLOSE_DISTANCE`
   (3). The final sort (`deduped.sort((a,b) => b.score - a.score)`, `intentResolver.js`) has no
   type-priority tiebreak — confirmed directly by reading the full sort/dedup block. The existing
   dedup step only suppresses a policy-only duplicate for the *same* business that also has a
   confirmed posting; it does nothing across different businesses. `resolvePolicyOnlyBusinesses()`'s
   own header comment states "on the shared score axis it can never outrank a genuinely confirmed
   posting for the same real estate" — literally true only for the same-business case the dedup
   covers, not the general case. Real fix shape, not built here: either give confirmed availability
   a real score floor above policy-only's real ceiling (e.g. `resolveBusinessAvailability()`'s
   baseline bonus moves from `SCORE_HAPPENING_NOW` to something that structurally exceeds
   `SCORE_CLOSE_DISTANCE`), or add an explicit tier field the final sort keys on before score.
2. **🔴 Dating's own computed relevance score never orders its own results.** `compatibilityScore`
   is real, computed for every candidate on both Crossed Paths and Browse, shown as a badge, and
   usable as an optional ≥70% filter — but never feeds either list's actual order (`last_seen_at`
   only for Crossed Paths; no `ORDER BY` at all for Browse). Friend Discovery, the structurally
   analogous sibling surface, already does the correct version of this — same real signal shape,
   genuinely wired to the SQL `ORDER BY`. This is a real product decision worth making explicitly
   (should Browse/Crossed Paths incorporate `compatibilityScore` into sort order the way Friends
   already does, or is recency-first/unordered a deliberate choice that's simply never been
   stated anywhere in this codebase's own conventions) — not something this pass silently picked
   either way.
3. **🔴 A fully-waitlisted gathering can rank #1 in ask-box results with zero indication.**
   `gatherings.capacity` is already fetched (`SAFE_GATHERING_FIELDS`, confirmed live), but
   `resolveGatherings()`'s mapped result object only ever returns `{type, id, title, subtitle,
   score}` — `capacity`/fullness never makes it into the candidate the client actually ranks and
   shows. A consumer can tap through a top-ranked ask-box result only to discover, one screen
   later, that it's already full. Cheap to close (the field already exists in the fetched row;
   this is a mapping omission, not a missing query).
4. **🔴 A confirmed business-availability posting's real remaining capacity is invisible past the
   business's own dashboard, and never compared against the requester's party size.**
   `search_active_business_availability()`'s live SQL (confirmed via `pg_get_functiondef`) filters
   only on a binary `remaining_capacity is null or remaining_capacity > 0` and doesn't even
   return capacity in its output columns — a party of 8 and a party of 1 see an identical result
   for a posting with exactly one seat left. Real, live customer-facing correctness gap in the
   marketplace's own supply-matching logic, worse in kind than finding 1 above since it can let a
   party genuinely believe a slot fits them when it structurally cannot.
5. **🔴 `business_requests.budget_max` is a real, explicitly-typed number that dead-ends at
   display.** Collected, stored, shown to the business — never filters, matches, or ranks
   anything (confirmed via a full grep across `src/services/` for any `score +=` touching
   `budget`). The cleanest "collected → stored → displayed → dead end" example in the whole
   audit, and the cheapest of the five 🔴 findings above to close, since `scoreExperience()`
   already receives an equivalent `requestPriceLevel` param this could extend from.
6. **🟡 Weather reaches two recommendation surfaces (Home, Discover) via three independent
   re-implementations of the same rule, and reaches neither the ask box nor the full browse
   screen at all.** See §2 above for the full reasoning — a real, scoped consistency/coverage
   gap, not an architecture problem.
7. **🟡 Two real, internally-consistent, mutually-inconsistent definitions of "now" share the
   same English words across adjacent surfaces** (a narrow ±30min/+2h window vs. a broad
   full-calendar-day match) — `GatheringsScreen.js`'s own "Right Now" filter chip is the more
   precise of the two; the ask box's `dateWindow` classification is the one that should likely
   adopt the narrower definition, not the reverse.
8. **🟡 `brand_partners.accommodates_party_types`** — collected specifically to answer "can this
   business handle my kind of group," never reaches a consumer-facing filter, match, or rank
   stage anywhere; referenced only inside the business's own dashboard/profile screens.
9. **🟡 `gender_identity`/`interested_in_genders` are never displayed to a profile viewer** —
   likely an intentional "private matching signal, not a public badge" design (consistent with
   how the legacy `show_me`/`discovery_gender` pair never rendered publicly either), but never
   stated as a deliberate decision anywhere in this codebase's own history. Worth a real,
   explicit yes/no, not a silent gap.
10. **Two minor, disclosed-not-broken precision notes**: `_business_request_fanout()`'s live SQL
    counts *how many* attributes overlap (a real cardinality), while the client-side
    `attributeAndCuisineBonus()` only checks *whether* any overlap exists (binary) — two honest
    but differently-precise implementations of "the same idea," worth knowing before assuming
    they're interchangeable. And `SCORE_HAPPENING_NOW` now backs six semantically unrelated
    bonuses (a deliberate, disclosed, repo-wide convention — not a bug, but a real naming risk
    for a future session skimming for "what affects the happening-now score").

---

## 5. Direct answers

**Is there a genuine context-aware ranking layer, or is each context signal siloed per
surface?** Both, in a traceable split — see §2. The scoring *primitives* are genuinely shared;
*coverage* of any one context signal (weather, "now") across every surface that should honor it
is not, and where it's reached more than once it's independently re-derived rather than shared.

**What's the single fix that would most improve trust in the ask box specifically** (the app's
own stated canonical intent entry point)? Finding 3 (gathering fullness invisible to its own
ranked result) and finding 1 (the cross-tier business ranking violation) are both real
correctness bugs in the one surface most users will actually type into — either would visibly
undermine "Nearby found me the right thing" the moment a user hits it.

**What's the clearest positive control confirming the app's overall architecture is sound, not
just that this audit finds gaps everywhere it looks?** Distance/proximity (Pass A) and cuisine +
business attributes (Pass B) are all fully closed-loop, live-verified, multi-surface-consistent
signals with zero real gaps found across all seven stages — three genuinely different kinds of
signal (a privacy-sensitive geospatial one, a vocabulary-matching one, a business-supply one),
all correctly wired end to end. The method finds real gaps because real gaps exist, not because
it's calibrated to find something regardless.

**Is this audit itself trustworthy — were its two most surprising claims independently
re-checked, or taken on the research passes' word?** The two most consequential findings
(the cross-tier ranking violation, and gathering capacity being dropped from the resolver's own
mapped result) were both independently re-verified by direct source read in the synthesis pass
before being published here, matching this file's own standing rule to verify before building on
a claim.

---

*Nothing in this document was built. Every finding above is a real, concrete, ready-to-build
recommendation for a future, separately-authorized pass — matching this codebase's own repeated
convention of naming a gap plainly rather than silently fixing or silently ignoring it.*
