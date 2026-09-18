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
