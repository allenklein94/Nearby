# N6 profile column privacy: progress tracker (owner approved Option 1, 2026-10-28)

Production stays unchanged until the owner separately approves the deploy.

## Plan
- [x] 0. Renumber the six undeployed fixes up one (0348-0353 -> 0349-0354) so N6 = 20270348 deploys first (deploy.js = number order)
- [x] 1. Migration 20270348_profile_column_privacy.sql (drafted; applies cleanly on prod in a rolled-back prelude)
  - [x] own-row helpers for policies (managed partner, premium, gender), partner-owner block check
  - [x] rewrite the 39 policies on other tables that read private profile columns
  - [x] revoke table SELECT on profiles from authenticated; grant only public-profile columns
  - [x] get_my_profile() = the caller's whole own row (own reads)
  - [x] people_visible_to_me narrowed (age not birthdate, hidden fields nulled); dating view rebuilt (age not birthdate)
  - [x] get_friend_dining_preferences(friend) for the occasion-planning read
- [ ] 2. Later fixes (renumbered) grant their new columns (id_verified, suspended_at)
- [ ] 3. Client: one own-profile reader (rpc with fallback on today's DB); every own-row read moved; others' reads checked
- [ ] 4. Edge functions using a user-scoped client checked
- [ ] 5. Journeys: new `profileColumnPrivacy` (ordinary users: select *, named columns, views, RPCs; own row read/edit); all journeys with prelude; appVersionCompatibility (build 86 + new build, before/after)
- [ ] 6. Signed-in real-API live test (dedicated test account) ready for after deploy
- [ ] 7. From-scratch replay + grants snapshot
- [ ] 8. Docs: migration, rollback, results, build 86 limitation + rollout requirement

## Notes
- 2026-10-28 (after restart): guard `src/services/myProfileReads.test.js` + `services/myProfile.js` (`readMyProfile`) +
  `constants/publicProfileColumns.js` written; guard lists 86 client violations still to move (step 3).
- `pushTokenPrivacy` journey made N6-aware (a private-column read = 42501 after N6, null before); 6/6 with and without prelude.
