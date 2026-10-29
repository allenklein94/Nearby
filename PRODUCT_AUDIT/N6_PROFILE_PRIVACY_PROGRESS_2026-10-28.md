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

## Status: N6 READY for the staged deployment below (2026-10-28); no further N6 expansion (owner)

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

## wide_area decision (owner, 2026-10-28) BUILT
- Dating view keeps `wide_area` (Browse filters on it), but 0348 section 7 adds check `profiles_wide_area_coarse`: only the
  0.1-degree bucket the app writes (`wideAreaLabel`), so no client can store exact coordinates there for daters to read.
  Prod: 2 values set, 0 violate it. Journey `profileColumnPrivacy`: coarse write accepted, precise write refused (23514) after N6;
  two journey fixtures with 2-decimal values corrected to the app's shape. Rollback drops the constraint (apply+rollback in a
  rolled-back transaction: constraint, helpers and table SELECT back to prod). Journeys: 0348-0354 prelude 740/740; changed
  journeys 43/43 with no prelude and with 0348 alone; Jest 519/7058.
- Final verification (owner checklist, 2026-10-28, after commit dfbd9c49; nothing deployed):
  1. From-scratch replay with the updated 0348: 478/478 migrations; journeys 740/740 on it; all 4 concurrency scripts pass.
  2. Constraint present + validated after every later migration (0349-0354 only READ wide_area; none drops/replaces it).
  3. Direct writes as a signed-in user (replay DB): sign-up INSERT with exact coordinates refused (23514), coarse accepted;
     UPDATE accepted for -33.9,151.2 / 33.9,-151.2 / -0.1,-0.1 / -0,-0 / 40,-75 / 179.9,-179.9; refused for 2+ decimals
     (26.55,-80.06, 26.5512,-80.0634, -33.87,151.21), a space, trailing text, exponent, non-numbers; the trusted/server
     path is refused too (a CHECK binds every writer); other profile edits unaffected.
  4. Dating Browse (`datingConsent` browseArea, filters on wide_area), Friends distance (`peopleMatch`, `friendDiscoveryChoice`)
     pass in all states; prod with 0348-0354 (rolled back): 4/4 profiles' id+wide_area identical before/after, 2 set, constraint validated.
  5. Grants: prod + 0348-0354 (rolled back) == replay, 3203 lines, md5 63f195e0340d418457665b177200f15b.
  6. Approval code for the committed 0348: `20270348:12372a270d356266336f3163bf2f53afd84611dad4be1c8edfb610089585a515`.
- Limit (owner, 2026-10-28): the rule enforces the intended coarse representation (one decimal ~ 11 km north-south, less
  east-west away from the equator); it is approximate location, never a guarantee of anonymity. The pattern checks shape,
  not range (an out-of-range number is not more precise).
- Range validation (owner, 2026-10-28): DEFERRED follow-up, not part of N6. Checked: no crash or exposure path: the rule
  guarantees a numeric parse, the friend-distance SQL clamps acos's input to [-1, 1], the client reads with Number();
  an out-of-range value only gives that person's own row a wrong distance. N6 development FROZEN.

## Open
- Not verifiable before deploy: the real API after 0348 and the app on a phone.

## Installed-client inventory before 0348 (2026-10-29, read-only on prod; owner: active installs, not invitations)

Evidence: `auth.sessions` (live sessions + user agent), `private.push_tokens` (one Expo token per device; tokens compared, never
printed), `auth.users.last_sign_in_at`, `profiles.last_home_visit`. TestFlight testers/installs are NOT visible from here.

| Client | Evidence | Version | Must upgrade before 0348 |
|---|---|---|---|
| Owner's iPhone (the ONE device holding a push token) | all 3 tokens (phone login ..45, phone login ..74, applereview) are the same Expo token = one device; live session of phone login ..45, user agent `Nearby/86`, active 2026-10-28 | build 86 | YES: install build 87, sign in once per account used on it |
| Business website (`docs/business/`, GitHub Pages) | published bundle last exported 2026-10-23 (f4726d9f), 8 `select('*')`, 0 `get_my_profile` = pre-N6 reads | pre-N6 web | YES: regenerate the export from current main and publish it (needs owner approval: outward-facing) before 0348 |
| gmail ..5853 web session | live session from 2026-07-15, iPhone browser user agent, no profile, not refreshed since | web (served by whatever the website is) | covered by the website re-export |
| Dedicated test account (gmail ..f76c) | signed in 2026-10-28 by the live tests, signed out, no session | scripts | no |
| Other 5 auth rows | no profile, no session, no token (abandoned sign-ups / test rows) | none | no |

Unknown from here (owner checks in App Store Connect): (1) TestFlight > testers: who has INSTALLED (installs/sessions columns),
not just invited; any installed build 86 that keeps connecting = upgrade or remove before 0348; (2) whether build 86 is
released on the App Store publicly (a public install that signs up after 0348 would be refused). Production has no account
outside the owner's own, so no other installed copy has ever signed in.

### Follow-up checks (2026-10-29, read-only; owner: do not assume no sessions = no installs)
- EAS build list: iOS production/store builds 77, 79, 80, 83, 84, 86 exist (86 = 7d72d615, 2026-10-18; 87 not started); no
  Android build. Any of them could still be installed through TestFlight; every pre-87 build has the old profile reads.
- Gateway logs, last 7 days (`logs`, source edge_logs, user agent = last field of event_message): the ONLY app user agent is
  `Nearby/86 CFNetwork/3860.700.2 Darwin/25.6.0` (4,612 requests, 2026-10-22..10-28, one OS/device type); no other build, no
  browser traffic to the business website. Evidence of what CONNECTED, not proof nothing else is installed.
- Not visible here: TestFlight tester installs and App Store release status (App Store Connect only; owner to check).
- Business website export prepared from main (1af87365+), NOT published, kept in the session scratchpad (regenerate with the
  convention command if lost): new bundle has `get_my_profile` (1) and 0 profile `birthdate` reads (published one: 0 / 2),
  reads people through the views. Headless render, all Supabase requests blocked: old and new both show the Sign in screen
  (phone code), same 2 pre-existing navigation console errors in both (not new). Signed-in business pages are NOT tested
  headless (needs a real business sign-in): after publishing, the owner signs in on the live site and opens Home,
  Opportunities, Bookings, Offers, Profile before 0348. Business-facing code changed since the 2026-10-23 export: N6 reads,
  one business-application screen by state (ec0b06f0), request deadlines/Reopen/posting refusals (ideas 384/393-395).
