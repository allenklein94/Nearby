# Staging iPhone onboarding findings (2026-11-22)

Found during the owner's first run of the Nearby Staging iPhone app (staging Supabase `nearby-staging`).
Owner APPROVED all as post-Tier-1 work (2026-11-22). NOT built; no app, server or production change. Do not implement
before Tier 1 passes; each item still needs its own build ask.

## Post-Tier-1 work (priority order)

1. **Custom interests silently lost (BUG, fix).** `mapAnythingElse` (`src/constants/onboardingInterests.js`) splits only on
   `, ; / newline "and" "+"`. Checked by running the real function (2026-11-22):
   - `Pickleball, hockey, board games` -> Pickleball, Sports, Board Games
   - `pickleball\nhockey\nboard games` -> same (new lines already work)
   - `Pickleball hockey board games` -> **Pickleball only**; "hockey board games" is dropped AND not listed under
     "Not matched yet", so the person is never told.
   Requirement (owner): never silently discard an interest; keep comma + newline separation; clearly show every entry
   that wasn't recognized. Hint copy (`ui.onboarding.optionalTypeAFewThings`) shows a comma example but never says commas
   separate entries.
2. **Social preference can't be changed after sign-up (gap, fix).** `social_comfort_level` is saved (onboarding ->
   AsyncStorage -> `CompleteProfileScreen` writes it to the profile, so it survives phone sign-in) and USED: Home ranking
   bonus + reason line when a gathering's `group_size_feel` matches (`constants/socialComfort.js`,
   `services/homeRecommendations.js`); ranking only, never hides; 'open' = neutral. No screen edits it afterwards.
   Requirement (owner): keep the onboarding question and its ranking behaviour; add a way to change it later WITHOUT a new
   standalone screen (e.g. inside an existing Profile/Settings section).
3. **Social preference wording (copy, fix).** Subtitle `ui.onboarding.itHelpsUsSuggestThe` mentions Dating when the person
   chose Dating/Both. Remove the Dating-specific explanation; say the preference shapes social plans generally (11 languages,
   native review).

## Kept as is (owner, 2026-11-22)
- **Hockey -> Sports:** intentional (`constants/categorySynonyms.js`; V1 taxonomy frozen, no Hockey category). Do not reopen.
- **Notification permission later:** the six onboarding switches are Nearby's own preferences; the iOS prompt comes later
  by design. Unchanged.
- **Onboarding stays skippable:** every preference step is optional; only phone sign-in (and, for local results, location)
  is needed for the app to work.

## Staging phone sign-in (resolved, no change)
"We couldn't complete that right now" on a real number = staging has no SMS provider by design; Auth returns 500
"Unable to get SMS provider" for any number except the one test number (`STAGING_TEST_OTP_2026-11-21.md`).
Reproduced 2026-11-22 (fictional non-test number: 500; test number: 200). Sign in with (561) 555-0177 + the code in
`/workspaces/.nearby-verify/staging-test-otp.json` (valid until 2026-11-28 15:23 UTC).
