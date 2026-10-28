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
- [x] 2. Later fixes (renumbered) grant their new columns (id_verified, suspended_at)
- [x] 3. Client: one own-profile reader (rpc with fallback on today's DB); every own-row read moved; others' reads checked
- [ ] 4. Edge functions using a user-scoped client checked
- [ ] 5. Journeys: new `profileColumnPrivacy` (ordinary users: select *, named columns, views, RPCs; own row read/edit); all journeys with prelude; appVersionCompatibility (build 86 + new build, before/after)
- [ ] 6. Signed-in real-API live test (dedicated test account) ready for after deploy
- [ ] 7. From-scratch replay + grants snapshot
- [ ] 8. Docs: migration, rollback, results, build 86 limitation + rollout requirement

## Notes
- 2026-10-28 (after restart): guard `src/services/myProfileReads.test.js` + `services/myProfile.js` (`readMyProfile`) +
  `constants/publicProfileColumns.js` written; guard lists 86 client violations still to move (step 3).
- `pushTokenPrivacy` journey made N6-aware (a private-column read = 42501 after N6, null before); 6/6 with and without prelude.
- 2026-10-28: step 2 DONE: 0350 grants id_verified, 0351 grants suspended_at; 0350 + 0352 view rewrites rebased onto N6's
  narrowed owner-run views (they recreated the old wide security_invoker views = would have re-opened N6); their rollbacks too.
- Step 3 DONE: every own-row read -> readMyProfile; ViewProfile + Dating reads -> views with `age` via `services/peopleRead.js`
  (`selectPeople`: pre-N6 42703 -> birthdate read shaped like the new view); preferencePolls -> get_friend_dining_preferences
  (old read only when the function is missing). Guard myProfileReads 4/4; peopleRead.test 8/8; full Jest 518/519 before the
  idVerifiedColumn guard fix (now passes).
- 0348 rollback `scripts/rollback/20270348_profile_column_privacy.rollback.sql` written from prod definitions; proven:
  apply+rollback fingerprint == prod (policies, views, options, grants, column grants, functions).
- Journeys with 0348 as prelude (before client/journey fixes): 710/727; failures = trustSafety (needs 0349-0354 prelude,
  expected), datingConsent/friendDiscoveryChoice (fixed to be N6-aware), appVersionCompatibility (made N6-state aware:
  build 86's own select('*'), Dating (birthdate) and ViewProfile are REFUSED after N6 -> rollout requires the new build first).
- NEXT: run changed journeys with no prelude / 0348 / 0348-0354; write `profileColumnPrivacy` journey (step 5); steps 4, 6-8.
- Open note: dating view still returns wide_area (Browse filters on it) for opted-in Dating people; flag for owner.
