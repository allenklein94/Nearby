# Phase 2 — Master User Preferences + Master Filters inventory

Part of the "Nearby Universal Taxonomy, Filters & Matching Audit" (see CLAUDE.md, top section).
Read-only research — no code was changed to produce this file.

## Real findings (the concrete, non-obvious things)

1. **`BASICS_FIELDS`' 24 `select`-type fields are already real, live, premium-gated hard
   filters on Dating discovery** (`DiscoveryScreen.js`'s `DISCOVERY_FILTER_FIELDS`), not just a
   post-match compatibility narrative — correcting Phase 1's original mis-read of this. Confirmed
   exact mechanism: `filteredNearby` applies `if (!personValue || !selectedOptions.includes(
   personValue)) return false` per selected field, hard include/exclude, premium-only. This is a
   real, substantial "Experience preferences" filter surface (religion, drinking, workout
   frequency, social energy, weekend style, family plans, etc.) that exists **only for Dating**
   — none of it reaches Friend Discovery, Things to Do, or Gatherings.
2. **Friend Discovery has zero user-facing filters of any kind** — no distance, no interest, no
   category, nothing. `FriendDiscoveryScreen.js` calls `getFriendDiscoveryCandidates(20)` (a
   single RPC, `get_friend_discovery_candidates`) with no filter params at all; whatever ranking
   happens is entirely server-side and opaque to the user. This is a real, stark asymmetry next
   to Dating (a premium-gated advanced-filter modal plus quick filters) and Gatherings (a real
   6-section accordion: Distance/When/Category/Environment/Price/People).
3. **There is no "when am I available" (weekly free-time/schedule) preference anywhere on the
   profile, at all** — grepped Profile/Settings/CompleteProfileScreen for anything
   availability/schedule-shaped, found nothing. Every "When" signal in this app is about *what's
   happening when* (a gathering's `scheduled_at`, the When accordion's date-window filter,
   "Starting Soon"), never *when the user themselves is free*. Matches the pasted external
   message's own "Availability" bucket — this app genuinely has no representation of it as a
   user preference, only as an event-side property.
4. **`GatheringsScreen.js`'s "For You"/"Trending" toggles are a real, quietly-separate signal
   axis from the 6-section filter accordion** — `forYouActive` re-sorts/filters by the caller's
   own `getMyTopGatheringCategories()` history (an implicit, derived preference, never
   explicitly stated by the user anywhere), `trendingActive` filters by a real
   `get_trending_gathering_ids` RPC. Neither is stored as a persistent user preference (both
   reset to `false` on remount) — worth noting as a real design choice (session-scoped, not
   persisted) rather than a bug, but it means "For You" can never be turned into an explicit,
   durable "always show me my favorite categories first" setting without a schema change.
5. **Settings' "Preferences" group conflates two genuinely different kinds of preference under
   one header**: "Looking For" (`relationship_intention`, dating-specific) and "Discovery
   Preferences" (`discovery_gender`/`show_me`/age range, also dating-specific) sit directly next
   to "Appearance" and "Language" (pure app-behavior settings, not about matching at all). This
   isn't wrong exactly — the group is literally labeled generically — but it means "Preferences"
   as a single word means two very different things depending on which card you're looking at.
6. **The 6-section `GatheringsScreen` accordion is the single richest, most systematically-built
   filter surface in the app** — Distance, When (incl. the new "Starting Soon"), Category
   (grouped), Environment (indoor/outdoor), and the two brand-new Price/People sections all use
   the identical accordion pattern, all wired into one real filter chain (`filteredNearby`).
   Every one of these is confirmed used-by-filtering; **none of the 6 are currently read by any
   scoring/ranking function** (see the Master Filters table below) — they narrow the visible list
   but don't reorder what's shown within it (aside from the separate For You/Trending toggles).
7. **`AskBusinessScreen.js`'s fields (category/party size/budget/date window/radius) double as
   both a "preference for this one ask" and, once submitted, real inputs to the business-matching
   RPCs** (`_match_request_to_availability`, `_match_request_to_policy`, the reliability-weighted
   fan-out) — this is the one surface in the whole app where a "filter" (what the user picks)
   and a "matching signal" (what the server-side RPC actually scores/matches against) are
   guaranteed identical, because they're the same request row. Worth citing as a positive
   example of the "filter = matching signal, not two different things" principle the audit is
   ultimately checking for everywhere else.

## Master User Preferences

Classified into the requested buckets — Identity / Intent / Interests / Experience preferences /
Logistics / Relationship preferences / Availability.

| Bucket | Field | Column/store | Collected on | Also editable on | Notes |
|---|---|---|---|---|---|
| **Identity** | Display name, bio, birthdate, photos | `profiles.display_name`/`bio`/`birthdate`/`photo_url` | `CompleteProfileScreen.js` (onboarding) | `ProfileScreen.js` | Standard, single source per field, no drift found. |
| **Identity** | Gender identity | `profiles.gender_identity` (multi, `GENDER_IDENTITY_OPTIONS`) | — | `ProfileScreen.js` only | See Phase 1 Real Finding 1 — parallel legacy field `discovery_gender` exists too. |
| **Identity** | Pronouns, gender_hidden, ethnicity, ethnicity_hidden | `profiles.*` | — | `ProfileScreen.js` | Not independently re-audited this pass beyond confirming they exist (via `ViewProfileScreen.js`'s own select list). |
| **Intent** | Relationship intention | `profiles.relationship_intention` (multi, `INTENTION_OPTIONS`) | Settings "Looking For" | `DatingPreferencesPromptModal.js` (first-open) | Real filter + gate signal — see Phase 1 Real Finding 2 for the `basics.relationship_goals` overlap. |
| **Intent** | Open to Friend Discovery | `profiles.open_to_friend_discovery` (assumed boolean, confirmed via CLAUDE.md history, not re-verified this pass) | Friend Discovery's own "Turn On" toggle | — | A binary opt-in, not a richer intent — no sub-preferences under it (see Real Finding 2 above, zero filters). |
| **Intent** | "Who's this gathering for" | `gatherings.party_type` (new) | `CreateGatheringScreen.js` | — | Host-declared, per-event, not a standing personal intent — a borderline case, noted here since it's the closest thing to "activity intent" this app has. |
| **Interests** | Personal interests | `profiles.interests` (array, `CompleteProfileScreen.js`'s own local option list — see Phase 1 Open Question 1) | `CompleteProfileScreen.js` | `ProfileScreen.js`, `QuickPicksEditModal.js` (Home Quick Picks customization) | Deliberately distinct from the gathering-category taxonomy, per CLAUDE.md's own documented decision. |
| **Experience preferences** | 24 `BASICS_FIELDS` select fields (religion, drinking, workout, social_energy, weekend_style, family_plans, communication_style, love_style, pets, smoking, cannabis, social_media, financial_priority, independence_preference, family_closeness, relocation_openness, morning_person, cooking_habits, life_chapter, hair_color, eye_color, diet, zodiac, education, relationship_goals, relationship_type — 26 select fields total, see Phase 1 correction) | `profiles.basics->>'<key>'` (jsonb) | Onboarding-adjacent (not fully traced which screen first collects these — flagged for Phase 5) | `ProfileScreen.js`'s Basics editor | Real, substantial, and — per Real Finding 1 above — genuinely dual-purpose (post-match narrative + live premium filter). |
| **Logistics** | Distance radius (dating) | `DiscoveryScreen.js` local filter state, not persisted to `profiles` | `DiscoveryScreen.js` | — | Session-only, not a durable preference — worth noting as inconsistent with Gatherings' own radius tier, which is also session-only (`radiusTier` state), so at least the two are consistent with each other in *not* persisting. |
| **Logistics** | Distance tier (gatherings) | `GatheringsScreen.js` `radiusTier` state (local/wide) | `GatheringsScreen.js` | — | Session-only, not persisted. |
| **Logistics** | Notification toggles | `profiles.notify_*` (several) | Settings "Notifications" group | — | Not deeply re-audited this pass; confirmed the group exists and is real (backed by actual columns, per `SettingsScreen.js`'s own load/save). |
| **Logistics** | Language | app-level, `LanguageContext` | Settings "Preferences" → Language | — | App-behavior preference, not a matching signal. |
| **Relationship preferences** | Show Me / Discovery Gender | `profiles.show_me`/`discovery_gender` (legacy single-select) | Settings "Discovery Preferences" | `DatingPreferencesPromptModal.js` | See Phase 1 Real Finding 1. |
| **Relationship preferences** | Interested-in genders | `profiles.interested_in_genders` (new multi-select) | — | `ProfileScreen.js` only | Same. |
| **Relationship preferences** | Preferred age range | `profiles.preferred_min_age`/`preferred_max_age` | Settings "Discovery Preferences" | `DatingPreferencesPromptModal.js` | Real, used directly in `proximity.js`'s candidate query. |
| **Relationship preferences** | Ethnicity preferences | `profiles.ethnicity_preferences` | Settings "Discovery Preferences" (assumed — not independently confirmed this pass) | — | Real, used in `proximity.js`. |
| **Availability** | — | **none found** | — | — | **Real, confirmed gap** — see Real Finding 3. No weekly-schedule or free-time preference exists anywhere on a user's profile. |

## Master Filters

filter | screen | data source | user-facing | used by matching (a server-side/RPC scoring or eligibility function reads the same field) | used by ranking (reorders results, not just include/exclude)

| Filter | Screen | Data source | User-facing | Used by matching | Used by ranking |
|---|---|---|---|---|---|
| Distance (Local/Wide tier) | `GatheringsScreen.js` accordion | client-side, `getNearbyGatherings(radiusTier)` | Yes | Yes — `getNearbyGatherings()`'s own server call is radius-scoped, so this genuinely gates what's fetched, not just displayed | No (no distance-based sort within the tier) |
| When (incl. new "Starting Soon") | `GatheringsScreen.js` accordion | `matchesDateFilter()`, client-side over `scheduled_at` | Yes | No — purely a client-side visible-list narrower, no server RPC reads a "when" filter the user picked | No |
| Category (now grouped) | `GatheringsScreen.js` accordion | `interest_tag` | Yes | Partially — `interestFilter` narrows the list; the separate "For You" toggle *is* a real derived-preference re-sort, but it's a different control than the Category filter chips themselves | Only via "For You" |
| Environment (Indoor/Outdoor) | `GatheringsScreen.js` accordion | `CATEGORY_INDOOR_OUTDOOR` | Yes | No | No |
| **Price (new)** | `GatheringsScreen.js` accordion | `gatherings.price_level` | Yes | **No** — not read by any matching/resolver function yet (confirmed: `intentResolver.js`'s gathering-scoring branch doesn't reference `price_level`) | No |
| **People (new)** | `GatheringsScreen.js` accordion | `gatherings.party_type` | Yes | **No** — same as above, `intentResolver.js` doesn't reference `party_type` | No |
| For You | `GatheringsScreen.js` | `getMyTopGatheringCategories()` (derived, not user-declared) | Yes | N/A (it IS the matching signal, applied client-side) | Yes — re-sorts by rank |
| Trending | `GatheringsScreen.js` | `get_trending_gathering_ids` RPC | Yes | N/A | Filter only, no re-sort beyond inclusion |
| Type filter (Gatherings/Communities/Places/Perks/All) | `DiscoverHubScreen.js` | client-side section toggling | Yes | No — this only controls which sections render, not a scoring input | No |
| Place category (coffee/restaurants/parks/hubs) | `DiscoverHubScreen.js` | Google Places `type` param | Yes | N/A — passed directly to Google's own API, not this app's matching | N/A |
| Category, party size, budget, date window, radius | `AskBusinessScreen.js` | `business_requests.*` on submit | Yes | **Yes — all five** genuinely feed `_match_request_to_availability`/`_match_request_to_policy`/the fan-out. The one filter surface in the app where filter = matching signal by construction (see Real Finding 7). | Yes (reliability-weighted fan-out) |
| Show Me | `DiscoveryScreen.js` | `profiles.show_me` (legacy) / `gender_identity`+`interested_in_genders` (new) | Yes | Yes — `passesGenderMatch()` | No |
| Age range | `DiscoveryScreen.js` (premium) | `preferred_min_age`/`max` | Yes | Yes — real hard filter in `proximity.js` | No |
| Verified only / High compatibility only / Online only | `DiscoveryScreen.js` quick filters | `photo_verified`, `compatibilityScore`, presence | Yes | N/A (these ARE the matching-adjacent signals, applied as a hard filter) | No — hard filter only, `compatibilityScore` itself isn't used to sort, only to gate ≥70 |
| Relationship intention filter | `DiscoveryScreen.js` | `relationship_intention` | Yes | Yes — same field the intention chips write | No |
| 24 Basics-derived advanced filters | `DiscoveryScreen.js` (premium) | `profiles.basics->>'<key>'` | Yes | Yes — hard filter, see Real Finding 1 | No |
| Ethnicity | `DiscoveryScreen.js` (premium) | `profiles.ethnicity` | Yes | Yes | No |
| (none) | `FriendDiscoveryScreen.js` | — | **No filters exist** | Unknown — whatever `get_friend_discovery_candidates` does server-side is opaque to this audit without reading the RPC body (flagged for Phase 3) | Unknown, same reason |

### The one clean pattern worth naming explicitly

Every filter that is *also* a real matching/ranking signal shares one property: **it was
submitted as part of a request/profile row the server actually reads back** (Ask a Business's
five fields; Dating's Show-Me/age/basics filters, all columns on `profiles` the matching RPCs
also select). Every filter that is *only* a client-side visible-list narrower (When, Environment,
the two brand-new Price/People filters, the Type/Place filters on Discover) narrows a list that
was already fetched — it never round-trips back into anything scored. This is exactly the
"cosmetic filter with no matching-engine equivalent" pattern the external audit request was
looking for, and it's real: **`price_level`/`party_type` (today's own new fields) are the
freshest instance of it** — both are genuinely new, both are filterable, and both are currently
invisible to `intentResolver.js`'s gathering-scoring branch even though the branch already scores
interest-match/distance/happening-now for the exact same candidate rows.

## Open questions carried into Phase 3 (Matching Matrix)

1. Should `price_level`/`party_type` (and, more broadly, every gathering-side filter) become a
   real scoring input to `intentResolver.js`, not just a visible-list filter — matching the
   pattern Ask a Business already proves out? Real product decision, not resolved here.
2. What does `get_friend_discovery_candidates` actually score/rank on, server-side, given the
   client exposes zero filters? Needs a direct read of the RPC body in Phase 3.
3. Is the total absence of an Availability preference (Real Finding 3) worth building, or is it
   correctly out of scope given this app's real-time "what's happening now" framing throughout
   (Right Now/Starting Soon/Happening Near You)? A real product question, not resolved here.
