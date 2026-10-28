# N6 profile column privacy: progress tracker (owner approved Option 1, 2026-10-28)

Production stays unchanged until the owner separately approves the deploy.

## Plan
- [ ] 0. Renumber the six undeployed fixes up one (0348-0353 -> 0349-0354) so N6 = 20270348 deploys first (deploy.js = number order)
- [ ] 1. Migration 20270348_profile_column_privacy.sql
  - [ ] own-row helpers for policies (managed partner, premium, gender), partner-owner block check
  - [ ] rewrite the 39 policies on other tables that read private profile columns
  - [ ] revoke table SELECT on profiles from authenticated; grant only public-profile columns
  - [ ] get_my_profile() = the caller's whole own row (own reads)
  - [ ] people_visible_to_me narrowed (age not birthdate, hidden fields nulled); dating view rebuilt (age not birthdate)
  - [ ] get_friend_dining_preferences(friend) for the occasion-planning read
- [ ] 2. Later fixes (renumbered) grant their new columns (id_verified, suspended_at)
- [ ] 3. Client: one own-profile reader (rpc with fallback on today's DB); every own-row read moved; others' reads checked
- [ ] 4. Edge functions using a user-scoped client checked
- [ ] 5. Journeys: new `profileColumnPrivacy` (ordinary users: select *, named columns, views, RPCs; own row read/edit); all journeys with prelude; appVersionCompatibility (build 86 + new build, before/after)
- [ ] 6. Signed-in real-API live test (dedicated test account) ready for after deploy
- [ ] 7. From-scratch replay + grants snapshot
- [ ] 8. Docs: migration, rollback, results, build 86 limitation + rollout requirement

## Notes
(filled in as each step finishes)
