# Nearby — Project Instructions

Nearby is a proximity-based dating/social discovery app (React Native/Expo, Supabase backend).
Supabase project ref: `enmosvippabmuqslzrox`. A Management API access token lives in
`.claude/mcp.json` (gitignored) — used via direct `curl` against
`https://api.supabase.com/v1/projects/enmosvippabmuqslzrox/database/query` for schema
inspection/migration application, since the Supabase MCP server itself has not been reliably
available via ToolSearch in past sessions.

## Read this first — why this file looks different now (2026-09-17)

This file used to grow without bound: every session appended its full build log, verification
trail, and reasoning to the end, forever. By 2026-09-17 it had reached **29,860 lines / 2.46MB**
— reloaded in full at the start of every session as project instructions. Two sessions in a row
spent their entire budget on compaction of that giant file and made no forward progress on the
actual work (Phases 4-6 of the "Business Web as an Operating System" plan, since closed out —
see `CLAUDE_HISTORY.md`).

**The fix**: the complete, unedited historical record — every past session's full build log,
every audit, every locked design decision with its full original reasoning and verification
detail — was moved byte-for-byte to **`CLAUDE_HISTORY.md`**. Nothing was deleted or summarized
away; it's just not auto-loaded every session anymore. This file (`CLAUDE.md`) now holds only:
standing conventions that remain in force, and whatever's currently active/unfinished.

**When to open `CLAUDE_HISTORY.md`**: only when you genuinely need the detailed reasoning or
live-verification trail behind why some already-shipped feature works the way it does, or a full
account of a specific past session someone asks about by date. It's organized reverse-
chronologically (most recent work first) with clear dated section headers — grep for a date or
feature name rather than reading start to end. For everyday work, including picking up the
active items below, this file should be enough. Don't open the history file "just in case" —
that's exactly the habit that caused the problem this split exists to fix.

**Standing rule going forward, so this doesn't happen again**: keep this file short — a few
hundred lines, not tens of thousands. When a plan/phase finishes: (1) append the full verbose
build/verification account to the *top* of `CLAUDE_HISTORY.md` (most-recent-first), (2) replace
whatever was in this file's "Active / unfinished work" section for that plan with either nothing
(if fully done) or a short status line, (3) fold any newly-locked standing convention into the
"Standing Conventions" section below as a single bullet, not a narrative. Do not let this file
grow past a few hundred lines without doing this split again.

## Active / unfinished work

**Thursday plan item 26 (consistent "escape hatch" — never dead-end a search) — fully DONE
(2026-09-11).** An audit of every genuine "searched/browsed and found nothing, no path forward"
moment beyond item 25's own sweep. Most surfaces already had a real escape hatch, some predating
this session: `DiscoverHubScreen.js`'s unified search already routes a true "nothing matched
anywhere" search through `classifyCreateRequest()` into a real Create It flow (`nothingMatchedAnywhere`,
built 2026-08-27); `GatheringsScreen.js`'s search-empty state already offers a prefilled "Start a
[term] Gathering" (item 25 batch 2); `CommunitiesScreen.js` has no free-text search to dead-end on
at all; Home's ask-box and `CreateHubScreen.js`'s "With businesses" row already cover the
business-request escape hatch (items 4/20). Two real gaps found, both in Places (a Google-
Places-backed browse — a place can't be "created" the way a gathering/community can, so the right
escape hatch is asking businesses directly, not creating supply): `DiscoverHubScreen.js`'s
embedded Places section and the dedicated `PlacesScreen.js`'s "Nothing found nearby" state both
gained an "Ask Nearby Businesses →" action into `AskBusinessScreen`, free-text prefill only
(`PLACE_CATEGORIES` and `AskBusinessScreen`'s own leaf-tag category chips are deliberately
separate vocabularies — see `placeCategories.js`'s header comment — so this never silently
pre-selects a chip that might not actually match); `PlacesScreen.js`'s location-denied state had
no action at all (a hard dead end), fixed with a real "Enable Location →" button re-running the
screen's own existing permission flow. Full suite 258/258 passing; both touched files
transform-checked clean. Not exercised in a running app (no simulator/device tooling this
session, standing note). Commit: `3f197cd5`.

**Thursday plan item 25 (empty states need real next-actions) — fully DONE (2026-09-11).** An
audit fork inventoried the app's empty states; four batches closed every real gap it found across
the highest-visibility surfaces:
- **Batch 1** (`61cf05db`) — People/Matches/Friends: `DiscoveryScreen.js`'s browse-filtered/
  crossed-paths-filtered/first-visit empty states merged into one `renderPeopleEmptyState()` with
  real Adjust Filters/Invite Friends/Adjust Preferences actions; `FriendDiscoveryScreen.js` got a
  real Clear Filters action; `FriendDiscoverySwipeCards.js` got Invite Friends;
  `MatchesScreen.js` got Explore Things To Do + Invite Friends; `FriendsScreen.js` got a direct
  Meet New People action and its "no circles yet" modal now opens the real New Circle modal
  instead of pointing back at the screen it's already on.
- **Batch 2** (`56ded70b`) — Discover/Communities/Gatherings: `DiscoverHubScreen.js`'s category
  drill-down and all 4 unified-search empty states got real actions, including a genuine new
  `enableLocation()` (`requestForegroundPermissionsAsync` — `loadCore()` previously only ever
  checked existing permission, never prompted); `CommunitiesScreen.js` got a real Create a
  Community button; fixed a real bug in `GatheringsScreen.js` where the Nearby tab's "+ Start a
  Gathering" button was wrongly gated on a search/filter being set and so never rendered for the
  true first-visit empty state its own copy promised it to.
- **Batch 3** (`2ae744ae`) — `ActivityScreen.js`'s "Nothing new yet" got Explore Things To Do +
  Discover People actions (`notices.emptyText` checked and confirmed an orphaned, uncalled
  translation key — nothing to fix there).
- **Batch 4** (`ab06cf16`) — `BusinessDashboardScreen.js`: most of the 10 flagged empty states
  already sat beside a real always-visible action button, or are genuinely passive received-not-
  created displays (requests inbox, aggregated demand, offer performance, insights, missed/
  declined history) where forcing a CTA would be a fabricated action — left as honest empty
  states per this repo's no-fabricated-signals convention. Two were real gaps; fixing them
  surfaced a real pre-existing bug — both copy blocks promised "create one from the Create tab
  and it'll show up here," but `getMyBusinessGatherings()`/`communities.js` scope this section to
  `hosting_partner_id` = this business, and no create flow anywhere in the codebase
  (`CreateGatheringScreen.js`, `CreateCommunityScreen.js`) ever sets that column — the promise was
  already false. Softened the copy to drop the unfulfillable claim and pointed the new action at a
  real destination instead; wiring an actual business-hosted create path is flagged in-code as a
  separate, bigger feature, not silently built.

Full suite 258/258 passing throughout; every touched file transform-checked clean under
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note).

**"Thursday plan" (external UX critique items 18-24, "one connected system" objective) — fully
DONE (2026-09-11).** User's overarching ask: Nearby should feel like one connected system
(Discover → find people → decide to do it → create a plan → connect a business/place → go do
it), not a collection of separate screens. Two research forks audited the actual current state
against all 7 items before any code changed — most of it was already built from prior sessions;
only real, concrete gaps got code changes:
- **#18** (unified Discover hierarchy: What are you looking for? → Things to Do | People → sub-
  tabs, filters as content not navigation) — **already fully built**, no code needed.
  `DiscoverHubScreen.js`'s `mode`/`peopleSubMode` are in-screen state, not routes; Things-To-Do's
  category drill-down is the Phase 8 "expand in place" mechanism, also not navigation.
  `StoriesRow.js` confirmed gone (per the 2026-09-10 Discover UX cleanup).
- **#19** (filters should sit as a layer over results, never a navigation destination) — mostly
  already true (`FiltersModal` was already a real in-place modal). One real gap: the deeper
  `QuickFilterCustomize` screen it links to was a full stack push. Fixed:
  `presentation: 'modal'` in `RootNavigator.js`.
- **#20** (Create as Discover's inverse, same taxonomy powering both) — mostly already true
  (`CreateHubScreen.js` already mirrors Discover's own framing and sources `CREATE_HUB_OPTIONS`/
  `SUB_OPTIONS` from the same `INTEREST_OPTIONS` taxonomy). One real gap: no path to
  `AskBusinessScreen` (the "post a request, any business can respond" flow, distinct from the
  Phase 7 "Request a Business Partner" affiliate flow deliberately removed from this screen
  earlier) — it was only ever reachable *from* an existing gathering/community/match/Home-ask
  context. Added a "With businesses" row, navigated with no params (a genuinely blank ask).
- **#21** ("Plan" should exist everywhere it logically can) — mostly already true
  (`ViewProfileScreen`/`GatheringDetailScreen`/`BusinessProfileScreen` all already have a real
  Plan-type CTA reusing the same planning engine, `dateProposals.js`). One real gap:
  `MatchCelebrationModal` (shown right after a new match) offered only Message/dismiss. Added a
  "Plan Together" button routing to the same Together-menu destination the match row's own
  "🤝 Plan" button already uses.
- **#22** (business as the natural endpoint of Person + Intent → Activity → Place, not a separate
  ad section) — **already satisfied** by prior work: the intent resolver's `business_availability`
  results, Experience Bundles, and `DateProposalScreen`'s "Find something nearby" search (item 4)
  already implement exactly this flow; Discover's own Perks section is woven into the same
  unified results list, not a separate sponsored unit. No code change needed.
- **#23** (every recommendation should explain WHY) — real, confirmed gap on two of four
  surfaces. Gatherings and Friends discovery already had real reason text (`getGatheringFitReasons`,
  `FriendDiscoverySwipeCards`'s `sharedBits`). Fixed: `SwipeableDiscoveryCards.js` (dating swipe
  deck, plain Browse mode) now shows the same tappable compatibility "Why?" badge + shared-
  interests line the list view (`DiscoveryScreen.js`) already had, reusing the same already-
  computed `item.compatibilityScore`/`item.sharedInterests` fields. `business_availability`
  intent results (and the Experience Bundles/components that reuse the same candidate objects)
  had zero why-reasoning at all — new `getBusinessAvailabilityReasons()`
  (`intentResolverScoring.js`) mirrors each existing scoring bonus's own exact condition
  (category/subcategory/secondary-category, distance, cuisine, attribute, party-type, occasion)
  and surfaces real text for whichever ones actually fired, appended to the existing title/price
  subtitle. New Jest coverage.
- **#24** (social proof honesty — never display a count not calculated from verified underlying
  relationships) — the specific bug the user remembered ("said 3 when there was only 1") was
  **already fixed** in a prior session: `homeDashboard.js`'s `friendsActivity` dedupes by
  `host_id` before capping at 3, with an explicit code comment naming this exact failure mode. No
  other fabricated/stale social-proof count found in the surfaces checked (not exhaustive —
  community screens, `FriendsScreen`/`MatchesScreen` copy, and all push-notification bodies
  weren't individually re-checked this session).

Full suite 258/258 passing throughout; every touched file transform-checked clean under
`babel-preset-expo`. Not exercised in a running app (no simulator/device tooling this session,
standing note). Commits: `1cad107d` (19/21/23-dating), `3678bfb3` (23-business), `2ccd3e39` (20).

**"This matches you" recommendation push notifications, external UX critique item 17 — fully
DONE (2026-09-11).** Real push notifications for gatherings/communities and business postings
that genuinely match a user's own declared interests, with real controls (on/off, frequency,
categories, distance, time preferences) — not the two dangling "honest placeholder" toggles
(`notify_things_to_do`/`notify_nearby_opportunities`, added 2026-09-13 with zero real trigger)
they were before. Scoped down to 3 concrete architecture decisions via `AskUserQuestion` before
building (all confirmed by direct user answer): (1) reuse the existing background-presence
pipeline's coarse last-known location rather than add any new location capability — and a real
finding *during* that research made this free: `presence_reports` (user_id pk, area, reported_at,
upserted by `report-presence`) already existed as exactly that table, RLS-enabled with zero
policies (confirmed live), so no new table/Edge Function/permission was needed at all; (2)
real-time pushes, capped per day, not a daily digest; (3) a simple Anytime/Evenings & Weekends
time control, not a custom quiet-hours picker. Shipped: `20261004_recommended_for_you_push.sql`
— 8 new profile preference columns (frequency/categories/max-distance/time-pref × 2 categories),
a new `recommendation_push_log` table (frequency-cap tracking, RLS enabled/zero policies,
internal only), and two real `AFTER INSERT` triggers (`notify_matching_things_to_do()` on
`gatherings`, `notify_matching_business_availability()` on `business_availability`) matching on
real interest overlap (`profiles.interests`), real distance (haversine against the presence
table, respecting both the user's own preference and — for business postings — the posting's own
stated `radius_miles`), and real time-of-day/day-of-week checks against the row's own
`scheduled_at`/`starts_at`. Only ever considers `visibility = 'everyone'` gatherings (a
friends/invite-only/community-scoped gathering is not general discoverable supply — pushing it to
an arbitrary interest-matched stranger would violate this app's own no-stranger-discovery rule).
Verified live via a comprehensive disposable rolled-back transaction against production covering
all 8 real cases (genuine match fires; wrong interest/too far/stale presence/private-visibility
all correctly suppressed; the frequency cap holds a user at exactly 3 for `few_per_day`; a
business's own linked profile is never pushed about its own posting) before applying for real —
confirmed live afterward (triggers, all 8 new columns, `recommendation_push_log` all present).
Client, original shape: a standalone `RecommendationPreferencesScreen.js`, reached via a new
"⚙️ Frequency, categories, distance & time" link under each of the two existing Settings toggles.
**Refactored same day (2026-09-11), direct user pushback**: a whole navigation destination for 4
rows of controls fought this app's own "fewer screens, contextual disclosure" direction (the
Progressive Depth doctrine in Standing Conventions below). The screen is gone; its content is now
`src/components/RecommendationCustomizePanel.js`, an inline expand-in-place panel rendered
directly under each Settings toggle's own "Customize" link (local `expandedRecPanel` state in
`SettingsScreen.js`, no navigation). Same columns/behavior, same "categories = only your own
already-declared interests" scoping — purely a presentation change, not a data-model change.
`notifications.js` routes both new push types (`recommended_gathering` → `GatheringDetail`;
`recommended_business_availability` → the Discover tab, since no per-posting consumer detail
screen exists yet). Deliberately NOT
built, disclosed rather than silently skipped: the "3 people nearby are planning X" social-proof
copy variant from the user's own example — a brand-new gathering has zero attendees at the moment
its own INSERT trigger fires, so that needs its own separate trigger on `gathering_interest`
INSERT checking a real attendee-count threshold crossed (mirroring the existing
`notify_group_intent_threshold()` shape) — a real, distinct fast-follow. Full Jest suite 252/252
passing; a direct `@babel/core` + `babel-preset-expo` transform check passed clean on all four
touched/new client files. Not exercised in a running app (no simulator/device tooling this
session, standing note).

**"Build Something Bigger" section, external UX critique item 16 — fully DONE (2026-09-11).**
`CreateHubScreen.js`'s "Want to build something bigger?" section used to promise more than its
one real button ("Create a Community") delivered. Per direct user pick (via `AskUserQuestion`,
two rounds — first the overall approach, then the exact label for the new button): added a
second, genuinely distinct entry point, "🔁 Start a Weekly Meetup," which deep-links into
`CreateGathering` with `quickStartRecurring: true` — pre-selects "Repeats: Weekly" (and
pre-expands the "More options" section that setting lives in, so it's visibly selected rather
than silently sitting collapsed) while leaving the "What" step un-skipped and every field fully
editable, same "prefill but confirm" shape every other quick-pick path on this screen already
uses. Deliberately did NOT add "Host an Event" (redundant — the icon grid above this section
already does exactly that) or "Become a Local Organizer" (no organizer role/dashboard/workflow
exists anywhere in this codebase — would have been a fabricated feature). Deliberately did NOT
label the new button "Start a Community" despite that being the user's first instinct — it
creates a recurring *gathering* (`gatherings.recurring_series_id`), never a `communities` row,
and labeling it "Start a Community" right next to the real "Create a Community" button (a
genuinely different entity) would have had two adjacent buttons both saying "community" produce
two different kinds of thing. Full Jest suite 252/252 passing; a direct `@babel/core` +
`babel-preset-expo` transform check passed clean on both touched files
(`CreateHubScreen.js`, `CreateGatheringScreen.js`). Not exercised in a running app (no simulator/
device tooling this session, standing note).

**Taxonomy-aware search — fully DONE (2026-09-11).** Closed a real gap: `searchGatherings()`/
`searchPublicCommunities()`/`search_offer_ids()` used to only match title/description (name/
description for communities), completely blind to `interest_tag`/`target_interest_tag` — a
gathering tagged `Yoga` titled "Morning Stretch Session" was invisible to a search for "yoga."
All three now also ILIKE the tag column, merged client-side same as the existing columns. New
trigram GIN indexes (`20261003_taxonomy_aware_search.sql`) on all three tag columns, same
precedent as `20260809_indexed_text_search.sql`. Verified live: function body, all 3 indexes, and
`pg_trgm` extension all confirmed present in production via the Management API. Full Jest suite
252/252 passing. Full detail: `CLAUDE_HISTORY.md`, search "Taxonomy-aware search."

**"Things To Do needs a UX pass" — external UX critique item 14 — fully DONE (2026-09-11).**
`DiscoverHubScreen.js`'s default "All" Things-to-Do landing view (the one item 14 was about) no
longer shows a single quick-date-chip toggle silently reshaping one flat "Recommended For You"
list underneath it. It now shows four real, always-visible, consistently positioned sections in
the order the critique asked for — Happening Now (a small horizontal set), Today, This Weekend,
Categories — answering "where do I want to go / what do I want to do / when do I want to do it?"
directly instead of via a wall of independent tiles. All three time sections reuse the exact same
real date-bucket logic already earmarked for this in `utils/gatheringDateFilter.js`'s own header
comment (`matchesDateFilter`, the identical logic the dedicated Gatherings screen's own "When"
filter uses) and the same fit-scoring/hero-tiering already built (`getGatheringFitReasons`,
`HERO_SCORE`/`STANDARD_SCORE`, extracted into a shared `renderGatheringTile()` so the tile
treatment isn't tripled); each tier excludes whatever a more-urgent tier already showed so nothing
repeats. Categories is a real browse row over this codebase's own single canonical 19-group
taxonomy (`CATEGORY_GROUPS`, `constants/gatheringCategories.js`) — no invented list — reusing the
existing Phase 8 "expand in place" mechanism (generalized: `expandedContext` now supports a whole
category's tags, not just one gathering's own tag+time-bucket). The dedicated "Gatherings" tab and
the search-results view are both untouched (their own prior flat-list/notable-gatherings behavior
preserved exactly) — this only reshapes the default landing view. Full Jest suite 252/252 passing;
a `@babel/core` + `babel-preset-expo` transform check passed on the touched file. Not exercised in
a running app (no simulator/device tooling this session, standing note).

**Discover UX cleanup items 8 & 9 — fully DONE (2026-09-10)**, external UX critique reply. Item 8:
the People tab's separate Stories row is gone; the signal now lives on each candidate's own avatar
(a colored ring in `DiscoveryScreen.js`/`SwipeableDiscoveryCards.js`/`FriendDiscoverySwipeCards.js`,
tapping it opens the story directly, tapping the card body always opens the profile), and "post a
story" moved to a small camera icon in the People header (`DiscoverHubScreen.js`). `StoriesRow.js`
deleted outright. Item 9: user explicitly chose "leave as-is" for both open questions (no Age/
Intent/Lifestyle consolidation into Quick Filters; no distance filter for Dating) — no code
changed. Full locked design + build detail: `CLAUDE_HISTORY.md`, search "Discover UX cleanup items
8 & 9". Not exercised in a running app (no simulator/device tooling this session, standing note) —
full Jest suite (252/252) and a babel-transform syntax check on every touched file both pass.

**"Plan" means a real place, not a generic toolbox — fully DONE (2026-09-10)**, external UX
critique reply item 4. DB migration (`20261001_plan_something_real_supply.sql`) and all client
work (`dateProposals.js`, `DateProposalScreen.js`) shipped: proposing a plan now offers a real "🔎
Find something nearby" search over live business availability before the invite is sent, and
accepting a plan with a chosen place auto-creates the bound business request instead of requiring
a second manual step. Full build/verification detail: `CLAUDE_HISTORY.md`, search `"Plan" means a
real place`. Not exercised in a running app (no simulator/device tooling this session, standing
note) — full Jest suite (252/252) and a direct babel-transform syntax check both pass.

**Unified Crossed Paths across Dating and Friends — fully DONE (2026-09-10).** ONE Crossed Paths
mechanism shared by Dating and Friends, preferring real shared-past-gathering attendance
("You were both at {title} · {time}") over a proximity sighting when both are real for a pair,
never blending the two. New `get_shared_gathering_partners()` RPC
(`20260930_shared_gathering_crossed_paths.sql`, applied and functionally verified live via
disposable rolled-back transactions) and new `src/services/crossedPathsSignals.js` (pure
merge/format/filter functions, 16 Jest tests, full suite 252/252). `proximity.js`'s
`getNearbyMatches()` and the new `friendDiscovery.js`'s `getFriendCrossedPaths()` both source from
the merged sightings+gatherings union; `FriendDiscoveryScreen.js` gained a Browse | Crossed Paths
mode switch it previously lacked entirely. Fixed a real fabricated-signal bug found during this
work: `SwipeableDiscoveryCards.js` used to show "📍 Within about 35 feet" unconditionally even for
Browse-mode data with no real proximity signal. **Not exercised against a live authenticated
session** (no simulator/device available this session, per this repo's standing note) — if
something looks wrong in the running app, check `getNearbyMatches()`/`getFriendCrossedPaths()`
first. Full locked design, research, and build/verification detail: `CLAUDE_HISTORY.md`, search
"Unified Crossed Paths."

**Category/place/business taxonomy expansion (19 groups/75 tags) — fully DONE (2026-09-06),
picked up mid-stream after a codespace restart and shipped this session, then extended same-day
per direct user follow-up.** Gathering/community categories (`gatheringCategories.js`), Places
browsing (`placeCategories.js`, new), and business categories (`BusinessPartnerApplyScreen.js`,
`businessCategoryClassifier.js`) all now share one 19-category taxonomy (was 6 groups/26 tags for
gatherings, a separate 5-vertical list for business; first pass landed 15 groups/63 tags, then a
same-day follow-up added Stay & Getaway/Health & Personal Care/Education & Classes/Attractions &
Things to See). `brand_partners.category`/`business_partner_requests.category` widened via two
migrations (`20260922_business_category_taxonomy_expansion.sql`,
`20260923_business_category_taxonomy_v2_new_majors.sql`), both verified live. Found and fixed 3
real bugs left by the interrupted prior session that would have broken production on arrival: the
first migration's `update_business_profile()` rewrite targeted a stale 8-arg signature instead of
the real live 11-arg one; three Edge Functions (`submit-business-application`,
`screen-business-content`, `business-onboarding-assistant`) still validated/suggested against the
old 6-value list; a couple of smaller stale references (a Google-type-to-category guess table, a
dead import, a stale migration-filename comment, two literal old values in a disposable
live-verify script). Full build/verification detail: `CLAUDE_HISTORY.md`, search "Category/place/
business taxonomy expansion." `docs/business/` regenerated and recommitted twice
(BusinessDashboardScreen imports from a changed file).

**Standing direction, partially built**: the user's stated product vision (saved to memory,
`project_intent_engine_vision`) is that this taxonomy should power a free-text intent engine
underneath Discover's existing "what do you want to do?" ask box (`intentResolver.js`), never
become the app's primary category-picker navigation. **First increment of layer 4 (occasion)
shipped 2026-09-06**: create-assistant's already-extracted `occasion` (birthday/anniversary/
date_night/celebration/casual_hangout/business_meal/family_gathering) now threads through
`resolveIntent()` → `resolveBusinessAvailability()` → new `occasionBonus()` in
`intentResolverScoring.js`, scored against a business's own real `brand_partners
.priority_occasions` (flat bonus, never a filter, same shape as the existing attribute/cuisine/
party-type bonuses). `search_active_business_availability()` migration
(`20260924_business_availability_priority_occasions.sql`) adds `priority_occasions` to its return
columns — verified live. The same extracted occasion now also genuinely prefills
AskBusinessScreen's existing occasion chips end to end (Home → AskBusiness →
BusinessRequestDetail), fully visible/editable, never silently committed. **First increment of layer 2 (subcategory) also shipped 2026-09-06**, per direct user pick when
asked which piece to build next: a business's own durable self-classification
(`brand_partners.subcategory` / `business_partner_requests.subcategory`, both new columns) can
now hold a finer, real leaf-tag value under whichever major `category` the business already
picked — reuses `gatheringCategories.js`'s existing ~75-tag vocabulary directly (via the new
`subcategoryOptionsFor()` export), no second taxonomy invented. Wired into
`BusinessPartnerApplyScreen.js` (new applications), `BusinessDashboardScreen.js` (edit-profile
picker + profile-header display + defaulting the "Post Availability" category picker from the
business's own subcategory), `update_business_profile()`/`approve_business_partner_request()`
RPCs, and `screen-business-content`'s business_profile branch — every existing write path that
touches a business's category was individually re-checked and updated so none of them silently
null out subcategory on an unrelated edit (see this migration's own header comment,
`20260925_business_subcategory_layer.sql`, for the full per-callsite audit). **Both deferred pieces closed out the same day, per direct "keep going"**:
(1) the AI onboarding assistant (`business-onboarding-assistant` Edge Function,
`classifyBusinessDescription()`) now also extracts a best-effort `subcategory` alongside
category/attributes/cuisine/priorityOccasions, validated against that same call's own resolved
category so it can never mismatch majors — still manual-confirm like every other AI-suggested
field on that screen. (2) `search_active_business_availability()` now also returns
`brand_partners.subcategory`, and a new `subcategoryBonus()` in `intentResolverScoring.js` scores
it as a flat bonus in `resolveBusinessAvailability()` — a business's own *standing* identity
match now counts even when the specific posting itself is untagged or tagged differently,
distinct from (and additive to) the existing per-posting `row.category` match right above it in
that same function. Deliberately still NOT touched: `businessCategoryClassifier.js`'s
deterministic keyword classifier (inventing ~75 leaf-tag keyword lists is a real content/taste
decision better left for the user to weigh in on, not a mechanical extension like the two above).
**Layer 3 (general semantic tags) first increment shipped 2026-09-27, per direct user pick of
scope (expand the existing `businessAttributes.js` vocabulary + wire it into ranking, keep the
flat text[] structure, no new tags schema) — and the same pass folded in the "Hobbies & Interests
should be a semantic tag layer, not a category" item too, per direct "yes, fold it in."**
`BUSINESS_ATTRIBUTE_OPTIONS` grew from 8 to 18 values: 5 general quality/vibe tags
(`specialty_coffee`, `laptop_friendly`, `dog_friendly`, `waterfront`, `late_night`) and 5
hobby-adjacent tags (`board_game_friendly`, `photography_friendly`, `book_lovers`,
`craft_friendly`, `fitness_focused`) — any business in any category can self-tag "good for board
games," which is how a hobby mention in an ask reaches a matching business across categories
(the vision doc's own photography example) without a new category-fan-out mechanism. No new
resolver code was needed for ranking itself — `attributeAndCuisineBonus()`
(`intentResolverScoring.js`) already scores any overlap between an ask's extracted attributes and
a business's own `row.attributes` generically, vocabulary-agnostic by construction, so widening
the array was sufficient. Every touch point that validates/suggests/extracts this vocabulary was
updated together: `brand_partners`/`business_requests` `attributes` CHECK constraints
(`20260927_business_semantic_tags_expansion.sql`, applied and verified live with disposable test
data), `update_business_profile()`/`create_business_request()` (re-`CREATE OR REPLACE`d on their
unchanged signatures — confirmed single-overload before and after), `businessAttributes.js`'s
display vocabulary, `businessAttributeExtraction.js`'s deterministic "Teach Nearby" keyword list
(new Jest coverage added), and all three Edge Functions that had their own hardcoded copies
(`create-assistant`, `business-onboarding-assistant`, `screen-business-content`) — including each
one's own AI-prompt examples, since a value merely being in the valid-list enum without a
worked example rarely gets chosen. All three functions redeployed via `npx supabase functions
deploy <name> --project-ref enmosvippabmuqslzrox` and confirmed live via the Management API's
function-body endpoint (new tag strings present in the deployed bundle). Deliberately did NOT add
a separate "romantic" value — `date_friendly` already names that same real quality.

**Multi-classification businesses — fully DONE (2026-09-10), resumed after a genuine paused
handoff (2026-09-06 session cut short by weekly usage limit).** `brand_partners`/
`business_partner_requests` gained a `categories text[]` secondary, cross-major classification
array (reusing the same 75-tag `INTEREST_OPTIONS` vocabulary `subcategory` already uses) —
DB layer (`20260928_business_multi_classification.sql`), resolver scoring
(`secondaryCategoryBonus()` in `intentResolverScoring.js`, same flat-bonus weight as
`occasionBonus()`/`attributeAndCuisineBonus()`, capped so more tags can never outrank a real
subcategory match), every write path (`brandOffers.js`, `screen-business-content`,
`BusinessDashboardScreen.js`, `BusinessPartnerApplyScreen.js`), and the public
`BusinessProfileScreen.js` display all shipped and verified live. Bundled fix: `create-assistant`'s
own hardcoded `VALID_CATEGORIES` copy was found stale a second time (still the pre-expansion
26-tag list) and widened to the real 75-tag list, redeployed and confirmed live. Full build/
verification detail: `CLAUDE_HISTORY.md`, search "multi-classification businesses."

**AI-suggestion for `categories` in `business-onboarding-assistant` — also DONE (2026-09-10),
same session, direct user follow-up ("finish what you didn't start").** Mirrors subcategory's own
AI-suggestion precedent: `classifyBusinessDescription()` now also extracts a best-effort
`categories` array, validated against the full 75-tag vocabulary and de-duped against whatever
`subcategory` it also picked (avoids double-counting the same real signal across
`subcategoryBonus()`/`secondaryCategoryBonus()`). Wired into `BusinessPartnerApplyScreen.js`'s
existing manual chip picker + AI-summary banner. Redeployed and verified live.

**Cross-category "Experiences" assembly, first increment — fully DONE (2026-09-10), same session,
per direct user "finish what you didn't start" + detailed design guidance given verbatim when
asked to pick a scope via `AskUserQuestion`.** An extensible, data-driven "recommendation recipe"
framework — `experienceTemplates.js` names, per real already-extracted `occasion`
(date_night/anniversary/birthday/celebration/family_gathering), an ordered list of components
(e.g. 🍽️ Dinner → 🎵 Something to Do → 🍰 Finish the Night), each keyed to real leaf-tag categories
from the existing 75-tag vocabulary. `assembleExperience()` (`experienceAssembly.js`) is a PURE,
client-side regrouping of `resolveIntent()`'s own already-fetched, already-scored
`business_availability` candidates — same "regroup what's already real, nothing new fetched or
computed" shape `HomeScreen.js`'s own `groupIntentResultsByType()` already uses. A component with
no genuine match is silently dropped, never forced — a recipe, not a rigid itinerary; nothing is
ever invented. Wired inline into the existing ask-box result flow (`HomeScreen.js`) as a new
section above the flat list, with claimed items filtered out of that flat list so nothing repeats.
Jest coverage added (8 tests, `experienceAssembly.test.js`); full suite 230/230 passing. Full
build/verification detail: `CLAUDE_HISTORY.md`, search "Experiences assembly." This was the last
fully-unstarted piece of the intent-engine vision — both deferred pieces named at the top of this
session (this, and the `categories` AI-suggestion above) are now shipped.

**Both of this increment's own deliberately-deferred pieces — fully DONE (2026-09-10), same day,
direct user follow-up ("finish business side experience bundles and extending the assembly beyond
business_availability").** (1) `assembleExperience()` now also includes real `gathering`
candidates, not just `business_availability` — `resolveGatherings()` (`intentResolver.js`) carries
the gathering's own real `interest_tag` as `category` onto its candidate object, the exact same
field shape `resolveBusinessAvailability`'s candidates already carry, so a genuinely matching
gathering (e.g. a live-music gathering filling "Something to Do") now fills a component
identically to a business posting — `community`/`perk`/etc. still carry no such field and remain
excluded, a real, not-yet-done, separate follow-up. (2) Business-side Experience Bundles: a
business can now explicitly self-declare, on ONE of its own live `business_availability`
postings, that it covers MULTIPLE components of one specific occasion's template all by itself
(e.g. a restaurant's own "Date Night Package" bundling dinner + live music + dessert) — two new
columns (`bundle_occasion`, `bundle_components`), both business-typed with no AI involved,
validated against a flat CHECK vocabulary (union of every template's component keys, interpreted
contextually per-occasion at read time, same precedent `brand_partners.categories`/`attributes`
already set) plus matching validation in `post_business_availability` (now 11 args — old 9-arg
signature explicitly dropped per this repo's own overload-trap convention) and in
`admin_review_business_content_screening`'s MEDIUM/UNCERTAIN raw-insert branch (the *other* write
path into this table — confirmed via `pg_get_functiondef` this is the only other one).
`search_active_business_availability` (4th column-list change now, same drop-first discipline)
returns both new fields; `resolveBusinessAvailability` carries them as
`bundleOccasion`/`bundleComponents` on the candidate. `experienceAssembly.js`'s
`assembleExperience()` pulls a genuine bundle (bundleOccasion matches the ask's own occasion AND
at least 2 of that occasion's own real component keys are covered) out and claims it as one whole
unit *before* the normal per-component loop runs, so it's presented as its own "✨ One place has
it all" unit (`HomeScreen.js`) rather than competing for a single component slot; a posting that
only ticked one box is just a normal single-component candidate, no special casing needed.
Migration `20260929_business_experience_bundles.sql` — schema, all three functions, and every
CHECK constraint verified live against production inside rolled-back transactions (valid bundle
insert + both admin-approve and low-tier RPC write paths + all three invalid-input rejections:
bad occasion, bad component, components-without-occasion). `screen-business-content` Edge
Function redeployed and confirmed live via the Management API's function-body endpoint (new
vocabulary strings present in the deployed bundle) — its own body-parsing glue was verified by
code review + bundle-content confirmation, not exercised via a live authenticated HTTP call (no
test user session available this session). Business owner picks the bundle occasion + components
via new chip pickers in `BusinessDashboardScreen.js`'s existing "Post Availability" modal, entirely
optional, resets cleanly if the occasion is changed. Jest suite extended to 14 tests
(`experienceAssembly.test.js`); full suite 236/236 passing. Deliberately NOT built: Signature
Experiences (`business_experiences` — a different, older, single-category showcase concept never
wired into the intent resolver at all) gaining its own bundle concept — out of scope, not implied
by this change.

**Crossed Paths sighting push notification — fully DONE (2026-09-11).** Item 12 of the Sep 6 2026
external UX critique's last open piece: a genuine sighting now sends a real push to both people in
the pair (each gated on their own new `notify_crossed_paths` preference, default on), deep-linking
to the other person's profile. Shipped as `notify_sighting_crossed_paths()`, a plain `AFTER INSERT`
trigger on `sightings` (`20261002_crossed_paths_sighting_notification.sql`) — the same direct-
table-trigger shape every sibling `notify_*` push in this codebase already uses (there is no
`notification_events` intermediate table anywhere in this schema, confirmed live). Dedup comes free
from `sightings`' own real shape (`UNIQUE(user_a, user_b)` + `report-presence`'s upsert never
touching `first_seen_at` on conflict, confirmed by reading the real deployed Edge Function body) —
a repeated sighting between the same pair is always an `UPDATE`, which an insert-only trigger never
fires on, so no extra dedup column was needed. Verified live via a disposable rolled-back
transaction (genuine push logged once, correctly gated per-recipient, then a re-upsert of the same
pair produced no second push). Client: `notifications.js` routes the new `crossed_paths_sighting`
type to `ViewProfile`; `SettingsScreen.js` has a new "👋 Crossed Paths" toggle. Full Jest suite
252/252 passing; real device push delivery not exercised (no simulator/device tooling available in
this project, standing note). Full research trail and design reasoning: `CLAUDE_HISTORY.md`,
search "Crossed Paths sighting push notification."

**Quick Filters customization copy — Crossed Paths "keep the app open" wording fixed, DONE
(2026-09-06), external UX critique item 12.** Real background location detection already exists
(`startBackgroundPresenceReporting`, a registered background task, started on login in
`RootNavigator.js`) — "keep the app open" was outdated, unnecessarily discouraging friction. Both
`discovery.emptyText` and `discovery.radiusInfoText` (`src/i18n/translations.js`, all 11 locales)
reworded to state what's actually true: no need to keep the app open, background checking exists,
but — per the backlog item above — the copy stops short of promising a push notification, since
none exists yet.

**Branded loading treatment — DONE (2026-09-06), external UX critique item 13.** New
`src/components/BrandedLoader.js` (the app's real splash mark + a subtle coral sweep, not a
generic spinner) now replaces `RootNavigator.js`'s session/profile boot gate, which used to be a
bare `return null` (a blank screen) — the one loading moment every app open passes through.
Deliberately scoped to that one spot rather than replacing all 16 existing `SkeletonCard` call
sites — those are still the right treatment for in-list "more items loading," per direct user
steer not to use the branded treatment everywhere.

**Quick Filters real customization (select + set values + reorder) — fully DONE (2026-09-06),
external UX critique item 9.** Dating's Customize screen used to only reorder/show-hide a fixed 3
booleans; now a shared catalog (`src/constants/quickFilterCatalog.js`) + one generic
`QuickFilterCustomizeScreen` (mode-driven) gives Dating a real settable Match % threshold plus a
new Shared Interests filter, and gives Friends its own first-time Customize affordance over its 4
real dimensions. Migration `20260921_quick_filter_customization.sql` applied and verified live.
Not tested in a running app (no simulator tooling available this session). Full build detail:
`CLAUDE_HISTORY.md`, search "Quick Filters: real select+set-values+reorder customization." The
same critique's items 10 (Messages button visual weight) and 11 (People→Dating/Friends
hierarchy) were both found already fully shipped by prior Aug 23/30 2026 work — no code change
needed for those two.

**Discover/People-Friends parity plan — fully DONE (2026-09-06).** All 4 items (Discover mode
filters in-place, Friends mode mirrors Dating's architecture, Add Friend bug, generalized "Plan
Something" flow) shipped. Full build/verification detail: `CLAUDE_HISTORY.md`, search "Discover/
People-Friends parity plan." **Follow-up fix, 2026-09-10**: the Add Friend bug's original fix
(real friendship-status lookup + Friends ✓/Message/Plan Something rendering) was correct but had
one remaining gap — `ViewProfileScreen.js` used a plain `useEffect(load, [])`, so revisiting an
already-mounted `ViewProfile` route (React Navigation reuses rather than remounts it — e.g.
profile → Chat → that same person's profile again via the chat header) never re-ran `load()`,
leaving `friendshipStatus`/`matchId` frozen at whatever they were on first mount. Switched to
`useFocusEffect` (this codebase's own established pattern) so it's always freshly read on every
focus. See `src/screens/ViewProfileScreen.js`'s own comment at the fix site for the full account.

**Host cancellation lifecycle for Communities and Gatherings — fully DONE (2026-09-06).** Both
items shipped: Communities got a real `status` column (active/paused/cancelled) with a "Manage
Community" section (Edit / Pause-Resume / Cancel / Delete-Permanently-once-cancelled); Gatherings
kept their delete-based mechanism but gained a `cancel_gathering` RPC and a "Cancel Gathering"
action in the detail screen that was previously missing entirely. Verified live against
production with disposable test data. Full build/verification detail: `CLAUDE_HISTORY.md`, search
"Host cancellation lifecycle." **2026-09-10 parity follow-up**: user re-asked for this exact spec
verbatim (unaware it had already shipped); confirmed still live and correct on re-read (including
that gathering cancellation fires a real push via `notify_gathering_cancelled()`, not just a DB
row), then closed the one real cosmetic gap — `GatheringDetailScreen.js`'s Edit/Cancel links now
sit under their own "Manage Gathering" label (new `manageSectionLabel` style, mirroring
Communities' own "Manage Community" label) instead of loose inside the general host banner.

**Phase 8 (Discover visual hierarchy + expand-in-place) is fully DONE, including section H.**
Full account moved to `CLAUDE_HISTORY.md` ("Phase 8 ... section H — BUILT").
"Business Web as an Operating System" (Phases 1-7) is fully DONE. Phases 1-6 (decline reasons,
day-of-week availability, offer-performance funnel, media-on-offer
upload, weather digest card, Requests→Opportunities rename) were verified live in production —
see `CLAUDE_HISTORY.md`, search "Business Web as an Operating System" for the full plan/audit and
each phase's build/verification detail. **Phase 7** (Path A: Expo web export of the existing
business dashboard, reusing RN screens verbatim, deployed as a static site at
`/Nearby/business/` via GitHub Pages from the committed `docs/business/` folder) landed
2026-09-05 — `App.web.js` / `BusinessWebNavigator.js` / `BusinessWebHomeScreen.js` /
`PlatformDateTimeInput.js` are the new web-only surface; `BusinessDashboardScreen.js` and
`businessFulfillment.js` gained `Platform.OS === 'web'` branches for the handful of native-only
actions (camera Moments, Stripe Connect OAuth return, native DateTimePicker, native file upload,
Share.share, GatheringDetail/CommunityDetail navigation) with honest fallback messages/behavior
rather than silent failure. Verified: `expo export -p web` builds clean, output serves correctly
under the `/Nearby/business/` base path via a local static server, no secrets in the built
bundle. **Not verified in an actual browser** — no browser/simulator tooling was available in
that session; if something looks visually off on the deployed site, that's the first thing to
suspect. `docs/business/` must be regenerated (`NEARBY_WEB_EXPORT_BASE_URL=/Nearby/business npx
expo export -p web`, then copy `dist/*` over it) and recommitted any time a business-facing
screen changes — it is not auto-built by CI (no GitHub Actions workflow exists for this yet).

**2026-09-05 fix**: `experiments.baseUrl` was originally a static value in `app.json`, which is a
*global* Expo config field, not web-scoped — `@expo/cli`'s asset-copying code applies it to every
platform's build, not just web. This broke native iOS archive builds (`ENOTDIR` copying assets
into a bogus `Nearby.app/Nearby/business/assets/...` path during "Bundle React Native code and
images"). Fixed by moving config to `app.config.js`, which only injects `experiments.baseUrl`
when the `NEARBY_WEB_EXPORT_BASE_URL` env var is set — i.e. only during the docs/business export
command above, never during a native EAS build. Do not put `baseUrl` back into `app.json` as a
static value.

## Standing Conventions (Locked)

These are the load-bearing rules distilled from thousands of lines of prior build history. Full
original reasoning/citations for any of these: `CLAUDE_HISTORY.md`.

- **No invented numbers, no fabricated signals, ever.** Every metric/count/reason shown anywhere
  in the app must trace to a real query result. An absent signal renders as an honest empty
  state, never a guessed placeholder.
- **Coral (`colors.primary`) = action, not decoration.** Tappable-and-advances-the-user → coral.
  Informational → must not visually impersonate a button. Destructive → `colors.danger`, never
  coral. Progress/data-visualization (a fill bar, an achievement indicator) → coral is fine when
  clearly non-interactive. Secondary actions (Cancel, dismiss) → neutral/outlined; coral is
  reserved for a surface's *primary* action. This visual system is frozen — no further
  consistency sweeps expected unless new work introduces a genuinely new pattern.
- **No stranger discovery via intent, ever — hard privacy rule.** Any "find things for you"
  resolver-shaped feature (Home's intent box, Business Fulfillment matching, group-intent
  signals, etc.) may only ever surface real supply (gatherings/communities/businesses) or people
  the caller is already connected to (accepted friend or match) — never proximity/interest-based
  surfacing of an unconnected stranger. Businesses are deliberately exempt (they're discoverable
  supply by design, not a privacy concern the way a person is).
- **AI never infers or assigns a specific date/time from free text.** A user always picks
  date/time through deterministic UI (preset buttons + a picker). AI may suggest title/category/
  location/description for confirmation, never silently commit a date/time guess.
- **AI suggests, never silently commits.** Every AI-derived value anywhere in the app is shown
  back for the user's own explicit confirmation before it's saved — this holds for every
  AI-classification feature in this codebase, no exceptions.
- **Each actor only ever reports its own side's state.** A business says "I accept this Request"
  (→ becomes an Offer); a consumer says "I accept the Offer" (→ becomes a Commitment); Nearby's
  own SECURITY DEFINER RPCs compute the combined/derived state. No client ever directly flips
  another party's state.
- **Decline reasons feed a real, owner-visible insight surface — never automated re-weighting of
  the matching engine.** A business owner sees their own decline pattern and can manually tighten
  their own settings in response; nothing auto-adjusts matching behavior from decline history
  without its own separate, explicit authorization.
- **"Don't navigate for information, navigate for tasks"** (the Progressive Depth doctrine,
  locked Sep 15 2026 as a standing rule for all future UI work): a screen change should only ever
  happen when the user's actual task changes, or real information depth genuinely requires it —
  never merely because a filter, category, or already-visible data changed.
- **Feature-freeze convention**: don't start a new product surface or architectural change
  without a direct, explicit user request. This does not block bug fixes, security fixes, or
  stabilization work — those are always in scope. A direct request is always sufficient to
  proceed on something bigger; this has been explicitly invoked and overridden dozens of times
  since it was first declared (2026-08-15) and is really just describing normal operating mode.
- **Real external accounts / real money (Stripe, a real reservation/transportation provider,
  etc.) always need the user present for that decision** — never set up or connected
  autonomously, even if the schema/UI scaffolding around the seam is otherwise safe to build
  ahead of time.
- **Migration/verification discipline**: one migration file per schema change (never a
  duplicate hand-patch baked into a squashed baseline file in the same change — that exact
  mistake once broke this repo's own "rebuildable from an empty database" guarantee). Verify a
  schema change live against production with real disposable test data before considering it
  done; a full from-scratch Docker replay (`supabase/postgres:15.1.0.147`, drop/recreate an empty
  `public` schema, patch the two known image-version gaps — `auth.users.phone`,
  `storage.buckets.public` — onto the test container only, run the full `supabase/migrations/`
  folder in filename order via `psql -v ON_ERROR_STOP=1`) is the gold-standard extra proof this
  repo has historically done, but isn't mandatory for every small change — disclose plainly
  whether it was done, don't silently skip and claim parity.
- **`CREATE OR REPLACE FUNCTION` creates a second overload instead of replacing the original
  whenever the parameter list changes at all — even with an unchanged return type**, not only
  the already-documented RETURNS TABLE column-list case. Adding a new trailing default
  parameter to an existing function (discovered 2026-09-06 adding `update_business_profile`'s
  `subcategory_param`) leaves the old signature live and independently callable side by side
  with the new one, silently defeating the change for any caller still resolving to the old
  overload. Always re-check `pg_get_function_identity_arguments` for the function name right
  after any such migration; if more than one row comes back, `drop function` the old exact
  signature explicitly, and add that same explicit drop into the migration file itself before
  its `create or replace` so a from-scratch replay lands in the same single-overload state.
- **A new Postgres function defaults to PUBLIC execute access** — always explicitly
  `revoke ... from public, anon` unless it's genuinely meant to be public. Rate-limit/counter
  triggers use `SELECT ... FOR UPDATE` to avoid race conditions. Privileged `profiles` columns
  (`is_premium`, `managed_partner_id`, daily-counter columns, etc.) are guarded by a
  `prevent_self_premium_edit()`-style trigger; a legitimate server-side write to one of these
  must `perform set_config('app.trusted_update', 'true', true)` first.
- **Git workflow for this repo**: commit and push after each individual phase/increment as it
  lands, not batched at the end — this is this project's own long-standing, explicitly
  pre-authorized convention (not something to re-confirm each time), specifically so a
  mid-session restart never loses more than one increment's worth of work.
- **Migration filename ordering matters.** Migrations replay in filename lexical order,
  independent of when they were actually written — a new migration that depends on an earlier
  one must sort *after* it by filename, or a from-scratch replay will fail even though production
  (already migrated in real chronological order) looks fine. This has bitten this repo more than
  once; double-check filename ordering against real dependencies before naming a new migration.

## Reference

- `CLAUDE_HISTORY.md` — the complete historical build log (pre-2026-09-17), unedited, reverse-
  chronological. Grep by date or feature name.
- `PRODUCT_AUDIT/` — standalone audit documents from past sessions, mostly historical snapshots.
  `PRODUCTION_ARCHITECTURE_2026-08-15.md` (system-wide architecture reference) and
  `SIGNAL_CONTRACT.md` (per-signal collection/matching/ranking contract) are the two most likely
  to still be useful as a reference rather than pure history.
- No automated test framework beyond Jest unit tests on pure functions
  (`jest.config.js`/`jest.babel.config.js`) — no simulator/device testing has ever been available
  in any session on this project.
