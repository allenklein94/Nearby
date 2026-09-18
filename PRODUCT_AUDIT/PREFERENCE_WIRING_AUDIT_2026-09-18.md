# Preference wiring audit (2026-09-18)

Master rule: Onboarding -> Profile/Preferences -> Matching/Intent -> Discover -> Create -> People -> Plans
-> Businesses -> Offers -> Reservations -> Notifications -> Occasions. Capture once, store once, every
consumer reads the same canonical value. Progressive completion: never force advanced prefs up front.

## What exists today
- Onboarding flow: Onboarding -> OnboardingQuestions (motivations, comfort, monthly_interests) ->
  OnboardingLocation -> Login -> CompleteProfile (name, birthdate, interests, terms). Photos, bio,
  Friends-vs-Dating mode, hair/height/eye prefs, cuisine/venue prefs live in later/Settings screens.
- Canonical category vocabulary already exists: `PLACE_CATEGORIES` (19 keys) == `CATEGORY_GROUPS` keys in
  `gatheringCategories.js` (~70 tags, `INTEREST_OPTIONS`); `profiles.interests` uses those tags.
- Appearance prefs ARE real matching filters (`proximity.js`: hair, eye, height; absence never excludes).

## Gaps
1. Second category universe: onboarding `MONTHLY_INTERESTS` (10 hand-picked labels: Coffee, Beach, Books,
   Dog walks...) stored in `profiles.monthly_interests`, not mapped to canonical tags/groups.
2. Interests picked in CompleteProfile are one flat list of ~70 tags with no group-level onboarding step
   (Food, Fitness, Outdoors, Wellness, Family, Community... as the coarse graph).
3. Captured but barely consumed (0 services/utils readers): `connection_goal`, `onboarding_motivations`,
   `home_quick_pick_categories`. `cuisine_preferences`/`venue_preferences` only 2 service readers.
4. Notification category prefs (`notify_*_categories`) set in Settings only, not seeded from onboarding
   interests -> user re-states what they already told us.
5. Appearance/dating prefs only reachable via DatingPreferencesScreen, not offered progressively at the
   moment Dating mode is first chosen.
6. Consumers not yet confirmed reading canonical interests: Search/intent, Create defaults, Business
   matching, Occasions, Notifications (verify per consumer in Phase 2).

## Proposed phases (each: one migration if needed, tests, commit)
1. Canonical interest graph: one module (`src/constants/interestGraph.js`) = groups + tags + mapping from
   legacy `monthly_interests` labels; onboarding picks groups first (coarse), refine to tags optionally;
   backfill/derive `monthly_interests` from it (no duplicate store).
2. Consumer wiring audit + fixes: Discover, Search, Create defaults, Gatherings/Communities, People match,
   Business matching, Recs, Occasions all read `profiles.interests` via one helper; guard test that no
   feature declares its own category list.
3. Seed notification categories, home quick picks, cuisine/venue defaults from onboarding interests
   (suggested, shown for confirmation -- AI/derived never silently committed).
4. Progressive completion: mode-triggered prompts (first Dating use -> hair/height; first Friends use ->
   activity interests) + profile-completion meter from real fields; retire or wire dead fields.
5. Verification: live disposable-user check that a preference set once changes Discover, People, Plans.

## Status
- **Phase 1 done (2026-09-18):** `src/constants/interestGraph.js` (+ test) layers onboarding helpers on the one
  canonical vocabulary. Onboarding now asks groups ("What are you into?", skippable) then optional tags from
  those groups; the old 10 free-form mood labels are gone. Picked tags seed CompleteProfile's interests step
  (user confirms/edits before save) and `monthly_interests`. Legacy `monthly_interests` rows are mapped to
  canonical tags at read time (`canonicalizeInterests` in `homeDashboard.js`) -- this also fixes a real bug:
  labels like Food/Games/Books/Dog walks never matched any gathering `interest_tag`. No schema change, no
  migration. Not verified on a device.
- **Phase 2 done (2026-09-18):** consumer audit. Already reading declared interests: Discover ("Matches your X
  interest"), People/friend matching, compatibility, proximity, surprise-me, recs, brand offers, and
  server-side push (`interests @> category`) + business-opportunity matching. Fixes: (1) Home's "Because
  you're into" was behavior-only, so a new account's declared interests went unused -- now falls back to them
  (`becauseYouLikeCategories`, `homeDashboard.js`); (2) removed the orphaned `MONTHLY_INTERESTS` list left in
  onboarding; (3) `categoryVocabularyGuard.test.js` fails if any `category: 'X'` literal or experience-template
  array names a non-canonical tag. Deliberately left: `CREATE_HUB_OPTIONS` stays a fixed stable set (its own
  comment); unrelated local `CATEGORIES` lists (trip/memory/decision/features) aren't interest vocabularies.
  Jest 653/653.
- **Phase 3 resolved as "already wired -- deliberately no copy" (2026-09-18):** notification category prefs are a
  NARROWING on top of declared interests, not a separate store (`notify_*_categories` null = all of the user's
  interests; push triggers require `p.interests @> tag` AND (null OR tag in list) --
  `20261005_notification_categories.sql`; Settings shows every interest selected when null). So interests picked
  in onboarding already drive notifications with zero extra storage, and seeding a copy would have created the
  duplicate state the master rule forbids. Home quick picks: `home_quick_pick_categories` null = automatic, and
  the automatic path now includes declared interests (Phase 2). Cuisine/venue prefs are NOT derivable from
  interests (no signal), so they move to Phase 4 as a progressive prompt when a Food-group interest is chosen.
- **Phase 4 done, partly (2026-09-18):** (1) `onboarding_motivations` now has a real consumer beyond the signup
  friend-discovery flag: it sets the starting People sub-mode (friends-only motivations -> Friends) when there is
  no usage and no remembered choice (`subModeFromMotivations`, `peopleSubModePreference.js`; usage and last-used
  still win). (2) `connection_goal` (was written in Profile, read by nothing) now shows on ViewProfile as "Hoping
  to find: X" when no dating `relationship_intention` is set. Note it overlaps `onboarding_motivations` in intent;
  left as two fields because one is a private signup signal and the other a public profile line -- not merged.
  (3) The first-open Dating prompt gained an optional "Save and fine-tune (hair, height, eyes)" link into
  DatingPreferencesScreen -- appearance stays optional/progressive. (4) Profile-completion meter already exists in
  ProfileScreen (`getProfileCompleteness`, real fields only) -- no change. NOT built: the cuisine/venue nudge for
  Food-group interests (needs a new nudge surface; awaiting an explicit go). Jest 656/656.
- **Cuisine/venue prompt built (2026-09-18):** `DiningPreferencesPromptModal` + a dismissible Home card, offered only
  when the user has a food_drink interest, no cuisine/venue tastes, and hasn't dismissed
  (`shouldOfferDiningPrompt`). Writes the same `profiles.cuisine_preferences`/`venue_preferences` ProfileScreen
  edits (one store, two entry points). Dismiss is permanent, per-user, AsyncStorage.
- **Phase 5 live verification (2026-09-18, production, one rolled-back transaction, no push triggers fired, zero
  rows left behind -- confirmed):** disposable auth user + profile: (1) every onboarding-group tag stores in
  `profiles.interests` (no CHECK rejects the canonical vocabulary); (2) the server push-candidate predicate
  (`interests @> array[tag]`) matches a declared tag (Coffee) and rejects an undeclared one (Networking);
  (3) `notify_things_to_do_categories` narrowing excludes Coffee once only Yoga is selected, null = all interests;
  (4) dining prefs writable. NOT verified live: client-side surfaces (Discover ordering, People default, Home
  card, onboarding steps) -- unit-tested / parse-checked only; no device.
