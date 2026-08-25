# Nearby Universal Taxonomy, Filters & Matching Audit
### 2026-08-24 — read-only audit, no application code changed

This is a self-contained document — everything a reviewer needs is in this file, no other
context required. It's the consolidated output of a 5-phase read-only audit run against the
real, current Nearby codebase (React Native/Expo client, Supabase/Postgres backend), prompted by
a direct question: **before adding more categories/filters, does Nearby have one consistent
taxonomy/preference/matching language across its whole product, or five independently-evolved
ones?**

**Method**: every claim in this document was verified directly against the real source code
and/or live production database (project `enmosvippabmuqslzrox`) — file:line citations, real
grep results, real `information_schema.columns` queries, real function bodies pulled via the
Supabase Management API. Nothing here is inferred from an external description of what the app
"should" have; every finding traces to something actually read in this pass.

**Scope boundary**: read-only. No schema was changed, no migration written, no client code
edited, to produce this audit. Every finding below is a recommendation for a future, separately
authorized pass — not something acted on unilaterally here.

---

## Executive summary

Nearby is **further along toward "one taxonomy" than a fresh read might assume** — the core
activity/category vocabulary (26 tags, one file, `gatheringCategories.js`) is genuinely
consolidated across 6+ screens as of a same-day pass that fixed exactly this kind of drift once
already. But the audit found **real, live, previously-uncaught instances of the exact problem
it was designed to find**, and one large structural absence:

1. **A real, live product bug**: `ProfileScreen.js` and `CompleteProfileScreen.js` each keep
   their own independently-typed 24-tag personal-interest list, and *both* are missing "Faith &
   Spirituality" — the identical value already found and fixed once today for a different
   screen's own copy of a related list. A user cannot select this as a personal interest
   anywhere in the app, even though it's a fully real tag everywhere else.
2. **Two full generations of gender-identity infrastructure coexist**, collected on two
   different screens, with a correct-but-silent matching-layer fallback and no UI connecting
   them for the user.
3. **Two unrelated vocabularies both answer "what am I looking for, relationship-wise"**
   (`relationship_intention` vs. `basics.relationship_goals`), never reconciled.
4. **Several real user preferences exist and are filterable but are invisible to every
   matching/ranking engine** — most notably the brand-new `price_level`/`party_type` fields,
   confirmed end-to-end (client filter → resolver scoring function) to have zero effect on what
   gets ranked or recommended.
5. **The single largest structural gap**: businesses have no attribute dimension anywhere in
   the schema — category + price + party-size + time-window only. "Italian + outdoor +
   date-friendly" matching, the exact scenario a taxonomy-consolidation effort would want to
   enable, is completely unrepresentable today, not partially.
6. **Friend Discovery has real, honest, weighted scoring and zero user-facing control over any
   of it** — the one surface in the app where a user can't see or influence why they're being
   shown who they're shown.
7. **No "when am I available" preference exists anywhere** — every time-shaped signal in this
   app describes an event, never the user's own free time.

None of these are catastrophic — nothing is broken for a real user today in a way that produces
a visibly wrong result (the one exception is the missing "Faith & Spirituality" personal-interest
option, which is a genuine, user-facing capability gap). Most of what's below is exactly what the
requesting message asked for: a map of where the taxonomy/preference/filter/matching language is
already unified, where it's quietly forked, and where a real signal exists but goes nowhere.

---

## Part 1 — Master Taxonomy

Every category/tag list in the app, what it contains, who reads it, and whether it's genuinely
distinct from its neighbors or accidentally drifting from one.

| List | Location | Values | Consumers | Verdict |
|---|---|---|---|---|
| `INTEREST_OPTIONS` — gathering/community/business-request category | `src/constants/gatheringCategories.js:24` | 26 tags (Travel, Coffee, Hiking, Music, Movies, Foodie, Fitness, Reading, Art, Gaming, Photography, Yoga, Dancing, Cooking, Wine, Dogs, Cats, Outdoors, Sports, Concerts, Museums, Volunteering, Meditation, Running, Faith & Spirituality, Dating) | `GatheringsScreen`, `CreateGatheringScreen`, `QuickPicksEditModal`, `AskBusinessScreen` (re-exported `CATEGORY_OPTIONS`), `CreateCommunityScreen`, `BusinessDashboardScreen` (re-exported `AVAILABILITY_CATEGORY_OPTIONS`) | **Canonical, clean.** Single source, 6+ real consumers, already consolidated same-day. |
| `CATEGORY_GROUPS` — 6 super-groups over the 26 tags | `gatheringCategories.js:34` | Active, Social, Entertainment, Lifestyle, Community, Dating | Same screens as above | **Canonical, clean.** |
| `CATEGORY_STYLES` — icon+color per tag | `gatheringCategoryStyles.js:14` | Same 26 keys | Every category chip/badge via `categoryStyleFor()` | **Canonical, clean**, in lockstep with `INTEREST_OPTIONS`. |
| `CATEGORY_COVER_PHOTOS` | `gatheringCoverPhotos.js:178` | 23 of 26 tags | Gathering hero images | **Intentional partial coverage**, explicitly documented, honest icon/color fallback for the 3 missing. |
| `QUICK_PICK_ICON_BY_CATEGORY` | `quickPickIcons.js:565` | 25 of 26 tags — **missing Dating** | `HomeScreen` Quick Picks | **Real, small, current drift.** Dating silently falls back to a generic star icon. Low severity, real fallback exists, but is the newest instance of the "new tag added, one of several per-tag lookup maps not updated" pattern. |
| `CATEGORY_INDOOR_OUTDOOR` | `gatheringIndoorOutdoor.js:14` | 14 indoor + 4 outdoor + 8 deliberately unclassified (of the pre-Dating 25) | `HomeScreen` weather card, `GatheringsScreen` Environment filter | **Intentional partial coverage, but a stale header comment** — says "25 canonical," should say 26 with Dating named as deliberately excluded. |
| Personal-interest picker (2 independent copies) | `ProfileScreen.js:27-32` **and** `CompleteProfileScreen.js:33-38` | Both: 24 tags, **missing Faith & Spirituality**, correctly missing Dating | `ProfileScreen`'s and `CompleteProfileScreen`'s own interest steps | **REAL LIVE BUG.** Two byte-identical, independently-typed copies of what should be one list — neither imports from `gatheringCategories.js`. The *decision* to keep personal interests semantically separate from gathering categories is correct and documented; having two hand-maintained copies of even that separate list is the exact drift the taxonomy pass already fixed once, recurring uncaught. **A user cannot select "Faith & Spirituality" as a personal interest anywhere in the app.** |
| `BUSINESS_CATEGORIES` | `BusinessPartnerApplyScreen.js` | 6: food_drink, fitness_wellness, retail_shopping, arts_entertainment, professional_services, other | Business apply/edit/filter screens | **Intentional & distinct** — a genuinely different granularity. See Part 4 for the real gap this creates. |
| `PLACE_CATEGORIES` | `DiscoverHubScreen.js:35` | 4: coffee, restaurants, parks, hubs | Discover's Places section (Google Places `type` param) | **Intentional & distinct** — a thin wrapper over Google's own API, not this app's vocabulary. |
| `DISCOVERY_GENDER_OPTIONS` / `SHOW_ME_OPTIONS` | `discoveryOptions.js:9-10` | 4 / 3 (legacy single-select) | `SettingsScreen`, `DatingPreferencesPromptModal` | **Parallel-system finding** — see Part 2, Finding G1. |
| `GENDER_IDENTITY_OPTIONS` | `genderOptions.js` | 9 (new multi-select, used for both identity and interest) | `ProfileScreen` only | **Parallel-system finding** — see Part 2, Finding G1. |
| `INTENTION_OPTIONS` (`relationship_intention`) | `intentionOptions.js` | 5: serious, casual, friends, marriage, unsure | Settings, `ViewProfileScreen`, `DiscoveryScreen` (real filter), `proximity.js` | **Overlap finding** — see Part 2, Finding G2. |
| `relationship_goals` (inside `BASICS_FIELDS`) | `basicsFields.js:10` | 5, a different wording: Long-term partner / Long-term open to short / Short-term fun / New friends / Still figuring it out | `compatibility.js` only | **Overlap finding** — see Part 2, Finding G2. |
| `ETHNICITY_OPTIONS` | `ethnicityOptions.js` | 10 | `DiscoveryScreen`, `SettingsScreen` | **Clean, no duplication.** |
| `OFFER_TYPE_OPTIONS` (business offer type) | `BusinessDashboardScreen.js:34` | 5: standard, discount, perk, upgrade, alt_time | Business offer/availability creation, backed by matching CHECK constraints | **Clean, single source.** A different axis (deal shape), not a category duplicate. |
| Community categories | — | N/A | `CreateCommunityScreen.js` | **Fully unified** — imports `INTEREST_OPTIONS` directly, no local copy at all. |

---

## Part 2 — Master Attributes

Non-category, attribute-shaped fields — signals about *what kind of experience* something is,
distinct from *what it is*.

| Attribute | Location | Values | Real consumers | Verdict |
|---|---|---|---|---|
| Indoor/Outdoor | Derived (`CATEGORY_INDOOR_OUTDOOR`), not stored | indoor / outdoor / unclassified | `HomeScreen` weather card, `GatheringsScreen` Environment filter | Real, honest, deliberately conservative. Stale comment noted above. |
| `price_level` (new) | `gatherings.price_level` | null, free, $, $$, $$$ | `CreateGatheringScreen` (set), `GatheringsScreen` Price filter | Real, host-declared. **Not read by any matching/ranking function** — see Part 5, Matching Matrix. |
| `party_type` (new) | `gatherings.party_type` | null, solo, friends, groups, date | `CreateGatheringScreen` (set), `GatheringsScreen` People filter | Same — real, filter-only. |
| `beginner_friendly` | `gatherings.beginner_friendly` | boolean | Gathering "fit reasons" scoring | Real, already a scored signal — the one attribute fully wired end-to-end. |
| `energy_level` / `conversation_level` / `group_size_feel` | `gatherings.*` | 1-5 scale each | Vibe display only | Real, host-declared, deliberately not reused to derive `party_type`. Display-only, not a filter or matching input. |
| `women_only` | `gatherings.women_only` | boolean | `join_gathering()` RPC — real hard eligibility gate | Real, a true hard constraint, server-enforced. |
| `visibility` | `gatherings.visibility` | everyone/friends/community/invite_only | `getNearbyGatherings()` server-side filter | Real hard constraint. Naming-adjacent to `is_public` (a different axis — auto-join vs. host-approval) — a real future-confusion risk, not a current bug. |
| `is_public` | `gatherings.is_public` | boolean | Join-flow branching | See above. |

### Finding: `BASICS_FIELDS` is dual-purpose, not single-purpose (a correction made mid-audit)

`BASICS_FIELDS` (39 fields on `profiles.basics`, a jsonb blob — height, diet, religion, zodiac,
love language, financial priority, social energy, weekend style, family plans, drinking,
smoking, workout, etc.) was initially mis-read in this audit's own first draft as
"post-match narrative only." **Corrected**: every `type: 'select'` field in `BASICS_FIELDS` (24
of 39 — the rest are free-text) is *also* a real, live, **premium-gated hard filter** on
`DiscoveryScreen.js` (`DISCOVERY_FILTER_FIELDS = [...BASICS_FIELDS.filter(f => f.type ===
'select'), ethnicity]`, wired into the actual candidate-filtering chain as a hard include/
exclude). So Nearby already has a real, substantial attribute-filtering layer — it's just scoped
entirely to Dating, premium-only, and always a hard filter, never a soft scored boost.

---

## Part 3 — Master User Preferences

Every question the app asks a user about *themselves*, classified into the buckets: Identity /
Intent / Interests / Experience preferences / Logistics / Relationship preferences /
Availability.

| Bucket | Field | Store | Collected on | Also editable on |
|---|---|---|---|---|
| Identity | Display name, bio, birthdate, photos | `profiles.*` | `CompleteProfileScreen` | `ProfileScreen` |
| Identity | Gender identity | `profiles.gender_identity` | — | `ProfileScreen` only |
| Identity | Pronouns, ethnicity, gender_hidden, ethnicity_hidden | `profiles.*` | — | `ProfileScreen` |
| Intent | Relationship intention | `profiles.relationship_intention` | Settings "Looking For" | `DatingPreferencesPromptModal` (first-open) |
| Intent | Open to Friend Discovery | `profiles.open_to_friend_discovery` | Friend Discovery's own toggle | — |
| Intent | "Who's this gathering for" | `gatherings.party_type` | `CreateGatheringScreen` | — (per-event, not a standing personal preference — borderline case) |
| Interests | Personal interests | `profiles.interests` | `CompleteProfileScreen` | `ProfileScreen`, `QuickPicksEditModal` |
| Experience preferences | 26 `BASICS_FIELDS` select fields | `profiles.basics->>'<key>'` | Not fully traced which screen first collects these | `ProfileScreen`'s Basics editor |
| Logistics | Distance radius/tier (dating & gatherings, independently) | Local component state, **not persisted** | `DiscoveryScreen`, `GatheringsScreen` | — |
| Logistics | Notifications | `profiles.notify_*` | Settings "Notifications" | — |
| Logistics | Language | app-level | Settings "Preferences" | — |
| Relationship preferences | Show Me / Discovery Gender (legacy) | `profiles.show_me` / `discovery_gender` | Settings "Discovery Preferences" | `DatingPreferencesPromptModal` |
| Relationship preferences | Interested-in genders (new) | `profiles.interested_in_genders` | — | `ProfileScreen` only |
| Relationship preferences | Age range | `preferred_min_age`/`max_age` | Settings | `DatingPreferencesPromptModal` |
| Relationship preferences | Ethnicity preferences | `profiles.ethnicity_preferences` | Settings | — |
| **Availability** | — | **none found anywhere** | — | — |

**Minor labeling note**: Settings' "Preferences" group conflates two genuinely different kinds
of preference under one header — "Looking For"/"Discovery Preferences" (both dating-specific
matching signals) sit directly next to "Appearance"/"Language" (pure app-behavior settings, not
about matching at all). Not wrong, just means "Preferences" means two different things depending
on which card is open — a minor UX note, not a functional finding.

### Finding G1 — two generations of gender infrastructure, no UI cross-link

Legacy single-select pair (`discovery_gender`/`show_me`, Settings + the dating-prefs first-open
modal) and a newer, richer multi-select pair (`gender_identity`/`interested_in_genders`, Profile
only) coexist. `services/proximity.js`'s `passesGenderMatch()` has a real, correct fallback: use
the new fields only when *both* parties in a candidate pair have filled them in, else fall back
to the legacy pair — **the matching logic itself is not broken**. What's fragmented is the UX: a
user editing one pair has no indication the other, semantically-overlapping pair exists
elsewhere, on a different screen, possibly holding a stale answer.

### Finding G2 — two unrelated "what am I looking for, relationship-wise" vocabularies

`relationship_intention` (serious/casual/friends/marriage/unsure) is a real, live, upfront
Discovery filter and a gate for whether "dating preferences" count as set at all. `basics.
relationship_goals` (Long-term partner/Long-term open to short/Short-term fun/New friends/Still
figuring it out) is read only by the post-match compatibility-report generator. Both questions
are, in plain English, the same question — asked twice, in two unrelated vocabularies, never
cross-validated. A user could answer them contradictorily and nothing would ever notice.

### Finding G3 — no Availability preference exists anywhere

Every time-shaped signal in the app (the "When" gathering filter, "Right Now"/"Starting Soon",
`time_window_start/end` on a business request) describes *an event's* timing. Nothing anywhere
represents *the user's own* free time/weekly schedule as a preference.

---

## Part 4 — Master Filters

filter | screen | data source | user-facing? | used by matching? | used by ranking?

| Filter | Screen | Data source | User-facing | Used by matching | Used by ranking |
|---|---|---|---|---|---|
| Distance (Local/Wide tier) | `GatheringsScreen` | `getNearbyGatherings(radiusTier)` | Yes | Yes — real server-side radius gate | No |
| When (incl. new "Starting Soon") | `GatheringsScreen` | `matchesDateFilter()`, client-side | Yes | No — client-only visible-list narrower | No |
| Category (grouped) | `GatheringsScreen` | `interest_tag` | Yes | Partially — the separate "For You" toggle is a real re-sort, the plain chips are filter-only | Only via "For You" |
| Environment (Indoor/Outdoor) | `GatheringsScreen` | `CATEGORY_INDOOR_OUTDOOR` | Yes | No | No |
| **Price (new)** | `GatheringsScreen` | `gatherings.price_level` | Yes | **No** | No |
| **People (new)** | `GatheringsScreen` | `gatherings.party_type` | Yes | **No** | No |
| For You | `GatheringsScreen` | `getMyTopGatheringCategories()` (derived) | Yes | N/A — is itself the signal | Yes |
| Trending | `GatheringsScreen` | `get_trending_gathering_ids` RPC | Yes | N/A | Filter only |
| Type filter (Gatherings/Communities/Places/Perks) | `DiscoverHubScreen` | client-side section toggle | Yes | No | No |
| Place category | `DiscoverHubScreen` | Google Places `type` | Yes | N/A (external API) | N/A |
| Category, party size, budget, date window, radius | `AskBusinessScreen` | `business_requests.*` on submit | Yes | **Yes — all five**, real matching RPC inputs | Yes — reliability-weighted fan-out |
| Show Me | `DiscoveryScreen` | legacy + new gender fields | Yes | Yes — `passesGenderMatch()` | No |
| Age range | `DiscoveryScreen` (premium) | `preferred_min/max_age` | Yes | Yes — real hard filter | No |
| Verified / High compat / Online only | `DiscoveryScreen` quick filters | `photo_verified`, `compatibilityScore`, presence | Yes | N/A — the filters ARE matching-adjacent signals | No |
| Relationship intention | `DiscoveryScreen` | `relationship_intention` | Yes | Yes | No |
| 24 Basics-derived filters | `DiscoveryScreen` (premium) | `profiles.basics->>'<key>'` | Yes | Yes — real hard filter | No |
| Ethnicity | `DiscoveryScreen` (premium) | `profiles.ethnicity` | Yes | Yes | No |
| — | `FriendDiscoveryScreen` | — | **No filters exist at all** | Server-side, opaque (see Part 5) | Server-side, opaque |

### The one clean pattern worth naming

Every filter that's also a real matching/ranking signal shares one property: **it was submitted
as part of a request/profile row the server actually reads back** (Ask a Business's five fields;
Dating's Show-Me/age/basics filters — all columns the matching logic also selects). Every filter
that's *only* a client-side visible-list narrower (When, Environment, both brand-new Price/
People filters, Discover's Type/Place filters) narrows a list that was already fetched — it
never round-trips into anything scored. **`price_level`/`party_type` are the freshest instance
of this pattern** — new, filterable, and currently invisible to the one resolver
(`intentResolver.js`) that already scores every other gathering-side signal for the exact same
candidate rows.

**Also worth noting**: `GatheringsScreen.js`'s "For You"/"Trending" toggles are a real, separate
signal axis from the 6-section filter accordion — `forYouActive` re-sorts by the caller's own
derived category history (`getMyTopGatheringCategories()`), `trendingActive` filters by a real
`get_trending_gathering_ids` RPC. Neither is persisted as a standing user preference — both reset
to `false` on remount, a deliberate session-scoped design, not a bug, but it means "For You" can
never become a durable "always show me my favorite categories first" setting without a schema
change.

---

## Part 5 — The Matching Matrix

Columns are Nearby's real 5 recommendation surfaces — **Dating**, **Friends** (Friend
Discovery), **Gatherings**, **Communities**, **Businesses**. There is no merged "People"
surface in this app; Dating and Friends are two deliberately separate matching engines under one
Discover tab, a locked, repeatedly-reaffirmed product decision — not an oversight to fix here.

**Tiers**: Hard (real eligibility gate) / Strong (meaningfully-weighted scored boost) / Soft
(small scored boost or tiebreak) / Contextual (temporary, situational — weather/time, not a
standing preference).

| Signal | Dating | Friends | Gatherings | Communities | Businesses | Tier |
|---|---|---|---|---|---|---|
| Interest/category overlap | ✓ (compatibility score) | ✓ (`shared_interest_count`) | ✓ (`SCORE_INTEREST_MATCH=5`) | ✓ (same shared axis) | ✓ (category match) | **Strong** |
| Distance | ✓ (wide-area bucket) | ✓ (tiebreak sort) | ✓ (`SCORE_CLOSE_DISTANCE=3` + hard radius) | — (not re-verified) | ✓ (hard radius cutoff + reliability fan-out) | Strong (Gatherings/Businesses), Soft (Friends) |
| Own network (already-connected people independently asking) | — | N/A | ✓ (`SCORE_OWN_NETWORK=6`) | ✓ (membership IS the connection) | ✓ (Tier 2 connected-request signal) | **Strong**, highest weight |
| Mutual friends | — (display-only) | ✓ (`mutual_friend_count`, real scoring term) | — | — | — | Strong (Friends only) |
| Relationship intent | ✓ (real hard filter) | — | — | — | — | **Hard** |
| Show Me / gender | ✓ (`passesGenderMatch()`) | — | — | — | — | **Hard** |
| Age range | ✓ | — | — | — | — | **Hard** |
| 24 Basics experience fields | ✓ (premium hard filter) | — | — | — | — | **Hard** (Dating only) |
| `price_level` (new) | — | — | — (filter only) | — | — | **None — unused for matching anywhere** |
| `party_type` (new) | — | — | — (filter only) | — | — | **None — unused for matching anywhere** |
| `beginner_friendly` | — | — | ✓ (fit-reasons scoring) | — | — | Strong (Gatherings) |
| Indoor/Outdoor | — | — | ✓ (weather card only) | — | — | **Contextual** |
| Weather | — | — | ✓ (indoor-suggestion card) | — | — | **Contextual** |
| `women_only` | — | — | ✓ (real hard gate) | — | — | **Hard** |
| `visibility` | — | — | ✓ (server-side hard gate) | N/A | — | **Hard** |
| Party size/capacity | — | — | ✓ (waitlist gate) | — | ✓ (fulfillment-policy hard eligibility) | **Hard** |
| Budget | — | — | — | — | ✓ (part of the matched request) | Hard/Strong |
| Time window | — (no dating date-filter exists) | — | ✓ (filter, **unscored**) | — | ✓ (real matching input) | Hard (Businesses), filter-only (Gatherings) |
| Business attributes (cuisine, ambiance, date-friendly, outdoor seating) | N/A | N/A | N/A | N/A | **does not exist in the schema** | **N/A — see Part 6** |
| Availability (user's own free time) | **does not exist** | **does not exist** | **does not exist** | **does not exist** | **does not exist** | **N/A — see Part 3, Finding G3** |

**Note on Dating's `compatibilityScore`**: this is the one place in the app that collapses
several real signals (interest Jaccard overlap + `basics` field overlap + shared music artists)
into a single displayed percentage, hard-filterable at ≥70. It's fully inspectable/reproducible
client-side (not an opaque LLM call), consistent with this app's own standing "no black-box
blended score" rule — but it *is* the closest thing to a cross-signal "match score" concept the
audit found, worth naming explicitly since a future pass extending this pattern to other
surfaces should stay just as inspectable.

**Note on Friend Discovery**: `get_friend_discovery_candidates` (read directly from the live
database) genuinely scores `shared_interest_count + shared_community_count +
mutual_friend_count`, distance as tiebreak — real, honest, explainable. The finding isn't that
the scoring is bad; it's that **zero of it is visible or adjustable to the user**, unlike every
other surface in this table.

---

## Part 6 — Business Category/Attribute Audit

**The single largest structural finding of this whole audit.** Confirmed directly against live
production's real column lists (`information_schema.columns`, not client code):

- **`brand_partners`**: `id, name, logo_url, description, active, created_at, latitude,
  longitude, address, tier, category, stripe_*, reservation_provider*`. One category-shaped
  column (`category`, the 6-value industry enum). **No cuisine, no ambiance, no price tier, no
  "outdoor seating"/"date-friendly"/"group-friendly"/"live music" field of any kind.**
- **`business_requests`**: category + party_size + budget_min/max + date + time_window +
  location/radius. Same shape.
- **`business_availability`**: category + title/description + offer_type + price + capacity.
  Same shape.
- **`business_fulfillment_policies`**: party-size bounds, active hours, spend/discount rules,
  cancellation window. Real logistics, still no attribute dimension.

**Net effect**: "Dating + Italian food + live music" being matched to "Italian restaurant +
outdoor seating + romantic + 1.2 miles away" — the worked example that motivated this whole
audit — **cannot happen at any layer today.** The category match (`Foodie`/`food_drink`) is the
entire available signal; "Italian," "outdoor seating," and "date-friendly" have nowhere to live
on either side of a match.

**This is not a bug** — nothing is broken, no feature silently fails. It's a confirmed absence,
consistent with how narrowly every business-fulfillment migration in this app's history was
scoped (each added exactly what its own immediate feature needed, never a general attribute
system).

**A real fix, sized honestly, not designed in full here**: (1) a small, curated
`brand_partners.attributes text[]` tag set, CHECK-constrained to a deliberately small vocabulary
(outdoor_seating, date_friendly, group_friendly, live_music, kid_friendly, quiet, casual,
upscale), mirroring this app's own established "small curated enum, not a free-text tag cloud"
convention (the exact shape `party_type`/`price_level` already used). (2) A genuine cuisine
sub-category, scoped to `food_drink` businesses only — not a general sub-category system for all
6 industries, since only food/drink has an obvious, well-known further subdivision users would
expect to filter by. Both pieces would need to reach `intentResolver.js`'s business branches and
the matching RPCs to be more than decorative, per Part 4's own "filter that never round-trips
into a matching signal is cosmetic" finding.

---

## Part 7 — Persona walkthrough

Real navigation/query paths, traced against the actual code (not a simulator run — this
sandbox has never had one), checking at each step: is the same preference represented
consistently; does changing it actually change results; is anything asked for twice; is
anything collected but never used; does this read as one product.

### Person A — wants friends

`ProfileScreen`/`CompleteProfileScreen` (personal interests — hits the missing-Faith-&-
Spirituality bug from Part 1) → Discover tab → People mode → Friends toggle →
`FriendDiscoveryScreen` (zero filters, a real but opaque server-side score) → swipe → match →
Messages.

**Findings on this path**: the interest data collected at the very first step (personal
interests) does genuinely feed the ranking three steps later (`shared_interest_count`) — a real,
working cross-screen signal flow, one of the few in the app. But the user has no visibility into
that fact, and no way to adjust anything about how they're being ranked once inside Friend
Discovery — the richest filter surface in the app (Dating's) and the thinnest (Friends') sit one
tab-toggle apart from each other with no shared vocabulary presented to the user at all.

### Person B — wants dating

`ProfileScreen` (identity, `gender_identity`/`interested_in_genders`) + Settings (`relationship_
intention`, legacy `discovery_gender`/`show_me`, age range) → Discover → People mode → Dating
toggle → `DiscoveryScreen` (rich filters: Show Me, age, 24 Basics fields, ethnicity,
compatibility ≥70) → match → `DateProposalScreen` → `AskBusinessScreen` (real business request,
category/party-size/budget/date/radius all genuinely feed the matching RPCs) → a real business
offer.

**Findings on this path**: this is the single most "one product" path in the app — data
collected at the identity/preference stage genuinely and verifiably reaches the matching engine,
and the business-request stage at the end is the one place a filter and a matching signal are
provably the same object. The real friction: reaching a complete dating profile means visiting
*two* separate screens (Profile for gender identity, Settings for intention/show-me/age) whose
overlap (Finding G1) is invisible to the user filling either one in.

### Person C — wants activities

`ProfileScreen` (personal interests) → Home's intent box or Discover browse → `GatheringsScreen`
(6-section accordion: Distance/When/Category/Environment/Price/People) → tap a gathering, or
`CreateGatheringScreen` (grouped category picker, Price/People chip rows, Publish preview) →
attend/host → optionally "Ask Local Businesses" → `AskBusinessScreen`.

**Findings on this path**: the two brand-new filters (Price, People) are the freshest
demonstration of the audit's central finding — they render, they narrow the visible list
correctly, and then contribute nothing to any ranking anywhere, including the Home intent box's
own resolver, which already scores every *other* signal for the identical candidate rows. A user
who filters Gatherings by "$" and "Solo-Friendly" today gets a correctly-narrowed list; a user
who *types* "cheap solo activity" into Home's intent box gets zero benefit from either field
existing, even though the underlying data is right there.

### Person D — business owner

`BusinessPartnerApplyScreen` (apply, 6-value `BUSINESS_CATEGORIES`) → admin approval →
`BusinessDashboardScreen` (offer creation: the now-consolidated 26-tag category list, 5-value
`OFFER_TYPE_OPTIONS`, price) → post a `business_availability` → discoverable via
`intentResolver.js`'s business-availability branch, and via inbound `business_requests` fan-out.

**Findings on this path**: the business owner's own category picker is now correctly pointed at
the same canonical 26-tag list every consumer-facing category picker uses (fixed in today's
earlier taxonomy pass) — genuinely consistent terminology end-to-end on the category axis. What's
missing is everything Part 6 already covers: there is no way for this business owner to say
"we're Italian" or "we have outdoor seating" or "we're a good date spot," so none of that ever
reaches a consumer no matter how precisely the consumer describes what they want.

---

## Ranked recommendations

Findings only — nothing here was built or fixed in this pass. Ordered by a rough
impact-to-effort read, not by phase number.

1. **Fix the personal-interest list duplication** (Part 1) — the smallest, highest-certainty fix
   in this whole audit. One new shared `PERSONAL_INTEREST_OPTIONS` constant (25 tags, the
   canonical 26 minus Dating), imported by both `ProfileScreen.js` and `CompleteProfileScreen.js`
   instead of each keeping its own copy. Closes a real, live capability gap (users can't pick
   "Faith & Spirituality" as a personal interest) using the exact fix shape already proven out
   for `AskBusinessScreen.js` earlier the same day.
2. **Wire `price_level`/`party_type` into `intentResolver.js`'s gathering-scoring branch** (Parts
   2, 4, 5) — the fields, the filter UI, and the scoring axis they'd plug into all already exist;
   this closes the freshest instance of the "filter with no matching-engine equivalent" pattern
   with no new schema needed.
3. **Add the missing "Dating" icon to `QUICK_PICK_ICON_BY_CATEGORY`** and **update
   `gatheringIndoorOutdoor.js`'s stale header comment** (Part 1) — trivial, low-risk, closes two
   small current-drift items.
4. **Design a real, small business-attribute layer** (Part 6) — the largest structural gap
   found. Sized deliberately small (a curated tag set + a `food_drink`-only cuisine sub-category,
   not a general attribute system for all 6 industries), but this is real schema/RPC work, not a
   quick fix — needs its own scoped build pass.
5. **Give Friend Discovery at least minimal user-facing filter/preference control** (Parts 2, 5)
   — real product decision (what should be adjustable, and whether that changes the "no
   stranger-discovery, opaque-is-safer" posture this surface has today), not a mechanical fix.
6. **Decide whether to reconcile `relationship_intention` and `basics.relationship_goals`, and
   whether to unify the legacy/new gender-field pairs into one editing surface** (Part 3,
   Findings G1/G2) — both are real UX consolidation questions with a working-but-fragmented
   matching layer underneath; neither is an active bug, both are candidates for a future
   Settings/Profile-consolidation pass in the same spirit as CLAUDE.md's own prior IA-restructure
   work.
7. **Decide whether an Availability preference is worth building at all** (Part 3, Finding G3) —
   genuinely absent, but this app's whole framing is "what's happening right now," so this may be
   a deliberate non-goal rather than a gap — flagged as an open question, not a recommendation to
   build.

---

*End of consolidated audit. This is the single, self-contained file — the 4 separate per-phase
working files this was originally assembled from have been folded in and removed; every real
finding from all 4 phases is captured above, with file:line detail preserved. This file is the
one intended for external review.*
