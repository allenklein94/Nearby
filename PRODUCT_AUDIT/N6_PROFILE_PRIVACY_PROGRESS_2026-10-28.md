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
- [x] 4. Edge functions using a user-scoped client checked
- [x] 5. Journeys: new `profileColumnPrivacy` (ordinary users: select *, named columns, views, RPCs; own row read/edit); all journeys with prelude; appVersionCompatibility (build 86 + new build, before/after)
- [x] 6. Signed-in real-API live test (dedicated test account) ready for after deploy
- [x] 7. From-scratch replay + grants snapshot
- [x] 8. Docs: migration, rollback, results, build 86 limitation + rollout requirement

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

## Results (2026-10-28, after restart; nothing deployed, production unchanged)
- SECURITY INVOKER audit (prod, read-only): 0 invoker functions in public/private read `profiles` (all are SECURITY DEFINER);
  the only invoker view was `people_visible_to_me` (0348 rebuilds it owner-run + narrowed); policies in every schema that
  read private columns: 39 on public + 3 on storage.objects, all rewritten to own-row helpers by 0348; the 3 left (2 storage
  photo/voice, profile_photos) read only public columns (id, photo_verified). Re-run on the replay: same (0 invoker fns,
  the 2 narrowed views only).
- Edge functions: all read profiles with the service key; the two user-scoped clients (business-ai-assistant,
  screen-business-content) only call RPCs (SECURITY DEFINER) and insert brand_offers / business_updates (policies rewritten).
- Sign-up: the upsert (needs SELECT on every set column) replaced by `saveMyNewProfile` (insert; on 23505 update the same
  fields). Escalation check (journey `profileColumnPrivacy`, "sign-up path"): insert with is_admin / is_premium /
  photo_verified / managed_partner_id / bonus_notices / id_verified -> all neutralised once 0349 is live; the retry's update
  with the same fields -> neutralised in every state (prevent_self_premium_edit today, + 0349/0350). BEFORE 0349 a signed-in
  INSERT still keeps privileged values (the existing B1 finding, not new; the new code adds no capability a direct REST call
  lacked) -> deploy 0349 right after 0348.
- Reopen guards: Jest `myProfileReads.test.js` scans every migration >= 20270348 (table-wide grant, private column grant,
  new view over profiles, publication, default privileges); journey checks the live DB (only the two views read profiles,
  no invoker function does, profiles not in realtime).
- Journeys on prod (sequential, no throttling): no prelude 727/738, 0348 prelude 727/738 (the same 11 = trustSafety's
  fixes that only exist in 0349-0354, expected), 0348-0354 prelude 740/740; profileColumnPrivacy 11/11 in all three states.
- From-scratch replay: 478/478 migrations; journeys 740/740 (after the replay script's auth.sessions grant fix, an
  environment gap: the image's stand-in table was owned by supabase_admin); all 4 concurrency scripts pass.
- Grants: prod + 0348-0354 (rolled back) == replay, 3203 lines, identical md5. prod -> replay diff = intended only: removed
  authenticated SELECT on profiles + authenticated writes on people_visible_to_me; added the 21 column grants (19 public +
  id_verified + suspended_at) and the new functions of 0348-0354.
- Existing accounts (prod, rolled back, 0348-0354): 4/4 profile rows unchanged (only the 3 new columns at defaults); each of
  the 4 accounts reads its own row via get_my_profile(); people_visible_to_me answers for each.
- Jest 519 suites / 7058 tests pass. Live signed-in tests (dedicated account, read-only) pass in today's state
  (n6Live false: `select *` on other rows returns 3 = today's exposure); they flip to the N6 assertions after deploy.

## Deployment sequence (each step needs its own owner approval; nothing done)
1. New iOS build from this commit or later (works before AND after 0348) installed on every device that signs in.
   Build 86 after 0348: its own-profile select('*'), Dating read (birthdate), ViewProfile and sign-up upsert are REFUSED
   (fails closed, never more data); its edits, push and Friends Browse keep working. All 8 accounts are the owner's.
2. `npm run migration:deploy -- supabase/migrations/20270348_profile_column_privacy.sql --target=prod` (approval code per
   file). Then: journeys without prelude, `profileColumnPrivacySignedIn.live.js` + `pushTokenPrivacySignedIn.live.js`
   (should report n6Live true and pass), app check on the phone (own profile, Edit Profile, Dating, Friends, ViewProfile, Plans).
3. 0349 immediately after (closes the privileged INSERT), then 0350, 0351; 0352-0354 after Session B (owner).
Rollback: `scripts/rollback/20270348_profile_column_privacy.rollback.sql` (proven: apply+rollback == prod fingerprint);
rolling back reopens the exposure.

## Open (owner decisions, not blockers for the migration itself)
- Dating view still returns `wide_area` (coarse area, ~0.1 deg) for opted-in Dating people (Browse filters on it).
- Not verifiable before deploy: the real API after 0348 and the app on a phone.
