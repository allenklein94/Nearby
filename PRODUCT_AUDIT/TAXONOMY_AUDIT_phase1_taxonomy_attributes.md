# Phase 1 — Master Taxonomy + Master Attributes inventory

Part of the "Nearby Universal Taxonomy, Filters & Matching Audit" (see CLAUDE.md, top section).
Read-only research — no code was changed to produce this file. Every row below is grep-verified
against the real current source, not assumed.

## Real findings (the concrete, non-obvious things)

1. **Two full generations of gender-identity/gender-preference infrastructure coexist on
   `profiles`, collected on two different screens, with no UI cross-link.** Legacy single-select
   pair — `discovery_gender` (4 values, `DISCOVERY_GENDER_OPTIONS`) / `show_me` (3 values,
   `SHOW_ME_OPTIONS`) — is collected on `SettingsScreen.js`'s "Discovery Preferences" section and
   `DatingPreferencesPromptModal.js`. New multi-select pair — `gender_identity` / `interested_in_
   genders` (both drawing from the same 9-value `GENDER_IDENTITY_OPTIONS`) — is collected only on
   `ProfileScreen.js`'s identity-editing section. `services/proximity.js`'s `passesGenderMatch()`
   has a real, working, deliberate fallback (`bothHaveNewFields` — use the new richer fields only
   when *both* parties have filled them in, else fall back to the legacy pair) — this is not a
   bug, the matching logic is correct either way. But the **UX itself is fragmented**: a user
   filling in `gender_identity`/`interested_in_genders` on Profile has no indication anywhere
   that Settings' separate "Discovery Preferences" screen holds a second, narrower, potentially
   stale answer to the same underlying question, and vice versa. This is exactly the kind of
   "same concept, two independently-evolved representations" gap the audit was asked to find.
2. **`relationship_intention` (Settings/Profile, 5-value `INTENTION_OPTIONS`: serious/casual/
   friends/marriage/unsure) and `basics.relationship_goals` (Basics form, a *different* 5-value
   list: "Long-term partner"/"Long-term, open to short"/"Short-term fun"/"New friends"/"Still
   figuring it out") both answer "what am I looking for, relationship-wise" — but are two
   structurally unrelated fields, never cross-validated, with genuinely different downstream
   jobs: `relationship_intention` is a real upfront filter (`DiscoveryScreen.js`'s
   `intentionFilter`) and a gate for whether "dating preferences" count as set
   (`20260828_progressive_settings_phase3.sql`); `basics.relationship_goals` is read only by
   `services/compatibility.js` to build a post-match "what you have in common" report — never a
   filter, never influences who gets shown to whom. A user could set contradictory answers in
   the two places and nothing would ever reconcile or even flag it.
3. **`gatheringIndoorOutdoor.js`'s own header comment is now stale**: it says "a real
   categorization of the 25 canonical `interest_tag` values," but the canonical list
   (`gatheringCategories.js`) is now 26 (the taxonomy pass earlier today added "Dating"). Not a
   functional bug — `Dating` was deliberately never added to `CATEGORY_INDOOR_OUTDOOR` (a date
   can honestly be either), so the map itself is still correct — but the comment's own count is
   wrong and should say 26 with a note that Dating is deliberately excluded.
4. **The canonical gathering-category taxonomy (`gatheringCategories.js`) is genuinely
   consolidated and clean** — 26 tags, one file, 6+ real consumer screens, a documented,
   deliberate exception for `ProfileScreen`/`CompleteProfileScreen`'s own personal-interest
   picker. This is the one part of the whole taxonomy landscape that's already in the state the
   rest of the audit is trying to get everything else to.
5. **Business categories (`BUSINESS_CATEGORIES`, 6 broad industry buckets) and the gathering/
   activity taxonomy (26 tags) are deliberately different granularities that never meet** — a
   business is `food_drink`/`fitness_wellness`/etc.; nothing on `brand_partners` says "Italian"
   or "outdoor seating" or "date-friendly." This is the real gap Phase 4 of this audit (Business
   Category/Attribute Audit) is specifically scoped to confirm in depth — flagged here as the
   headline reason "Dating + Italian + outdoor" (the external message's own example) is currently
   unrepresentable anywhere in this schema.
6. **`ETHNICITY_OPTIONS` is a genuinely clean, single-source, no-duplication case** — one file,
   used identically by both `DiscoveryScreen.js` (as a filter/preference) and `SettingsScreen.js`
   (as the editor). No finding here beyond confirming it's fine.
7. **Community "categories" are fully unified with gatherings' own taxonomy** — `CreateCommunityScreen.js`
   has no local category list at all; it imports `INTEREST_OPTIONS` from the same canonical
   `gatheringCategories.js` file every gathering-shaped screen uses. No finding.
8. **CORRECTED (Phase 2 caught this factual error in the original Phase 1 draft — left visible
   rather than silently fixed, per this file's own "don't rewrite history" convention): `BASICS_
   FIELDS` (39 fields) is used in BOTH places, not just the post-match report.** It backs
   `compatibility.js`'s post-match "what you have in common" narrative (`BIG_TOPIC_KEYS`) — that
   part of the original finding was correct — **but every `type: 'select'` field in
   `BASICS_FIELDS` (24 of the 39 — height/living_in/school/job_title/languages_spoken/five_year_
   vision/dream_location/skill_to_learn/holiday_traditions/cultural_background are free-text, the
   rest are `select`) is ALSO a real, live, premium-gated hard filter on `DiscoveryScreen.js`**
   (`DISCOVERY_FILTER_FIELDS = [...BASICS_FIELDS.filter(f => f.type === 'select'), ethnicity]`,
   wired into `filteredNearby`'s own filter chain as a hard include/exclude — `if (!personValue
   || !selectedOptions.includes(personValue)) return false`). So `drinking`/`smoking`/`workout`/
   `social_energy`/`weekend_style`/`religion`/`zodiac`/etc. are already real dating-discovery
   filters today, not just narrative — this app already does more of what the external audit
   doc's own "attribute layer" ask wants than a surface read would suggest. What's still real and
   worth flagging: these are premium-only, dating-only (never read by Friend Discovery, Things to
   Do, or Gatherings matching), and always a hard filter (include/exclude), never a soft scored
   boost — see Phase 3's Matching Matrix for whether that's the right shape everywhere it could
   apply, or just for dating specifically.

## Master Taxonomy

| List | File:line | Values (count) | Real consumers | Verdict |
|---|---|---|---|---|
| `INTEREST_OPTIONS` (gathering/community/business-request category) | `src/constants/gatheringCategories.js:24` | 26: Travel, Coffee, Hiking, Music, Movies, Foodie, Fitness, Reading, Art, Gaming, Photography, Yoga, Dancing, Cooking, Wine, Dogs, Cats, Outdoors, Sports, Concerts, Museums, Volunteering, Meditation, Running, Faith & Spirituality, Dating | `GatheringsScreen.js`, `CreateGatheringScreen.js`, `QuickPicksEditModal.js`, `AskBusinessScreen.js` (re-exported as `CATEGORY_OPTIONS`), `CreateCommunityScreen.js`, `BusinessDashboardScreen.js` (re-exported as `AVAILABILITY_CATEGORY_OPTIONS`) | **Canonical, clean.** Single source of truth, 6+ real consumers, already fully consolidated as of today's taxonomy pass. |
| `CATEGORY_GROUPS` (6 super-groups over the 26 tags) | `src/constants/gatheringCategories.js:34` | Active, Social, Entertainment, Lifestyle, Community, Dating (6 groups, every tag in exactly one) | `GatheringsScreen.js`, `CreateGatheringScreen.js` | **Canonical, clean.** |
| `CATEGORY_STYLES` (icon+color per tag) | `src/constants/gatheringCategoryStyles.js:14` | Same 26 keys as `INTEREST_OPTIONS` | Every screen rendering a category chip/badge (`categoryStyleFor()`) | **Canonical, clean.** In lockstep with `INTEREST_OPTIONS` (Dating was added to both in the same pass). |
| `CATEGORY_COVER_PHOTOS` | `src/constants/gatheringCoverPhotos.js:178` | 23 of the 26 tags (missing: Dating, Faith & Spirituality, and — check — Faith & Spirituality is explicitly, deliberately unsourced per its own comment) | `GatheringDetailScreen.js`, gathering cards | **Intentional partial coverage**, explicitly documented — no fabricated/mismatched photo, honest icon/color fallback for the 3 missing tags. |
| `QUICK_PICK_ICON_BY_CATEGORY` | `src/constants/quickPickIcons.js:565` | 25 of the 26 tags (missing: Dating — added same day as the icon file predates today's Dating tag) | `HomeScreen.js` Quick Picks row | **Real, small, current drift** — Dating has no Ionicons entry yet, silently falls back to the generic `DEFAULT_ICON` ('star-outline') via `iconNameForCategory()`. Low severity (a real fallback exists, nothing breaks) but is the newest instance of the exact "new tag added to the canonical list, one of several per-tag lookup maps not updated" pattern this file's own history has already caught and fixed once (`CATEGORY_STYLES` for `AskBusinessScreen.js`). |
| `CATEGORY_INDOOR_OUTDOOR` | `src/constants/gatheringIndoorOutdoor.js:14` | 14 indoor + 4 outdoor of the 26 tags; 8 deliberately unclassified (Travel, Music, Fitness, Photography, Sports, Concerts, Volunteering) + Dating (deliberately excluded, not counted among the "8 ambiguous," see below) | `HomeScreen.js` weather-suggestion card, `GatheringsScreen.js`'s Environment filter | **Intentional partial coverage, but stale header comment** (says "25 canonical," should say 26; should also explicitly name Dating as deliberately excluded, the way it already names the 7 ambiguous ones). |
| `CATEGORY_OPTIONS` — personal interests (profile) | `src/screens/CompleteProfileScreen.js:33` | A separate, independently-typed 25-tag list (need to re-verify it now matches the 25 non-Dating canonical tags exactly, or has its own drift — see Open Question 1 below) | `CompleteProfileScreen.js`'s interests step | **Intentional & distinct, per CLAUDE.md's own documented decision**: "what am I into" (identity) vs. "what kind of event is this" (activity) are different semantics; Dating deliberately excluded as a personal-interest tag. Real risk: this is a *second, independently-maintained copy* of (most of) the same 25 tags — any future edit to the canonical list (e.g. adding tag #27) has no mechanism forcing this copy to stay in sync, the same shape of gap that caused the original `AskBusinessScreen.js` "Faith & Spirituality" drift. |
| `BUSINESS_CATEGORIES` | `src/screens/BusinessPartnerApplyScreen.js` | 6: food_drink, fitness_wellness, retail_shopping, arts_entertainment, professional_services, other | `BusinessPartnerApplyScreen.js`, `BusinessDashboardScreen.js`'s profile editor, `RequestBusinessPartnerScreen.js` filter chips | **Intentional & distinct** — a genuinely different granularity (broad industry) than the 26-tag activity taxonomy. See Master Attributes / Finding 5 for the real gap this creates. |
| `PLACE_CATEGORIES` | `src/screens/DiscoverHubScreen.js:35` | 4: coffee, restaurants, parks, hubs | `DiscoverHubScreen.js`'s Places section, tied to Google Places' own `type` search parameter | **Intentional & distinct** — not this app's own vocabulary at all, a thin wrapper over Google's API surface. Not comparable to the other lists. |
| `DISCOVERY_GENDER_OPTIONS` / `SHOW_ME_OPTIONS` | `src/constants/discoveryOptions.js:9-10` | 4 / 3 | `SettingsScreen.js`, `DatingPreferencesPromptModal.js` | **Real, live, parallel-system finding — see Real Finding 1.** Legacy single-select gender pair, still fully collected today alongside the newer multi-select pair below. |
| `GENDER_IDENTITY_OPTIONS` | `src/constants/genderOptions.js` | 9: Man, Woman, Non-binary, Trans man, Trans woman, Genderfluid, Agender, Other, Prefer not to say | `ProfileScreen.js` (used twice — once for `gender_identity`, once for `interested_in_genders`) | **Real, live, parallel-system finding — see Real Finding 1.** Newer multi-select gender pair. |
| `INTENTION_OPTIONS` | `src/constants/intentionOptions.js` | 5: serious, casual, friends, marriage, unsure (backs `profiles.relationship_intention`) | `SettingsScreen.js`, `ViewProfileScreen.js`, `DiscoveryScreen.js` (real filter), `proximity.js` | **Real, live overlap with `basics.relationship_goals` — see Real Finding 2.** |
| `relationship_goals` (inside `BASICS_FIELDS`) | `src/constants/basicsFields.js:10` | 5: Long-term partner, Long-term open to short, Short-term fun, New friends, Still figuring it out | `compatibility.js` only (post-match report) | **Real, live overlap with `relationship_intention` — see Real Finding 2.** |
| `ETHNICITY_OPTIONS` | `src/constants/ethnicityOptions.js` | 10 | `DiscoveryScreen.js` (filter/preference), `SettingsScreen.js` (editor) | **Clean, no duplication.** |
| `OFFER_TYPE_OPTIONS` (business offer type) | `src/screens/BusinessDashboardScreen.js:34` | 5: standard, discount, perk, upgrade, alt_time | Business offer creation + availability posting UI; backed by real `business_request_offers_offer_type_check`/`business_availability_offer_type_check` CHECK constraints | **Clean, single source, no duplication found.** A different axis entirely (deal shape, not activity category). |

## Master Attributes

Non-category, attribute-shaped fields — real signals about *what kind of experience* something
is, distinct from *what it is* (category).

| Attribute | File:line / column | Values | Real consumers | Verdict |
|---|---|---|---|---|
| Indoor/Outdoor | `gatherings.interest_tag` derived via `CATEGORY_INDOOR_OUTDOOR` (no stored column — computed) | indoor / outdoor / unclassified | `HomeScreen.js` weather card, `GatheringsScreen.js` Environment filter | Real, honest, conservative (see Master Taxonomy row above for the stale-comment finding). |
| `price_level` | `gatherings.price_level` (added today's taxonomy pass) | null, free, $, $$, $$$ | `CreateGatheringScreen.js` (set), `GatheringsScreen.js` Price filter | New, real, host-declared. Not yet read by any matching/ranking signal — purely a visible-list filter today (see Phase 3, Matching Matrix, for whether that's a gap). |
| `party_type` | `gatherings.party_type` (added today's taxonomy pass) | null, solo, friends, groups, date | `CreateGatheringScreen.js` (set), `GatheringsScreen.js` People filter | Same as above — new, real, host-declared, filter-only so far. |
| `beginner_friendly` | `gatherings.beginner_friendly` | boolean, default true | Gathering detail "fit reasons" scoring (`getGatheringFitReasons()`) | Real, already a scored signal (not just a filter) — the one attribute in this list that's already fully wired end-to-end. |
| `energy_level` / `conversation_level` / `group_size_feel` | `gatherings.*` | 1-5 numeric scale each | `CreateGatheringScreen.js`'s "Vibe" step, `GatheringDetailScreen.js`'s "What to Expect" display | Real, host-declared "felt vibe" attributes — confirmed (per CLAUDE.md's own taxonomy-pass text) deliberately NOT reused to derive `party_type`, since they measure something different. Not currently read by any filter or matching signal — display-only today. |
| `women_only` | `gatherings.women_only` | boolean | `CreateGatheringScreen.js`, join-eligibility enforcement (`join_gathering()` RPC) | Real, a genuine hard constraint (enforced server-side, not just a filter) — the one attribute in this table that's a true hard gate, not a soft signal. |
| `visibility` | `gatherings.visibility` | everyone, friends, community, invite_only | `CreateGatheringScreen.js`'s Who step, `getNearbyGatherings()`'s server-side filter | Real, a genuine hard constraint (who can even see/join the gathering) — distinct from `is_public` (auto-join vs. host-approval), a second, different axis that shares a similar name-shape but is NOT the same concept. Worth flagging as a real naming-adjacency risk: `visibility` (who can see it) and `is_public` (does joining need approval) are two different booleans/enums that a future dev could easily conflate. |
| `is_public` | `gatherings.is_public` | boolean | Join-flow branching (auto-approve vs. pending) | See above — real, distinct from `visibility`, correctly implemented today but a real naming/conceptual-adjacency risk for future confusion. |

9. **RESOLVED, real live bug found (Open Question 1 below, since confirmed): `ProfileScreen.js`
   and `CompleteProfileScreen.js` each keep their own independently-typed, byte-identical
   24-tag personal-interest `INTEREST_OPTIONS` copy — and both are missing "Faith &
   Spirituality," the exact same value that was already found and fixed once for
   `AskBusinessScreen.js`'s old copy earlier today.** Confirmed directly: `ProfileScreen.js:27-32`
   and `CompleteProfileScreen.js:33-38` are two separate local `const INTEREST_OPTIONS = [...]`
   declarations, neither importing from `gatheringCategories.js`, both listing the identical 24
   tags (Travel through Running, no Faith & Spirituality, correctly no Dating). **This is a real,
   live product bug, not a design choice**: a user picking their own personal interests during
   onboarding or from Profile has literally no way to select "Faith & Spirituality" as a personal
   interest, even though it's a fully real, first-class tag everywhere else in the app (gathering
   category, community category, business-request category). The *decision* to keep personal
   interests as a separate semantic axis from gathering categories (documented in
   `gatheringCategories.js`'s own header comment) is correct and intentional — but that decision
   was never followed through into "so build ONE shared personal-interest list," and having *two*
   independently-typed copies of even that separate list is exactly the drift-prone pattern this
   whole audit exists to catch. The fix, if picked up: one new shared constant (e.g.
   `PERSONAL_INTEREST_OPTIONS` in a new or existing constants file, 25 tags — the 26 canonical
   minus Dating, matching the documented reasoning exactly), imported by both screens instead of
   each keeping its own copy — the same fix shape already proven out for `AskBusinessScreen.js`
   earlier today.

## Open questions carried into later phases (not resolved here)

1. Whether unifying the legacy (`discovery_gender`/`show_me`) and new (`gender_identity`/
   `interested_in_genders`) gender fields into one screen/editing surface is worth doing, given
   the matching logic itself already handles the coexistence correctly — a UX consolidation
   question, not a functional bug, flagged for the final recommendations list.
