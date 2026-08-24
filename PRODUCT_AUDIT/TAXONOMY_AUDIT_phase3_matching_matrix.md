# Phase 3 — Matching Signal Audit: the Matching Matrix

Part of the "Nearby Universal Taxonomy, Filters & Matching Audit" (see CLAUDE.md, top section).
Read-only research — no code was changed to produce this file.

**Columns, adapted to Nearby's real IA rather than the external message's generic "People"
column** — Nearby has no merged "People" surface; Dating and Friends are two deliberately
separate matching engines under one Discover tab (a locked, repeatedly-reaffirmed decision, see
CLAUDE.md's Aug 24 2026 "Discover's People mode" section). The real 5 recommendation surfaces
this app has are: **Dating**, **Friends** (Friend Discovery), **Gatherings** (browse/create/
Home's intent resolver), **Communities**, **Businesses** (Ask a Business + the fulfillment
engine). "Things to Do" isn't its own separate matching engine — it's Discover's browse mode
over Gatherings/Communities/Places/Perks, which don't have a matching engine distinct from the
ones already listed.

**Hard/Strong/Soft/Contextual, per the user's own requested dimension**:
- **Hard** — a real eligibility gate; failing it means never being shown/matched at all.
- **Strong** — a real, meaningfully-weighted scored boost (this app's own `SCORE_OWN_NETWORK`/
  `SCORE_INTEREST_MATCH` tier).
- **Soft** — a small scored boost (`SCORE_HAPPENING_NOW`-tier, or an unweighted tie-breaker).
- **Contextual** — a temporary, situational modifier (weather, time-of-day), not tied to a
  standing user preference at all.

## Real findings

1. **The two engines that score most transparently and consistently are `intentResolver.js`
   (Gatherings/Communities/perks/business-availability, all on one shared `SCORE_*` axis) and
   `get_friend_discovery_candidates` (a real weighted sum: shared interests + shared communities
   + mutual friends, then distance).** Both are honest, explainable, no black-box blend — matches
   this file's own standing "no opaque AI-driven matching score" rule. Dating's own
   `compatibilityScore` is the one real exception worth naming: it's a genuine composite (interest
   Jaccard similarity + basics-field overlap + music-artist overlap, averaged into one number,
   `calculateCompatibility()`) — still fully inspectable/reproducible client-side (not an LLM
   call), but it IS the one place in the app that collapses several real signals into a single
   percentage the user sees and can hard-filter on (`highCompatOnly`, ≥70) — worth flagging as
   the closest thing this app has to the "Nearby Score" the Aug 15 2026 V3/V4 vision-doc section
   already explicitly rejected building as a *cross-surface* concept; this one is real, but
   scoped to Dating only, and pre-dates that rejected proposal.
2. **`price_level`/`party_type` (today's brand-new fields) are the one clean, concrete example
   of a real preference that exists, is filterable, but reaches zero matching/ranking function
   anywhere in the app** — confirmed by reading `intentResolver.js`'s gathering-scoring branch
   directly: it scores `matchesYourInterests`/`distanceMiles`/`isToday`, nothing else. A user
   whose Home intent-box ask implies a price or party-size preference (e.g. "cheap coffee for
   just the two of us") gets zero benefit from these two new fields existing.
3. **Business attributes genuinely do not exist anywhere in the schema** — confirmed directly
   against live production: `brand_partners` has exactly one category-shaped column (`category`,
   the 6-value industry enum) and zero cuisine/ambiance/price-tier/date-friendly/outdoor-seating
   columns; `business_requests`/`business_availability`/`business_fulfillment_policies` are the
   same — category/price/party-size/time-window only. The external message's own worked example
   ("Italian + outdoor + date-friendly" business surfaced for a "Dating + Italian food" ask) is
   **completely unrepresentable today**, not partially — this is the single largest structural
   gap the whole audit found. See Phase 4 for the full detail.
4. **Friends is the one surface with real, weighted scoring and literally zero user control over
   any input to it.** The scoring formula (`shared_interest_count + shared_community_count +
   mutual_friend_count`, distance as tiebreak) is entirely reasonable — but a user has no way to
   say "I care more about shared interests than mutual friends," no filter, no visibility into
   why anyone was ranked where they were. Every other surface (Dating, Gatherings, Ask a
   Business) gives the user at least some visible control over what they see.
5. **No signal collected for one surface currently crosses over to improve another**, confirmed
   directly: personal `interests` feeds Dating's compatibility score, Friend Discovery's ranking,
   and (via a different, deliberately-separate list) gatherings' own category matching — but
   `relationship_intention` (dating-only), the 24 Basics filter fields (dating-only, premium-
   gated), and `party_type`/`price_level` (gatherings-only, currently unused even there) never
   reach any other surface. The one signal that genuinely does cross surfaces already is
   `interests` itself — everything else stays siloed to the one surface it was built for.

## The Matching Matrix

✓ = a real, verified code path reads this signal for this surface. — = confirmed not read.
"?" = plausible but not independently verified this pass (flagged, not claimed).

| Signal | Dating | Friends | Gatherings | Communities | Businesses | Tier |
|---|---|---|---|---|---|---|
| Interest/category overlap | ✓ (`compatibilityScore`'s interest Jaccard term) | ✓ (`shared_interest_count`) | ✓ (`SCORE_INTEREST_MATCH = 5`) | ✓ (`intentResolver.js`'s community branch, same shared axis) | ✓ (`business_requests.category` match) | **Strong** everywhere it applies |
| Distance | ✓ (`proximity.js` wide-area bucketing) | ✓ (tiebreak sort, `distance_bucket` display) | ✓ (`SCORE_CLOSE_DISTANCE = 3` + hard radius tier) | — (communities aren't geo-scoped the same way; not independently re-verified this pass) | ✓ (hard `radius_miles` cutoff, then reliability-weighted fan-out) | **Strong** (Gatherings/Businesses), **Soft** (Friends, tiebreak only) |
| Own network (already a friend/match/community-member independently asking) | — | N/A (this IS the friend-finding surface) | ✓ (`SCORE_OWN_NETWORK = 6`, Tier 2 connected-requests) | ✓ (membership itself is the connection) | ✓ (Tier 2 connected-request signal feeds the resolver's business-availability branch too) | **Strong**, highest weight in the shared axis |
| Mutual friends | — (shown post-match on `ViewProfileScreen` as a display line, not a matching input) | ✓ (`mutual_friend_count`, real scoring term) | — | — | — | **Strong** (Friends only); display-only elsewhere |
| Relationship intent (`relationship_intention`) | ✓ (real hard filter, `intentionFilter`) | — | — | — | — | **Hard** (when the filter is active) |
| Show Me / gender preference | ✓ (`passesGenderMatch()`, real hard gate) | — | — | — | — | **Hard** |
| Age range | ✓ (real hard filter, `proximity.js`) | — | — | — | — | **Hard** |
| 24 Basics experience-preference fields | ✓ (premium-only real hard filter) | — | — | — | — | **Hard** (dating only, premium-gated) |
| `price_level` (new) | — | — | — (filter only, see Real Finding 2) | — | — | **None** — exists, unused for matching |
| `party_type` (new) | — | — | — (filter only, see Real Finding 2) | — | — | **None** — exists, unused for matching |
| `beginner_friendly` | — | — | ✓ (`getGatheringFitReasons()` scoring) | — | — | **Strong** (Gatherings only) |
| Indoor/Outdoor (`CATEGORY_INDOOR_OUTDOOR`) | — | — | ✓ (Home's weather-suggestion card only — not the resolver's own scoring, a separate surface) | — | — | **Contextual** — tied to a live weather read, not a standing preference |
| Weather (current conditions) | — | — | ✓ (indoor-suggestion card) | — | — | **Contextual** |
| `women_only` | — | — | ✓ (real hard eligibility gate, `join_gathering()`) | — | — | **Hard** |
| `visibility` (everyone/friends/community/invite_only) | — | — | ✓ (real hard gate, `getNearbyGatherings()` server-side) | N/A | — | **Hard** |
| Party size / capacity | — | — | ✓ (`gatherings.capacity`, real waitlist gate) | — | ✓ (`business_fulfillment_policies.party_size_min/max`, real hard eligibility) | **Hard** |
| Budget | — | — | — | — | ✓ (`business_requests.budget_min/max`, part of the real matching request) | **Hard/Strong** (part of the matched-request shape) |
| Time window / date | — (no date-shaped filter on Dating at all) | — | ✓ (`matchesDateFilter()`, filter only, not scored) | — | ✓ (`time_window_start/end`, real matching input) | **Hard** (Businesses); **filter-only, unscored** (Gatherings) |
| Business attributes (cuisine, ambiance, date-friendly, outdoor seating) | N/A | N/A | N/A | N/A | **does not exist anywhere in the schema** | **N/A — real structural gap, see Phase 4** |
| Availability (user's own free-time schedule) | **does not exist anywhere** | **does not exist anywhere** | **does not exist anywhere** | **does not exist anywhere** | **does not exist anywhere** | **N/A — real structural gap, confirmed in Phase 2** |

## Open items carried into Phase 5 (synthesis)

1. Whether `price_level`/`party_type` should be wired into `intentResolver.js`'s gathering
   scoring — the most concrete, smallest "close a real gap" recommendation this audit can make,
   since the fields, the filter UI, and the scoring axis they'd plug into all already exist.
2. Whether Friends' scoring formula should ever get any user-facing control — a real product
   decision, not a bug, flagged for the recommendations list.
3. The business-attribute gap (Real Finding 3) is large enough that it's its own dedicated
   phase (4) rather than folded fully in here.
