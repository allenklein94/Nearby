# Trust & safety launch-blocker fixes (owner approval 2026-10-27)

Built and tested in isolation. **Nothing deployed**: no migration applied to production, no edge function deployed, no
identity document deleted, no live account permission changed. Every production test ran inside a transaction that was
always rolled back (verified afterwards: no new column, trigger or table exists in production).

Source audit: `PRODUCT_AUDIT/TRUST_SAFETY_AUDIT_2026-10-27.md`.

Renumbered again 2026-10-28 (nothing deployed): N6 became `20270348` so it deploys first (owner priority); the six fixes below moved up one more, to 0349-0354.

Renumbered 2026-10-27 (nothing was deployed): N1 became `20270347` so it can go live first; the six fixes moved up one
(`deploy.js` refuses a version lower than one already recorded, so deploy order = number order).

## What was built (one migration per fix, deploy in this order)

| Migration | Fix | What it does |
|---|---|---|
| `20270347_push_tokens_server_only` | N1 | Device push tokens and Spotify tokens are never readable by another user. They move to `private.push_tokens` (no client access) and `spotify_connections` (owner-only). The `profiles` columns stay but are always NULL (check constraint); a client write to them is moved into the new table by a trigger (`UPDATE OF` the column, so a logout's `= null` still clears it). `push_token_for_delivery()` = the one reader, service role only. anon loses SELECT on `profiles` (it was refused only by accident). The 3 stored tokens move; no other profile value changes. |
| `20270349_verification_self_grant_guard` | 1 | Nobody grants themselves verification or admin. Profile INSERT by a signed-in user starts every privileged column at its default (**new finding, proven: a brand-new account could create its own profile as admin + premium + verified**; admin = read every report and ID image, approve IDs). `photo_verified` only true -> false from the client; a new photo resets it and must be in the person's own folder (main + extra photos). ID submissions: INSERT only as pending/unreviewed, paths in own folder, one pending per person. An admin can never review their own submission. `swap_main_photo` = the one way to set an extra photo as main (each photo keeps its own screening result). |
| `20270350_identity_verified_separate` | 3 | New `profiles.id_verified` (+ `id_verified_at`), set only by `admin_approve_id_verification`, never by the person or photo screening. Approving an ID no longer marks the photo screened. `photo_verified` keeps meaning "main photo passed screening" and keeps controlling profile visibility (5 read policies use it; unchanged). Views + Friends Browse return `id_verified`. |
| `20270351_account_suspension` | 2 | `profiles.suspended_at` (only via the two admin functions). `admin_suspend_user(user, reason, report, end_sessions = true)`: admin only, never yourself, reason required, report must be about that account; hides the profile, ends sessions + refuses sign-in (`auth.users.banned_until`, which Supabase Auth enforces), records the action. `admin_reinstate_user(user, reason)`: restores the earlier hidden choice, lifts the ban, records it. `account_moderation_actions` = audit trail (admins read, nobody writes from a client). A suspended person's inserts/updates on 24 social tables are refused (`account_suspended`) whatever the path (app, direct API, server function acting for them). A suspended host's gatherings stay visible to people already in them, never to anyone new (so nobody new can join). Reports, blocks, deleting own content stay possible. |
| `20270352_phone_required_for_social` | 5 | Without a verified phone (`auth.users.phone_confirmed_at`, i.e. SMS-confirmed): no 1:1 / gathering / community / plan chat messages, photo comments, questions to a host, waves, friend requests, invitations, hosting a gathering or starting a community (`phone_required`, 11 tables, INSERT). Absent from Dating discovery, Friends Browse and Friends Crossed Paths (`person_discoverable`). Still allowed: browsing, joining / marking Interested, accepting what others send, the whole business side, asking businesses. Email sign-up stays available. |
| `20270353_crossed_paths_push_consent` | 6 | The crossed-paths push names the other person only when both are discoverable (`person_discoverable`), the other's profile is visible, there is no block either way (the old trigger's block check could never work: it ran with no signed-in user), both opted into the SAME pool (both Dating, or both open to friend discovery), and the recipient's proximity notifications are on. Otherwise no push at all (never a nameless one: the push data carries the other person's id). |
| `20270354_id_verification_upload_limits` | 4 (part) | id-verification bucket: images only (JPEG/PNG/WebP/HEIC/HEIF), 10 MB each. |

Dependencies: 0350 needs 0349; 0351 needs 0350; 0352 needs 0351; 0353 needs 0352. 0347 and 0354 are independent of the
others (by number they still deploy in order).

App changes (ship with a new build; harmless before the migrations except where noted):
- Verified badge + "Verified only" filters read `id_verified` (ViewProfile, Dating cards + filter, Friends cards + filter;
  `proximity.js`, `friendDiscovery.js`). **Needs 0350 live first** (the selects name the new column).
- "Set as main photo" calls `swap_main_photo` (**needs 0349 live first**). New finding: the old client update could never
  have worked, `profile_photos.photo_verified` has no client UPDATE grant, so it failed halfway in production today.
- Admin Reports: Suspend calls `admin_suspend_user` with the report, says what the server actually did, offers Reinstate
  (also on resolved reports). **Needs 0351 live first.**
- `presentRecoverableError`: hints `phone_required` / `account_suspended` read as their rule (2 new strings, 11
  languages, 10 machine-authored: native review needed), never Try Again.
- `delete-account` edge function (NOT deployed): also deletes every file in the person's own id-verification folder
  (uploads that never got a submission row).

## Tests

- New journey `trustSafety` 11/11 with the six migrations as a rolled-back prelude on production, every attempt as an
  ordinary signed-in user (or the admin) under the real `authenticated` role.
- All journeys with the prelude: 717/717 after updating 3 journeys whose expectations the fixes deliberately change
  (`datingConsent`: the view gains `id_verified`; `friendDiscoveryChoice`: its people now sign up with a screened photo,
  Friends Browse applies the visibility rule; `sightingExpiry`: its two people chose Dating, the push now needs a shared pool).
- Journey actors now sign up with a verified phone like a real app sign-up (`journeyHarness.js` + 19 journeys that create
  users directly; a fictional 1555 number derived from the id).
- Rollback: applying all six and then the six rollback scripts (newest first) leaves production's schema identical to
  before (functions, policies, views, triggers, columns, table + column grants, relations, buckets; set comparison,
  rolled back). Rollbacks: `scripts/rollback/20270349..20270353_*.rollback.sql`.
- Existing data: unchanged by the migrations (profile rows byte-identical before/after, rolled back).
- Jest: 515 suites / 7034 tests pass; journeys 717/717 with the six migrations as a rolled-back prelude (re-run 2026-10-27).

Not covered (device / live only): Supabase Auth actually refusing a banned sign-in; the Storage API enforcing the bucket
limits on a real upload; the admin screens and the two new messages on a phone; `delete-account` (not deployed).

## Impact on existing accounts (rolled-back apply on production)

| Account | After |
|---|---|
| Phone-login primary (admin, Coastal Coffee) | Unchanged |
| Second phone account | Unchanged |
| applereview (phone verified) | Unchanged (App Review keeps every social feature) |
| Email account d15758e7 (the business-owner test account) | Loses consumer social actions and discovery; business side unchanged |
| All 3 current "Verified" badges | Disappear (they came from photo screening; 0 ID submissions exist) |

## Owner decisions (2026-10-27)

1. **20270352 (verified phone) stays deferred until after Session B** so the approved seed (7530ef9b5bb4) keeps working.
   Because deploy order = number order, 0353 (needs 0352) and 0354 wait with it. No external user joins before the full
   set + a compatible build are deployed and verified.
2. **ID image retention = implementation target** (approved 7 days / rejected 30 days / never reviewed: auto-reject +
   delete after 60 days / orphan uploads 24 h / account deletion: whole folder). NOT BUILT yet (after Session B in the
   owner's order). Before automatic deletion is enabled: legal/privacy review (incl. whether rejected documents must be
   kept longer for disputes or fraud prevention), proof the job can't touch an active (pending / under review)
   submission, tests of the delete and failure-recovery paths. No existing production file is deleted without separate
   approval.
3. **Suspended people keep their privacy rights:** a documented support process for access, export and deletion
   requests, with identity verification and lawful retention exceptions. Proposed wording below; NOT published
   (`docs/privacy.html` is public; publishing needs your go-ahead and a support address).
4. **N1 fixed now** (above, 20270347). Built and tested; not deployed.

### Proposed Privacy Policy addition (draft, not published)

> **If your account is suspended.** You can still ask us for a copy of your personal data, or for its deletion, by
> emailing [support address]. We will first confirm the request comes from the account holder (for example, from the
> email address or phone number on the account). We may keep information we are required to keep by law, or need to
> keep to handle a safety report, a dispute or to prevent fraud; we will tell you what we keep and why.

## N1 results (2026-10-27)

Proven on production before the fix (read-only, rolled back):
- a signed-in user read 2 other accounts' `expo_push_token` from `profiles`; `people_visible_to_me` lists the same
  columns (`expo_push_token`, `spotify_access_token`, `spotify_refresh_token`, `spotify_token_expires_at`);
- `send-push` posts to Expo with no access token, so a token alone is enough to send a Nearby-looking push;
- anon: refused, but only because the admin read policy calls `check_is_admin`, which anon can't execute. Granting that
  function would have made every visible profile, tokens included, public.

Audit of every dependency:
- database: no function, view (other than `people_visible_to_me`'s column list) or trigger reads the token columns;
- edge functions: only `send-push` reads `expo_push_token` (service role); 10 others read `profiles` with the service
  role, unaffected;
- client: `notifications.js` writes the token (register + logout), `spotifyAuth.js` reads/writes its own Spotify
  tokens, Settings + Profile read their own row with `select('*')` (so column-level grants would have broken build 86:
  rejected in favour of always-NULL columns);
- other token-like columns: `occasion_group_plan_participants.guest_token` has a client grant but RLS with no policy
  (no rows readable); `plan_shares.guest_token` has no client grant.

Fix tests:
- journey `pushTokenPrivacy` 6/6 with 20270347 as prelude, 0/6 on production today (it catches the hole): another
  person's profile + view row readable but tokens NULL; no token anywhere in `profiles`; `private.push_tokens` and
  `push_token_for_delivery` refused to clients and anon (42501), answered for the service role; register / unrelated
  edit / logout work; nobody writes another's token; Spotify own-row only, old + new write paths; the constraint refuses
  a token even with the trigger disabled;
- `send-push`: `sendPushTokenSource.test.js` runs the real handler: token from the function; no stored token = no push
  (the old column is not consulted); before the migration it falls back to the column; the Expo send is signed only when
  `EXPO_ACCESS_TOKEN` is set;
- data (production, rolled back): 3/3 tokens moved, 0 other profile values changed; the rollback restores all 3.

## App version x database compatibility (2026-10-27)

Journey `appVersionCompatibility` replays build 86's exact requests (commit 7d72d615) and the new build's reads as
ordinary users. It passes in all three states: production today, 20270347 alone, all seven.

| | DB today | + 20270347 | + all seven |
|---|---|---|---|
| Build 86 (installed) | works | works (token write lands server-side; Spotify can't read its tokens back: 0 accounts use it) | works; its old badge still means "photo screened"; its old "Suspend" still changes nothing (0 rows) and says "Suspended"; without a phone, social writes fail with a generic error |
| New build (Session B) | works: the 3 `id_verified` reads fail with 42703 today, so `selectWithIdVerified` retries without it (no badge). Not usable yet: "Set as main photo" (needs 0349), admin Suspend (needs 0351), Spotify (needs 0347) show an error | works, Spotify too | works fully |

Found and fixed while checking: the new build as committed this morning would have broken Session B. Friends Browse,
Dating discovery and ViewProfile named `id_verified`, which production answers with 42703 "column … does not exist"
(checked live), so they would have come back empty. Now ONE helper `services/idVerifiedColumn.js` retries without the
column only for that error; guard in `idVerifiedColumn.test.js` (every client read naming `id_verified` uses it).

Therefore: external users only on the new build after the full set is live (old builds keep the misleading badge and the
false "Suspended"); the admin uses the new build.

## N1 deployed (2026-10-27, owner approved)

1. `send-push` v25 -> v26 (live v25 = repo before N1, bundler formatting only). Test push A (old column path): Expo ticket
   + receipt `ok`.
2. `20270347` via `deploy.js`: applied 2026-10-27 23:32:38 UTC, sha 568a1c0f…, commit a0976a3d, ledger row recorded;
   `migration:status` agrees.
3. Production checks:
   - tokens: 3/3 in `private.push_tokens`, md5 identical to the pre-deploy snapshot; 0 tokens left in `profiles` (constraint
     `profiles_client_secrets_never_stored` present);
   - permissions (catalog): anon + authenticated have no usage on `private`, no SELECT on `push_tokens`, no EXECUTE on
     `push_token_for_delivery` (service role only); `spotify_connections` = one policy, own row, authenticated only;
   - real API, signed out (public key): profiles / people_visible_to_me / spotify_connections / the reader = 42501, `private`
     not exposed (PGRST106);
   - `people_visible_to_me` still lists the old columns, but they come from `profiles` and are always NULL;
   - journeys on prod without prelude: `pushTokenPrivacy` 6/6, `appVersionCompatibility` 4/4 (build 86 + new build),
     full run 716/727: the 11 failures are `trustSafety` (tests 0349-0354, not deployed; 11/11 with the prelude);
     `datingConsent` step 6 expected 0350's `id_verified` column and now accepts both states;
   - test push B (new server-only path): Expo ticket + receipt `ok`.
4. Push delivery VERIFIED: the owner confirmed both "Nearby check (1 of 2)" and "(2 of 2)" appeared on the iPhone
   (2026-10-27). NOT verified: a signed-in real-API probe
   (no dedicated test account exists; ready as `src/qa/pushTokenPrivacySignedIn.live.js`, read-only, skips without an account); real Spotify sign-in (0 accounts use Spotify).
5. Spotify NOT VERIFIED (separate requirement, owner 2026-10-27): no account has ever connected Spotify, so neither a real
   connection (sign-in, refresh, reading its own tokens) nor isolation with populated rows has been tested; the signed-in
   probe only proves no other person's row is visible while the table is empty. Must be verified with a real connected
   test account before external Spotify access, together with the server-side refresh below.
6. Spotify (owner decision): own-row token access accepted for internal testing; before Spotify is enabled for external
   users, token refresh + storage move fully server-side so no client can read a refresh token.

## Deployment plan (each step needs its own approval; nothing done)

1. **`send-push` first** (before 20270347, or every push stops: the old function would read the now-empty column).
   Before deploying: compare the live bundle with the repo source (it must equal the repo minus this change).
2. **20270347** (N1): `npm run migration:deploy -- supabase/migrations/20270347_push_tokens_server_only.sql --target=prod`
   with its approval hash. Can go before Session B; both builds work with it. Then `pushTokenPrivacy` +
   `appVersionCompatibility` without prelude, and one real push to the phone.
3. Optional, defence in depth: turn on Expo enhanced push security, set `EXPO_ACCESS_TOKEN` as a function secret.
4. **New iOS build** (TestFlight) from a commit with `idVerifiedColumn.js` -> Session B (controlled accounts only).
5. After Session B (seed cleaned up): **20270349 -> 20270350 -> 20270351 -> 20270352 -> 20270353 -> 20270354**, one at a
   time in that order, each through `deploy.js` with its own hash; the journeys after each.
6. Deploy `delete-account` (ID folder cleanup). Then the retention job, once its conditions (decision 2) are met.
7. **N6** (below) fixed and deployed.
8. External testers: new build only.

Rollback limits (schema rollback is proven identical; operational rollback is not free):
- 20270347: restores every token into `profiles` (incl. ones registered after deploy), so N1 is open again;
  `send-push` works either way;
- 20270350: drops `id_verified`; approvals made since are lost from the profile (the submission rows keep them);
- 20270351: drops `suspended_at` and the audit table; Supabase Auth bans set since stay until lifted by hand (the
  rollback lists the accounts first);
- 20270352 / 0353 / 0354: no data of their own; a new build keeps working (its badge falls back, `phone_required` hints
  just never occur);
- a rollback of 0349 re-opens self-admin; never roll it back while external users exist.

## New findings while tracing (reported, not fixed)

- **N1 (HIGH): FIXED by 20270347** (built + tested, not deployed; above).
- **N6 (HIGH) UPDATE 2026-10-28: fix BUILT + VERIFIED pre-deploy (migration 20270348, NOT DEPLOYED; owner approved Option 1):** results, deployment sequence and build-86 limits in `PRODUCT_AUDIT/N6_PROFILE_PRIVACY_PROGRESS_2026-10-28.md`. Original finding: the same whole-table read
  exposes other columns. Proven read-only as an ordinary user: other people's exact birthdate, sexual orientation,
  approximate location area (`wide_area`), last Home visit time, which business they manage (`managed_partner_id`), the
  admin flag, dating preferences and time zone. The "hidden" switches (ethnicity, gender) hide only in the app: a set
  value would be readable directly (none set today). Fix proposal: column-level SELECT grants on `profiles` + a narrowed
  `people_visible_to_me` listing only what other people may see (age, not birthdate; hidden fields nulled server-side);
  the app's own-row reads (`select('*')` in Settings + Profile, ~88 client reads to check) move to an own-profile read.
  Build 86 would break on column grants, so it needs a compatible path (e.g. own row through a function) and a build
  before it.
- **N2 (fixed by 0349):** profile INSERT had no privileged-column guard (self-admin, above).
- **N3 (fixed by 0349):** "Set as main photo" failed halfway (above).
- **N4 (small, open):** `moderate-photo` screens the photo path it read, then marks the profile's current photo; a photo
  changed in those seconds could inherit the result. 0349 resets the flag on every client photo change, which narrows it
  to a change made during the screening call itself. Fix = compare the path before writing (edge function change).
- **N5 (open):** after a suspension, the person's current access token stays valid up to 1 hour: reads still work in
  that hour, every social write is refused.

## N6 read-only inventory (2026-10-28, production, nothing changed)

- `profiles`: 107 columns; `authenticated` holds table-level SELECT, i.e. every one of the 107 columns.
- Row policy "Users can view own or verified profiles": own row, or `photo_verified = true AND profile_hidden = false`
  (+ the admin policy). So any signed-in user reads ALL 107 columns of every verified, unhidden profile: 3 of the 4
  profiles today (all the owner's accounts; no external user exposed so far).
- `people_visible_to_me` (the people view, SELECT for authenticated) passes the same columns through: birthdate,
  sexual_orientation, gender / gender_identity / ethnicity incl. their `*_hidden` switches, interested_in_genders,
  dating preferences (ages, heights, hair/eye colours), wide_area, timezone, last_home_visit / last_activity_check,
  is_admin, managed_partner_id, referral_code / referred_by, daily usage counters, notification settings and the
  (now always NULL, N1) token columns.
- Beyond what the 2026-10-27 note listed: `referral_code`, `ethnicity_preferences`, `interested_in_genders`, the
  dating-preference columns, usage counters and notification settings are also exposed.
- Functions: ~many SECURITY DEFINER functions read `is_admin` / `managed_partner_id`, but as authorization checks on
  the caller's own row (not returned). A per-function check of what each RETURNS is part of the fix, not done here.
- Fix shape unchanged: column-level SELECT grants on `profiles` (public-safe columns only), a narrowed
  `people_visible_to_me` (age not birthdate, hidden fields nulled server-side), the app's own-row reads moved to an
  own-profile read; build 86 compatibility path needed. Needs owner approval to build.

## Photo screening pre-deploy check (owner condition for 0348/0349, 2026-10-28; prod, rolled back; NOT fixed)

| Check | Today | With 0348+0349 |
|---|---|---|
| Main photo replaced by direct API update, claiming verified | stays verified, visible | reset to unscreened in the SAME statement (BEFORE trigger); profile + folder hidden from others at once |
| Extra photo inserted claiming verified | accepted as verified | forced unscreened |
| Another user reads an UNSCREENED extra photo row | visible | STILL visible (`profile_photos` read policy gates on the MAIN photo, not the row's own result) |
| Another user lists/reads files in the folder (unscreened extra, a not-yet-applied new main, old/replaced photos) | readable | STILL readable while the main is screened (storage policy is per folder, not per file) |
| Rejected screening (main) | hidden | hidden (stays false) |
| Rejected / failed screening (extra) | row + file readable via API (app filters it, ViewProfileScreen.js:186) | same |
| Failed screening (service error) | no write | no write -> stays unscreened |
| Stale verdict: photo A screened, replaced by B before the verdict lands | A's "safe" marks B verified | same: `moderate-photo` writes by user/row id without checking the path it screened |

Fix BUILT into 0349 (2026-10-28), TESTED, NOT DEPLOYED: a screening result is bound to the exact storage object it
was made on (`profiles.photo_object_id`, `profile_photos.screened_object_id`; a re-upload at the same path = new object id).
Others read a photo row or file only when THAT photo passed on THAT object (`profile_photo_object_visible`, per file, never
per folder); extra-photo rows need their own result; the in-place storage UPDATE policy is dropped (the app always uploads
a new path, never upserts); `moderate-photo` reads its target (`photo_screening_target`) BEFORE the download and records
the verdict only via `record_photo_screening` (service role only; refuses a replaced photo or a new object at the same
path; a rejection always applies). Existing screened photos keep approval, bound to today's file (rolled-back check on
prod: 3/3 main + 9/9 extra bound). Verified: journey `photoScreeningBinding` 6/6 on prod (asserts today's exposure) and
with 0348-0354 as prelude; prod journeys 746/746 with 0348-0354 (without: only `trustSafety` fails, as before: it needs
the fixes); from-scratch replay 478/478 + journeys 746/746 + all 4 concurrency scripts; grants prod+0348-0354 == replay
3208/3208; 0349 rollback restores prod+0348's policies exactly (rolled back); Jest 519/7058.
DEPLOY ORDER: 0349, then the `moderate-photo` redeploy right after (separate approval). Between the two the OLD function
still writes `photo_verified` without an object id = new photos stay hidden from others (fails safe, never exposes).
Not covered: the Storage HTTP API itself (enforces these same policies), signed URLs issued before a rejection/replacement
(valid up to 1 h), the image checks themselves. The 0349 approval code changes (file changed): recompute at deploy.

### Storage API verification + signed-link review (owner, 2026-10-28; NOT deployed)

Real Storage API, pre-deploy (`scripts/replay/storage-api-up.sh` runs Supabase's `storage-api` v1.11.13 against the
from-scratch replay on its internal network; `scripts/replay/photo-storage-api.js`, real JWTs: ordinary signed-in A + B,
signed out): WITH 0349 all checks pass: B can't list, download (authenticated / legacy / public routes, HEAD, info),
sign (single or batch), copy, move, delete or upload into A's pending, rejected, replaced, abandoned or re-uploaded
photos; only A's currently approved files are reachable; replacing or rejecting a photo refuses NEW signed URLs at once;
a late verdict is refused; A keeps (lists, reads, signs) every own file but can't overwrite in place (x-upsert, PUT) or
move; signed out = nothing. WITHOUT 0349 (rollbacks 0354 -> 0349 on the same stack) it measures today's exposure: B lists +
reads + signs A's whole folder (abandoned + rejected incl.), B can COPY A's rejected photo into B's own folder, A can
overwrite / move approved files, a file re-uploaded at an approved path is readable; re-applying 0349-0354 = all pass.
The storage policies were restored byte-identical around the Storage API's own schema migration (md5 compared).
Production baseline, real API, read-only (`scripts/live-verify/photo-storage-signed-in.js`, dedicated test account,
counts only): 4 other folders / 17 files / 7 approved; signed in, 2 NOT-approved files listable AND signable; signed out 0.
After 0349 the same script must show 0 (it fails otherwise).
No other path: the bucket is private (`public = false`); the API exposes only `public, graphql_public` (the storage
schema is not reachable via PostgREST/GraphQL); no `public`/`private` function or view reads `storage.objects`; of the 36
live edge functions only `moderate-photo` (being fixed), `delete-account` (own files) and `export-data` (own paths, no
file access) touch profile photos (`setup-review-account` = a placeholder path); no `getPublicUrl` on profile photos.
Signed links: profile photo URLs were signed for 60 min on every screen load (no cache). Now 15 min
(`PROFILE_PHOTO_URL_LIFETIME_S` in `services/photos.js`, also extra photos), uploads cached no longer (`cacheControl`
900: the Storage API returns `expires` +15 min, checked); every screen re-signs on focus. 15 rather than 5-10 min: the
Dating list signs all rows up front, so a list left open longer shows a row's photo blank until refocus (phone watch).
Guard `services/profilePhotoLinks.test.js` (lifetime, no upsert, no public URL, only these two files read the bucket).
The server already refuses a new signed URL for anything not currently approved (0349); the app needs no other check.
Preserved: existing approved photos (3/3 main + 9/9 extra bound, rolled-back check), own-profile editing (own files),
`moderate-photo` (service role) and moderation via the Supabase dashboard (service role). Jest 520/7062; journeys unchanged
(no DB change in this step; 746/746 with 0348-0354 earlier today).

Remaining limitations (reported, not fixed):
1. A signed URL issued while a photo was approved keeps working until it expires (measured: 200 after replacement and
   after rejection). Now at most 15 min for new links; links issued by build 86 (60 min) until it's replaced. Images
   already downloaded stay in the viewer's device cache. No revocation exists (bearer links); the CDN in front of
   hosted Storage was not testable locally (its cache follows the file's cache-control, now 15 min for new uploads;
   the 17 existing files keep 60 min).
2. FIXED 2026-10-28 (owner; see "Profile visibility governs photos" below): hidden / suspended / blocked profiles'
   photos are no longer signable by a known path. Remaining: links signed BEFORE hiding/blocking work to expiry (item 1).
3. The app has no in-app view of rejected photos for admins; moderators use the dashboard (service role), as before.
4. The hosted Storage API version may differ from the local v1.11.13; the post-deploy production run is the check.

### Profile visibility governs photos (owner, 2026-10-28; folded into 0349, NOT deployed)

Gap: with the committed 0349 a person who knew an approved photo's path could still list, read and sign it after the
owner hid the profile, was suspended, or a block existed either way (and across a block also read the extra-photo rows).
Fix (0349, same file): `profile_photo_object_visible` returns false unless the owner's profile is not hidden (a suspended
account is always hidden: 20270351's suspend sets it and its guard keeps it while suspended) and there is no block
either way (`viewer_blocked_either_way`, the server rule profile reads already use, 0348); the extra-photo row policy adds
the same block check. File screening rules unchanged; the owner's own folder unchanged; moderation = service role
(bypasses RLS), unchanged. No admin exception added (none existed for photos).
Verified: real Storage API (`photo-storage-api.js`, section 8): hidden, A blocks B, B blocks A, suspended = B can't list,
read (all routes), sign (single + batch) A's known paths or read A's extra rows; A keeps read + sign; access returns on
unhide / unblock / reinstate. Against the committed 0349 function the same run FAILS 4/4 (gap reproduced); restored = all
pass. Journey `photoScreeningBinding` 7/7 on prod (asserts today's exposure), 7/7 with 0348-0354 as prelude, and FAILS
with the committed 0349. Prod journeys 747/747 with 0348-0354; from-scratch replay 478/478 + journeys 747/747 + all 4
concurrency scripts; grants prod+0348-0354 == replay 3208/3208; Jest 520/7062. Rollback file unchanged (it drops the
function and restores the row policy verbatim; not re-run after this edit). 0349's approval code changes: recompute.
Residual: a link signed before hiding/blocking returns 200 until it expires (<= 15 min from the new build).

JWT secret exposure (same day): `PRODUCT_AUDIT/JWT_SECRET_EXPOSURE_2026-10-28.md` (legacy HS256 key still trusted;
rotation procedure prepared, NOT done).

Deployment sequence (each production step its own owner approval):
1. Compatible TestFlight build (incl. the 15-min links) installed on every device.
2. 0348 (`deploy.js`).
3. 0349 (`deploy.js`; approval code recomputed from the committed file), then at once
4. `moderate-photo` redeploy (repo source). Between 3 and 4 new photos stay hidden from others (fails safe).
5. Verify on prod: `photo-storage-signed-in.js` = 0 unapproved; journeys without prelude; one real photo upload on the
   phone -> screened -> visible to the second account; a replaced photo hidden at once.
6. 0350-0354 in number order afterwards (0352 after Session B).

## I2 requirements: progressive trust folded into I2 (owner, 2026-10-28; NOT built, design not locked)

Progressive trust decides HOW MUCH activity an account can perform, never whether someone is a better or more
trustworthy person. Requirements for when I2 is implemented:
1. Simple trust levels, nothing visible: New (recently created) = low limits; Established = verified phone + account age +
   normal activity = standard limits; Restricted = suspended / administratively restricted = no social actions (0351).
   Account age alone never unlocks higher limits.
2. Limits target mass unsolicited activity, never legitimate gatherings, invitations, friendships or conversations.
3. Unsolicited outreach (strangers) is limited separately from activity with existing friends, accepted invitations,
   mutual matches and gathering participants (e.g. inviting your gathering's attendees != inviting strangers).
4. Rate limits on repeated profile-name changes and profile-photo replacements (gap found 2026-10-28, not in the audit).
5. Every newly uploaded photo is screened; a past pass never trusts a replacement. TODAY (prod, checked 2026-10-28) a
   replacement keeps `photo_verified` (no reset trigger exists); 0349 resets it on every main/extra photo change.
6. Enforced server-side (database), incl. direct API requests.
7. Clear, friendly limit messages (like the gathering limit's "Try again tomorrow").
8. No AI fraud scoring, device fingerprinting or third-party risk vendors yet.
9. Exact numbers + trust-level rules go to the owner for approval BEFORE implementation.
Existing today: daily limits on gatherings (10), communities, friend requests, notices, stories, AI uses (same for every
account). Missing: messages, invitations, reports, business requests beyond duplicates, name/photo changes.

## Owner input 2026-10-29 on I2 + I1 (PROPOSED additions, not locked, nothing built; numbers + rules to the owner before building)

I2 (progressive trust): already covered by requirements 1-9 above. Proposed additions:
- a. Limits also cover business-like posting by a consumer account (today only gatherings/communities/stories/notices have
  daily caps; promotional content in chats/bios has none).
- b. "Suspicious behaviour tightens limits automatically" = RULE-BASED only (consistent with requirement 8: no AI scoring):
  e.g. repeated limit hits, reports from several distinct people, many refused/blocked outreach -> lower limits until an
  admin reviews; never a hidden score, never a ban without review (0351 suspension stays the admin's action).

I1 (duplicate/fake accounts), widened from "exact-duplicate photos" to FLAG -> INVESTIGATE -> ACTION:
- c. Signals: identical photo bytes (hash, the recorded first step); same verified phone is already impossible (one auth
  user per phone); similar names only as a supporting signal, never alone. Device and behavioural-pattern matching = device
  fingerprinting, DEFERRED with L1 (requirement 8 + priority 7) until real usage justifies it.
- d. A match creates an admin review item linked to both accounts (needs I3's report evidence + action log, so I1 follows
  I3 as already ordered); never an automatic ban or hide, never shown to either person (households, shared devices and
  common names are legitimate).
- e. Privacy: hashes/flags stored privately (no client grant), disclosed in the Privacy Policy before external users.

## Owner decision 2026-10-29: I2 + I1 direction APPROVED with refinements (design only; NOT built, NOT deployed)
Supersedes addition b above where they differ.
I2:
- Two distinct mechanisms: (1) automatic RATE LIMITS on repeated excessive activity (e.g. too many unsolicited messages /
  invitations / business-like posts); (2) ACCOUNT RESTRICTION (Restricted level) only on stronger evidence or human review.
- Reports trigger investigation, never proof: any number of reports alone never restricts an account or lowers its limits
  (protects against malicious mass-reporting).
- Established, mutual relationships (accepted friends, matches, fellow attendees, accepted invitations) get clearly more
  generous limits than unsolicited stranger outreach.
- Server-side only; exact thresholds to the owner for approval before implementation.
I1:
- Start with exact photo hashes + supporting signals; similar names = supporting evidence only, never enforcement alone.
- An identical photo alone does not open a moderation case (stock / shared images): a case needs corroborating evidence
  or a review threshold (rule to the owner with I2's numbers).
- Similar-image (perceptual) detection = later, subject to a privacy review. Device fingerprinting stays deferred.
- No automatic bans or hidden restrictions from duplicate signals alone.
Priority unchanged: build 87 + phone testing -> 0348-0354 -> B5 -> I2 -> I3 -> I1.
Photo abuse (owner input 2026-10-29, recorded, nothing built): the same photo on MANY accounts is a valid review threshold
for I1's exact hashes (count rule with I2's numbers). Generated/manipulated identity photos and stolen public photos
(reverse image search) need an AI or third-party service + a privacy review: DEFERRED with similar-image detection and L1.
Any such result is a signal for review, never proof: a generated avatar is not evidence of a fake person.

## I3 + I2 + I1 BUILT, STAGED, NOT DEPLOYED (owner: build the safe approved work now, 2026-10-29)

Migrations (deploy order = number order, AFTER 0348-0354, each its own approval; none sent to production):
- 20270355 I3: `reports.content_type/content_id` (message, gathering/community/plan/business message, whole 1:1 chat =
  `match_chat`); the server copies the content at report time, read AS THE REPORTER (security invoker: only what they could
  see) and only if the reported person wrote it (else hint `report_content_mismatch`); a 1:1 chat keeps the reported
  person's last 20 messages there; client-sent copies are replaced; the copy survives deletion / disappearing messages;
  evidence frozen after insert (only `resolved` changes, existing column grant); `report_actions` append-only log
  (admins read; every resolve/reopen whatever the path) + `admin_resolve_report(id, no_action|action_taken, note)`.
- 20270356 I2: ONE check `private.enforce_rate_limit` on messages, group chats (gathering + community + plan together),
  business messages, invitations, reports, business requests, name changes, photo changes; counts the rows the person really
  wrote; trust level = suspended -> restricted (0351 refuses), verified phone AND approved account age -> established, else
  new. ENFORCES NOTHING until numbers are approved: `private.rate_limit_rules` empty, `trust_settings` null. Refusal = hint
  `rate_limited` + "You've reached the limit for this for now. Please try again later." (11 languages, 10 machine-authored).
  Reports never touch the reported person's limits; no automatic restriction anywhere.
- 20270357 I1 (revised 2026-10-29: SHA-256 from moderate-photo, see below; the MD5 description that follows is superseded):
  fingerprint = Storage's own MD5 of the file (eTag; multipart skipped); existing photos fingerprinted on
  apply; a case opens only under an approved rule (`account_signal_settings` null = no cases): same file on >= N accounts,
  or same file + similar names (pg_trgm); one open case per file; private schema, admins read via
  `admin_list_account_review_cases` (no fingerprint shown) and close via `admin_close_account_review_case` (outcome +
  note); never bans, hides or limits anyone. Limit: byte-identical files only (resize/crop/re-encode not caught).
App (works on today's DB and after; in build 87 if built from this commit): report sheets attach the long-pressed group /
plan message, the business message, or the 1:1 chat (`utils/reportContent.js`: missing columns or a refused reference =
the same report filed about the person, never lost); chat composer + error copy show phone-required / suspended /
rate-limited as their own sentence (was "check your connection" in chats); admin Reports screen shows the evidence,
resolves with an outcome (plain resolve before 0355) and lists review cases above reports (none before 0357).
Tests: journey `trustSafetyI123` 7/7 (prod, 0348-0357 prelude, rolled back; real roles); prod journeys 754/754 with all ten
as prelude; Jest 522 suites / 7147 tests; rollbacks `scripts/rollback/2027035[5-7]_*.rollback.sql`: apply 0348-0357 +
rollbacks newest first == 0348-0354 alone (sorted catalog fingerprint, 4,574 items: functions + ACLs, policies, triggers,
columns + column ACLs, relations + ACLs, constraints, indexes, cron); iOS JS bundle exports clean with the new code.
Found while testing: admins CAN mark reports resolved today (column grant `reports.resolved` to authenticated);
`information_schema.column_privileges` hides it (read `pg_attribute.attacl`).

### Open decisions FINALIZED (owner, 2026-10-29) and BUILT into the staged migrations (NOT deployed)
Supersedes the proposed table and the open list that were here. Mechanism (0355-0357) and numbers (new 20270358) are
separate migrations, each with its own approval; deploy order 0355 -> 0356 -> 0357 -> 0358, after 0348-0354.

| Decision | Built as |
|---|---|
| Established account | verified phone + account >= 7 days (0358); age alone never qualifies |
| Age never raises unsolicited limits | business messages, business requests, commercial posts: same numbers at both levels |
| 1:1 messages (mutual matches only: no stranger 1:1 path exists) | new 10/min, 200/day; established 20/min, 500/day |
| group chats (members / attendees) | new 10/min, 150/day; established 20/min, 400/day |
| business conversation messages | 5/min, 50/day (both) |
| invitations (friends only) | new 20/day; established 50/day |
| reports | 10/day ordinary (both); urgent safety reasons (Harassment or abuse, Underage user) NOT counted against it, own ceiling 30/day (flood protection only) |
| business requests | 10/day (both) + the existing 10-minute duplicate check |
| business-like posting | `commercial_post` = a PUBLIC gathering / community whose title/name or description carries a link, email or phone number (10-15 digits; ISO dates and clock times stripped; prices never count), when created or when an edit adds it: 3/day, 10/week (both). Ordinary event organizing never counts |
| name / photo changes | name 2 (new) / 3 (established) per 30 days; photos 15 / 20 per day |
| duplicate photos | case when the same file is in use on 3 accounts, or on 2 accounts with similar names (trigram >= 0.5); a similar name alone never; a case never acts on an account |
| fingerprint | SHA-256 of the exact bytes, computed by `moderate-photo` from the file it already downloads (no MD5 / Storage eTag anywhere); recorded only for a photo the account is using (`record_photo_fingerprint`, service role only); a replaced / deleted photo's fingerprint is forgotten; existing photos: `scripts/trust-safety/fingerprint-existing-photos.js` once after 0357 |
| admin notice of a new report | private push `admin_report_received` to each admin ("New report to review" / "N reports are waiting for review.", no name, reason or content), at most one per admin per 15 min (dedupe key), never to the reporter or a reported admin, never mutable (account notice); tap = Admin Reports ("Review Reports" action, 10 languages machine-authored) |
| deleted accounts | reports + evidence copy outlive either account's deletion (FK now ON DELETE SET NULL, `reporter_deleted_at` / `reported_deleted_at` stamped; the evidence-freeze trigger allows only that change); readable by admins only (+ a living reporter's own); every report deleted 12 months after its last resolve (`purge_expired_reports`, daily cron); unresolved reports stay until resolved |

Tests (2026-10-29, nothing written to production): journey `trustSafetyI123` 11/11 (prelude 0348-0358, real roles); prod
journeys 758/758 with all eleven as prelude; Jest 522 suites / 7148 tests; rollbacks 0358 -> 0355 newest first after
0348-0358 == 0348-0354 alone (catalog fingerprint 27c1b59a..., 4,557 items incl. FKs, triggers, cron); iOS JS bundle
exports clean; `migration:status` = 0348-0358 not recorded.
Found while testing (pre-existing, live, NOT fixed): `enforce_gathering_daily_limit` sets `app.trusted_update = true` and
leaves it on for the rest of the request, so any check in the same request that honours that flag is skipped after a
gathering insert. Single-statement PostgREST requests limit the impact; the commercial-post check ignores the flag.
**FIX BUILT + STAGED as 20270359 (owner 2026-10-29, option 1 "restore in each body"; NOT deployed, own approval, after
0358):** all 24 functions that turn the flag on (it was 25 incl. `_rate_limit_commercial_post`, which already restores and is
unchanged) now save the caller's value on entry and put it back right after the guarded write; the seven that reset it to a
bare 'false' (dropping a trusted caller's scope) restore the caller's value instead. A function-level `SET app.trusted_update`
was tried first and is refused by Supabase (custom parameter, non-superuser). Bodies otherwise byte-identical to after 0358;
owner, security, search_path and grants kept. A DO block in the migration refuses to commit if any public/private function
turns the flag on without the save + restore; guard `trustedWriteScopeGuard.test.js` holds later migrations to the pattern.
Tests (2026-10-29, nothing written to production): journey `trustedWriteScope` 5/5 with 0348-0359 as prelude, and 3/5 on
0348-0358 alone (there a person's own `is_premium` / `is_admin` self-grant SUCCEEDS after a gathering insert or after
`spend_bonus_notice`: the leak is real and exploitable within one transaction); prod journeys 763/763 with 0348-0359;
rollback round trip 0348-0358 -> +0359 -> rollback = identical (md5 over every public/private function's definition, ACL
and config, sorted); Jest 523 suites / 7152 tests. Rollback: `scripts/rollback/20270359_trusted_write_scope.rollback.sql`
(re-opens the leak; only if a function misbehaves).

**Authorization-boundary review of the flag (owner, 2026-10-29; nothing deployed or written to production):**
- Real API, signed out AND signed in (dedicated test account, read-only): `rpc/set_config` 404 (PGRST202); `pg_catalog`
  via Content-/Accept-Profile 406 (only public, graphql_public exposed); GraphQL disabled; `set_premium_status` /
  `check_and_increment_ai_use` 401/403 (42501); trigger functions not callable (404). Catalog: anon / authenticated cannot
  log in, no pre-request hook, the only client-executable function with dynamic SQL is an event-trigger function (not
  callable), every flag-setter is SECURITY DEFINER owned by postgres and checks its caller (admin / owner / auth.uid())
  before trust; no client-callable invoker function writes a guarded table; no profiles trigger before the guard sets the
  flag. So through the API nobody can forge the flag, and no single request can chain "trust on" with a client-chosen write:
  0359's leak was proven inside one database transaction, which an API client cannot compose (hardening, not an open API hole).
- BUT the flag itself was forgeable: a session running as `authenticated` that calls set_config can give itself is_admin /
  is_premium (proven on 0348-0359, rolled back); security rested on "no path to set_config" staying true forever.
- **FIX BUILT + STAGED as 20270360 (NOT deployed, own approval, after 0359):** the 12 column guards (prevent_self_premium_edit,
  hosting partner, community status, friendship / match / gathering_interest / gathering_question identity, and 0349-0351's
  photo-screening, privileged-insert, identity-verified, suspension guards) run as the caller (SECURITY INVOKER; none reads a
  table) and protect when the flag is not 'true' OR `current_user in ('anon','authenticated')`. Inside a definer server
  function current_user is postgres, so trusted writes are unchanged; a direct client write is protected with or without the
  flag. DO block + `trustedWriteScopeGuard.test.js` hold later migrations to it. Residual (same class, lower impact;
  CLOSED by 20270361, below): a forged flag also skips the friend-request daily limit and 0356's rate limits (checked inside
  definer functions); reachable only with raw SQL as a client role.
- Tests (real client roles via `set local role` + JWT claims, rolled back): journey `trustedWriteScope` 12/12 with
  0348-0360 (forged self-grant of admin / premium / bonus / business / ID verification refused, forged profile insert with
  powers stripped, anon forge nothing, failed op + nested + friendship + community status protected, admin suspend /
  reinstate, owner pause and counters still work); 3/12 fail on 0348-0359 (exactly the forgery cases); prod journeys
  770/770 with 0348-0360; rollback round trip identical (definitions, ACL, config, security mode); Jest 523 / 7154.
  A signed-in write probe through the real API (PATCH own is_admin) was NOT run (would write to production if it failed);
  the role-switched journey is the same role + claims PostgREST uses.
- Early separation of 0359/0360 from 0348-0358: technically safe (19 of 20 live flag-setters and all 7 live guards are
  byte-identical on prod and after 0358; only admin_approve_id_verification differs, changed by 0350), but the ledger is
  8-digit and strictly ordered with 20270347 the highest recorded, so it needs 0348-0359 renumbered (0348's recorded
  approval code changes) and 0349-0358's own redefinitions would re-open the leak until 0359 runs again. Not recommended:
  no API exploit path exists; deploy 0359 + 0360 immediately after 0358 in the same sequence.
- **Residual closed: FIX BUILT + STAGED as 20270361 (NOT deployed, own approval, right after 0360) (2026-10-29):** the 0356
  rate limits (`private.enforce_rate_limit`), the name / photo change limit, the extra-photo limit and the friend-request
  daily limit no longer skip on the flag. They skip only for a row in `private.trusted_write_marker` for the current
  transaction, written only by `private.mark_trusted_write()` (definer; no client EXECUTE, no client table grant, no client
  USAGE on `private`), set only by `swap_main_photo` and `record_friend_discovery_swipe` (mutual like) inside their 0359 scope
  and removed before the caller's flag is put back (nested calls keep the outer marker; a failure rolls it back). Other bodies
  byte-identical to after 0360. DO block + `trustedWriteScopeGuard.test.js` refuse any later function that skips on the flag.
  Tests (rolled back, real client roles): new journey `forgedFlagLimits` 6/6 with 0348-0361 (6/6 fail on 0348-0360);
  `trustSafetyI123`'s "trusted server writes bypass" step now models a real server write (definer + marker) instead of a
  client role with the flag set (the old step passed only because of this residual; it fails under 0361 as intended);
  prod journeys 776/776 with 0348-0361; rollback round trip (after 0360 -> +0361 -> rollback) identical on 1,347 functions,
  relations and triggers (definitions, ACL, config, security mode); Jest 523 / 7155. Remaining (documented, not fixable in
  the database): raw SQL as a client role could also set `request.jwt.claims`; the API boundary stays the primary control.
- **Security assumption: database access (owner, 2026-10-29; accepted as an assumption, no further migration for it):** no
  client can run its own SQL. The database cannot defend against raw SQL run as a client role (it could set the flag or
  `request.jwt.claims`). Re-checked 2026-10-29 (read-only): PostgREST exposes only `public, graphql_public`; `pg_graphql` is
  not installed (`/graphql/v1` = "pg_graphql extension is not enabled"); `anon` / `authenticated` cannot log in (only
  `authenticator` can); anon `rpc/set_config`, `rpc/pg_catalog.set_config`, `rpc/query`, `rpc/exec_sql` = PGRST202 (not
  found); `Accept-Profile: private` = PGRST106; no client-executable invoker function in `public` calls set_config; the only
  client-executable functions with dynamic SQL are `rls_auto_enable()` (event trigger, not callable) and Supabase's own
  `storage.search` / `storage.list_objects_with_delimiter` (schema not exposed through PostgREST). It stops holding if anyone
  adds an exposed schema, enables pg_graphql, grants a client role login, or adds a client-callable function that runs
  caller-chosen SQL or set_config: each of those needs this review repeated first. Database credentials (connection string,
  service role, management token) stay off every client and out of chat.
Not verified: a real report push on an admin's phone, the SHA-256 path through a real upload (needs the moderate-photo
redeploy), the backfill script against production.

Deploy additions (beyond the 0349 plan): the `moderate-photo` redeploy (already planned with 0349) now also records
fingerprints (skipped harmlessly until 0357 exists); `send-push` gains a table entry for `admin_report_received` (same
behaviour as today's unknown-type default; redeploy any time, before or after); run the backfill script after 0357;
client routing for the admin push ships in build 87 if built from this commit.

### Privacy Policy sentences (DRAFT, publish with 0355 / 0357; owner + counsel approve the wording)
- Reports (§ on safety / moderation): "When you report someone, we keep a copy of the reported message or chat excerpt
  with your report so our safety team can review it, even if the message is later deleted. Reports are visible only to
  Nearby's safety team (you can see the reports you filed). We keep a report for 12 months after it is resolved, even if
  either account is deleted, and then delete it."
- Duplicate photos (§ on profile photos): "To find accounts that reuse the same photo, we compute a fingerprint (a
  SHA-256 hash) of each profile photo you upload. A fingerprint only identifies an exact copy of the same file; it is not
  face recognition or image analysis. A match is reviewed by a person and never by itself leads to action on your
  account. We keep a photo's fingerprint only while that photo is on your profile."
  REPLACE with this version if 0368 is deployed (the sentence above would then be untrue): "To find accounts that reuse
  the same photo, we compute fingerprints of each profile photo you upload: an exact one, and compact summaries of the
  image's overall pattern that also match resized, re-saved, filtered, mirrored or slightly trimmed copies. They are not
  face recognition and do not identify who is in a photo. A match is reviewed by a person and never by itself leads to
  action on your account. We keep a photo's fingerprints only while that photo is on your profile."
- Limits (§ on how we use information): "To prevent spam and abuse we limit how often some actions can be taken (for
  example, messages per minute or public posts with contact details per day). Limits depend on whether your phone number
  is verified and how long your account has existed."

### Still open (not decisions about these migrations)
- B5: stronger passwords and bot protection are Supabase Auth settings (production auth change, not done). The app has no
  email/password sign-up screen; Auth CAPTCHA would also gate the app's phone-code sign-in, so it needs a CAPTCHA provider
  + client integration in a new native build. Proposal: password minimum 10 + leaked-password check (if the plan allows);
  CAPTCHA only with a provider choice. 0352 (verified phone for social actions) is B5's other half, already staged.

## Gathering creation limits by trust level: 20270362 BUILT, STAGED, NOT DEPLOYED (owner, 2026-10-30)

Owner decision (2026-10-30): 5 gatherings per 24 h for a new account, 15 for an established one (verified phone + 7 days);
restricted = the existing suspension (20270351). Starting thresholds, to be reviewed against real usage; no tuning before build 87.
Built in the ONE rate-limit mechanism of 0356 (rule rows `gathering_create`, counted from `private.limited_action_log`
'gathering' timestamps over the last 24 h; trigger `zz_rate_limit_gathering_create`, BEFORE INSERT on gatherings):
every visibility counts; edits never count (insert only); cancel / delete never give one back (the timestamp stays);
server-generated recurring occurrences (cron, no signed-in person) never count; joining / attending / invitations
untouched; reaching the limit only refuses that creation (no flag, restriction or ban). Refusal = hint `gathering_limit`
-> `ui.shared.errors.gatheringLimit` ("You've reached the limit for creating gatherings for now. Please try again later.",
11 languages, 10 machine-authored, need native review), no Try Again. Replaces the live flat limit (trigger
`on_gathering_created_enforce_limit`: 10 per local calendar day for everyone, which also counted generated recurring
occurrences): only that trigger is dropped; its function + the profiles counter columns stay unused, so the rollback
recreates the trigger. Differences to note: the window is a rolling 24 h (like every 0356 limit), not the local calendar day.
Tests (2026-10-30, nothing written to production): new journey `gatheringCreationLimits` 8/8 with 0348-0362 as prelude
(6/8 fail on 0348-0361); prod journeys 784/784 with 0348-0362; 778/784 with 0348-0361 (only the new journey fails, as
expected); prod without prelude 736/784 (the 4 known trust/safety journeys + the new one need their prelude); six journeys
whose fixture hosts create 6-28 gatherings to tell another story lift ONLY the `gathering_create` rule inside their own
rolled-back transaction (`LIFT_GATHERING_CREATION_LIMIT` in `journeyHarness.js`, no-op before 0356); `trustedWriteScope`'s
trusted-counter example moved from the retired gathering counter to the community counter; `trustSafetyI123` counts
0358's 28 rows without 0362's. Rollback round trip (0348-0361 -> +0362 -> rollback) identical catalog fingerprint
(functions + ACL + config + security, triggers, constraints, relation ACLs, rule rows). From-scratch replay 486/486 apply,
journeys 773/784 on it + all 4 concurrency scripts; the 11 failures are `trustSafetyI123` and PRE-EXISTING (not 0362):
0357's `similarity()` runs with search_path `public`; prod has pg_trgm in `public`, a fresh database (the replay, like
a new hosted project) has it in `extensions`, so duplicate-name signals error there. FIXED 2026-10-30 (owner): see
"0357 pg_trgm schema fix" below. Jest 523 / 7156.
Deploy: right after 0361, own approval (`npm run migration:deploy`).

## 0357 pg_trgm schema fix (owner, 2026-10-30; ACCEPTED + CLOSED by the owner the same day; 0357 still NOT deployed, approval requirements unchanged)

0357 now calls `private.name_similarity(a, b)` (sql, immutable, search_path ''), generated at migration time from
`pg_extension` as `<schema where pg_trgm is installed>.similarity(a, b)`: `public.similarity` on production,
`extensions.similarity` on a fresh database. No rule or threshold changed (0358 still sets 3 accounts / 0.5 similarity);
the rollback also drops the wrapper. 0357 had no ledger row, so editing it changes only its approval hash (new sha256
c022bf60…3ea3b; no approval code had been issued for 0357); nothing deployed. Tests (nothing written to production):
prod journeys 784/784 with 0348-0362 as prelude; from-scratch replay 486/486 apply, journeys 784/784 on it (was 773/784:
all 11 were `trustSafetyI123`, i.e. this bug; no other fresh-database failure remains) + all 4 concurrency scripts;
rollback round trips identical catalog fingerprint (functions + ACL + config + security, triggers, constraints,
relations + ACL, columns, policies, extensions) on prod (0348-0356 -> +0357 -> rollback; and 0348-0362 -> rollbacks
0362..0357) and on the replay (rollbacks 0362..0357 -> +0357 -> rollback; re-apply 0357-0362 = the full state);
Jest 523 / 7156. Limit: if pg_trgm is ever moved to another schema, 0357's wrapper block must be re-run.

## Priority order (owner, 2026-10-28)

1. N6 (fix first). 2. Deploy + verify 0349-0354 (number order; 0352 after Session B). 3. B5: KEEP email sign-up;
stronger passwords, bot protection, verified phone for consumer social actions (0352). 4. I2 limits. 5. I3 report
evidence + moderation history (launch blocker). 6. I1 exact-duplicate photos. 7. Risk scoring / liveness vendors:
deferred until real usage justifies. Session B proceeds on controlled test accounts only; no external users until
these pass ordinary-user API tests.

## Behaviour review signals 20270363 + server-only grants 20270364: BUILT, STAGED, NOT DEPLOYED (owner, 2026-10-30)

Owner (2026-10-30): close the four remaining gaps now (repeated messages, join bursts, location switching, several limits
reached), deterministic server rules, private review signals only, never a ban / suspension / hide / restriction; thresholds
proposed for approval BEFORE any review case can open; plus one final gap audit. Separate from 0348-0362 (sequence intact).

### What 20270363 builds (everything OFF: `private.behavior_signal_settings` all null / false)
Nothing is recorded, noted or opened until the owner approves numbers in a separate small migration (as 0356 -> 0358).
| detector | counts | never counted (false-positive protection) |
|---|---|---|
| repeated_messages | the same or near-identical (trigram) text of >= N characters (letters/digits only, case-blind) sent by one person into >= N DISTINCT conversations within a window | a group chat = ONE conversation however many people; the sender's own gatherings / communities / plans (a host announcing); a business replying from its business side; short messages ("On my way!") |
| join_burst | joins of >= N distinct gatherings within a window | a recurring series = one; leave + re-join = one; a join to a gathering you were invited to; RSVP / approval / waitlist changes (INSERT only). Joining is NEVER capped or slowed |
| location_switching | presence reports `report-presence` already REJECTS as implausible travel (> 700 mph) pointing to >= N distinct ~1-degree cells within <= 60 min | accepted reports (real travel, flights); one wrong fix repeating (= one cell) |
| limit_burst | reaching >= N DIFFERENT 0356 rate limits within a window | reports (ordinary or urgent) never count against the reporter |

Review case (the ONE 0357 queue, signal `behavior`, reason "Unusual activity pattern"): only when review is switched on AND
either signals of >= K distinct kinds within the case window (corroboration) or a kind on the "alone" list. One open case per
person (later signals extend it), a daily cap of new behaviour cases for the whole queue (signals still noted; a later signal
re-evaluates). Reports are not an input. Evidence = counts only (never message text, never a location); the admin acts only
through the existing suspension (20270351). Never breaks the action it observes (own exception block per detector; journey
proves a message and a join still succeed with the detector broken). Concurrency: a per-person transaction lock while a
detector is on, so parallel bursts are counted together; other people never wait on it.
Privacy / retention: location = only the ~1-degree cell of a REJECTED claim, kept 1 hour (presence's own retention); other
raw events 48 h; signals 30 days; no client grant on any table; `record_location_jump` = service role only. No device data,
no coordinates, no movement history. Also: `(sender_id, created_at)` indexes on the five message tables.
`report-presence` change (same commit): on a rejected jump it calls `record_location_jump` (errors ignored; the reply is
still the same 400). Deploying it is separate (edge function, owner approval); safe in either order.

### Thresholds PROPOSED for approval (not active anywhere; the journey and concurrency test use them in rolled-back / local DBs)
| setting | proposed | why |
|---|---|---|
| repeated messages | >= 5 distinct conversations, 60 min, >= 20 characters, similarity >= 0.8 | 4 friends getting the same "running late" is normal; 5+ separate 1:1 chats with the same 20+ character text in an hour is the copy-paste pattern; 0.8 catches "Hey {name}, ..." variants (measured 0.8+) |
| join burst | >= 15 distinct gatherings, 60 min | a busy weekend planner joins a handful; 15 in an hour is scraping / spam-joining |
| location switching | >= 3 distinct ~1-degree cells, 60 min (rejected reports only) | 2 = one bad fix + home; 3 far-apart impossible jumps in an hour = a spoofing tool |
| several limits | >= 3 different limits, 60 min | one limit is an enthusiastic person; three different ones in an hour is automation |
| case rule | review ON; alone = repeated_messages, limit_burst; otherwise >= 2 kinds within 24 h | join bursts and location jumps alone are too ambiguous to open a case |
| queue cap | 20 new behaviour cases a day | one admin can review that; more = a rule is wrong, not 20 bad actors |
Activation = one migration setting these values, own approval code. Starting values; review against real cases.

### Location: the limit, stated plainly
Under the privacy rules (no history, no precise points, no device fingerprinting) the server only sees what the person's
phone reports, rounded, kept 1 hour. It CAN see impossible jumps between consecutive reports. It CANNOT see a spoofer who
moves at a plausible speed, or one who jumps once and stays (one cell). Closing that would need location history or device
attestation (both declined); not weakened to detect more.

### Final gap audit (2026-10-30, prod with 0348-0363 applied in rolled-back transactions; real roles)
Actual vulnerabilities found:
1. `get_social_forecast` (unused since the baseline): any signed-in account could make the database fetch OpenWeather with
   the vault key and hold a connection up to 20 s per call (pg_sleep poll): connection-pool exhaustion + quota burn. FIXED
   in 20270364 (client EXECUTE revoked).
2. `send_occasion_group_plan_stall_nudges` (the cron job): any signed-in account could fire every stalled plan's "Still
   deciding?" push early (once per plan). FIXED in 20270364. Cron (postgres) + service_role keep both.
3. Auth (B5, already open, production setting + client work, owner): passwords minimum 6, no character rules, no CAPTCHA,
   password change without re-authentication, no leaked-password check (plan-dependent). Proposal unchanged: minimum 10,
   re-authentication on password change; CAPTCHA needs a provider + a new native build (it would also gate phone sign-in).
   NOT changed (production Auth config needs the owner).
Checked and holding (signed-in ordinary user): message into someone else's match / as another sender / group chat not a
member = refused by RLS; reading others' messages, a private gathering, another's business request, reports = 0 rows;
cancelling another's request = 0 rows; inviting as someone else = refused; joining a private gathering = "Gathering not
found"; self-granting is_admin = refused; editing another profile = 0 rows; self id_verified / suspension clear = no effect;
admin case list / suspension = "Admins only". Catalog: no public table without RLS that clients can reach; no write policy
`true` for clients; every SECURITY DEFINER function has a fixed search_path; every `admin_*` function checks an admin /
finance-approver helper; only public bucket = business-logos (by design).
Speculative / by design (not fixed): `get_intention_change_count(user)` returns another person's 30-day count of "looking
for" changes to any signed-in caller (shown on ViewProfile by design; ignores blocks / hidden profiles; count only, low);
`get_live_tracking_session` by id for anon = the safety-share capability link (by design); partner reputation / response
time readable by anyone (shown to customers by design).
Tests: journey `behaviorReviewSignals` 10/10 + `serverOnlyFunctionGrants` 2/2 (fails before 0364); prod journeys 796/796
with 0348-0364 (rolled back); from-scratch replay 487/487 + journeys 794/794 + all 5 concurrency scripts incl. the new
`behavior-signal-concurrency.js` 14/14 (8 parallel identical messages counted together, 6 simultaneous 5th messages vs a
queue with room for 3 = exactly 3 cases, 15 parallel joins all approved + one signal); 0364 on the replay 12/12; rollback
round trips identical (0363 on prod + replay; 0364 with ACL entries sorted, the re-grant only reorders them); Jest 524 /
7159. Deploy: 0363 then 0364, each its own approval, after 0362.

## 2026-10-30 (later): thresholds approved + final gaps closed (STAGED, NOTHING DEPLOYED)

Owner (2026-10-30): approve the four thresholds with two refinements; close the remaining meaningful gaps (Auth, the
intention-count leak, regression + post-deploy coverage for 0364); each staged and tested separately, individual approvals,
nothing deployed. Then freeze the scope and return to build 87 + Tier 1.

### Refinements, folded into 0363 (not yet deployed, so changed in place; its approval hash changes)
1. Repeated messages count DISTINCT RECIPIENTS, never threads: a 1:1 chat = the other person; a business = one recipient
   however many threads; a group chat = its other members as one set (two groups with the same people = one; a group whose
   people are all already counted through 1:1 chats adds nothing). Still excluded: the sender's own gatherings / communities /
   plans (legitimate group coordination), a business replying from its business side, short messages, and the only
   server-written messages (shared-gathering cards, media-only). Evidence now says `recipients`.
2. The 20-a-day case cap is never silent: each suppressed case adds 1 to `private.behavior_case_overflow` (per UTC day,
   kept 90 days) and keeps the person on `private.behavior_case_waiting` (user id + first/last time + times; no text, no
   location, no evidence copy; 30 days). Admin-only `admin_list_behavior_case_overflow()` (14 days of counts + who is waiting,
   with their signal counts) and `admin_open_behavior_case(user)` (the admin's own decision, outside the cap). A later signal
   still re-evaluates. Still advisory: nothing bans, suspends, hides or limits anyone.
Journey `behaviorReviewSignals`: + distinct-recipient block (3 DMs + one business in 2 threads + a group of an already-counted
person = 4, nothing; a 4th person = 5, signal), share cards never count, overflow counted / waiting / listed text-free /
opened by an admin / refused to non-admins.

### 20270365: the approved numbers (activation)
5 distinct recipients / 60 min / >= 20 chars / similarity >= 0.8; 15 gatherings / 60 min; 3 rejected far-apart areas / 60 min;
3 different limits / 60 min; review on, repeated messages or several limits alone, join burst / location only with a second
kind within 24 h; 20 new cases a day + overflow. Deploy after 0363 (+ `report-presence` redeploy) and 0364, own approval.
Journey `behaviorSignalThresholds` 2/2 (installed numbers = approved; 5 recipients = one case, all 5 delivered, nobody
suspended). Rollback = all off again (signals and cases kept).

### 20270366: intention-change count privacy (the leak)
`get_intention_change_count(user)` gave any signed-in caller anyone's 30-day "looking for" change count, incl. hidden,
unverified, suspended and blocked-either-way profiles. Now: only yourself or a profile you can already open, by the SAME
rule as `people_visible_to_me` (20270348; admins see hidden like the profile itself); else null (the app shows nothing, as
for 0). Signature, grants, client unchanged; depends on 0348's view, so deploy after 0348 (and after 0365 in number order).
Journey `intentionCountPrivacy` 3/3 (self / open / admin-hidden = count; hidden, unverified, suspended, blocked either way,
unknown id = null; grants signed-in only). Rollback = production's function verbatim.

### 0364 regression + post-deploy plan (weather fetcher + stall-nudge job)
Regression (pre-deploy): journey `serverOnlyFunctionGrants` 2/2 (client refused; service role + cron keep them; fails before
0364). Post-deploy, in order: (1) `scripts/live-verify/server-only-grants-post-deploy.sql` (read-only): client columns false,
service true, cron job active; (2) `NEARBY_POST_DEPLOY_0364=1 npx jest -c jest.live.config.js src/qa/serverOnlyGrantsSignedIn.live.js`
with the dedicated test account: both RPCs refused (42501) signed in AND signed out through the real API. Safety gate: it asks
the catalog first and calls NOTHING while a client can still execute either function (run before deploy on purpose
2026-10-30: failed closed, nothing called); (3) the same SQL after the next 12:00 UTC: the cron job's latest run `succeeded`
after the deploy. Baseline today (read-only): clients can execute both (the gap), cron last run 2026-10-29 12:00 `succeeded`.
Any failure = stop + report; rollback file exists.

### B5 Auth (production setting, NOT applied; `scripts/trust-safety/b5-auth-settings.js`)
Live config read 2026-10-30: password minimum 6, no character rules, leaked-password check off, CAPTCHA off, password change
needs neither reauthentication nor the current password, no "password changed" email, email confirmation ON, phone sign-in
via Twilio Verify, Auth rate limits 30/h (email, SMS, verify, OTP), refresh-token rotation on.
How Nearby signs in: the app (build 86/87 and the website export) uses ONLY phone code (`signInWithOtp` + `verifyOtp`); it never
sets or changes a password. All 10 auth accounts nevertheless carry a password hash, so the raw Auth API accepts password
sign-in and email sign-up (confirmation required; 0352 then blocks social actions without a verified phone; 0356 limits).
| change | needs | impact on existing users / phone sign-in |
|---|---|---|
| password minimum 10 | dashboard/API only (staged script) | checked only when a password is SET; existing passwords still sign in; phone sign-in untouched; dedicated test account already >= 10 |
| reauthentication for password change | dashboard/API only | a stolen session can't change the password; the app has no password UI, so no app path changes |
| "your password was changed" email | dashboard/API only (template already set) | email accounts only; nothing for phone-only accounts |
| leaked-password check (HIBP) | Supabase Pro plan | not in the script; plan-dependent |
| CAPTCHA (bot protection) | provider choice (hCaptcha / Turnstile) + client integration + a NEW native build on every device BEFORE switching on | switching it on first would break phone sign-in on build 86/87 (Supabase requires the token on OTP requests too). Not staged as a setting; needs an owner decision on the provider |
| character rules | not proposed | length beats composition rules (NIST 800-63B) |
Apply: `plan` (read-only) prints current vs proposed + approval code `b5:126c06eaa041a886eacbf236dda3c4acdca9be11cf9d9c65cfd3f28fadad56ff`;
`apply` refuses without exactly that code (checked: wrong code = refused, nothing sent), PATCHes only the three keys, reads
back, prints the rollback values. Bot protection today = email confirmation + Twilio Verify + Auth rate limits + 0352's
verified phone for social actions + 0356/0362 limits; CAPTCHA is the remaining real bot gap.

### review-login (edge function, staged, not redeployed)
The per-IP PIN limit keyed on a client-settable `x-forwarded-for`, so rotating it allowed unlimited guesses. Added: a global
cap of 20 failed attempts per 15 min for all callers, constant-time PIN comparison, closed when no PIN / reviewer email is set.
Guard in `edgeFunctionSourcesGuard.test.js`. Redeploy needs `REVIEWER_EMAIL` set first (still not set) + its own approval.

### Tests (2026-10-30)
Prod journeys 804/804 with 0348-0366 as prelude (rolled back; the first full run had 14 environmental failures: a deadlock
between the prelude's DDL and a live production session in `appVersionCompatibility`, and the default 5 s hook timeout in
`understoodChipChange`; both suites 14/14 on re-run). From-scratch replay 490/490 + journeys 804/804 + all 5 concurrency
scripts (incl. the updated `behavior-signal-concurrency.js`). Rollback round trips on prod (0348-0364 + 0365 + 0366 +
rollbacks 0366, 0365): the count function's definition + grants = production's, behaviour settings = 0363's off state.
Jest 524 suites / 7160 tests. Approval hashes (sha256 prefixes; full in the files): 0363 fce93cb0ae959820 (changed),
0364 1977580f358ac61c, 0365 6628af479b2b1d0c, 0366 3995f31f363ff7d7; B5 = b5:126c06ea…56ff.
Deploy order (each its own approval): 0348 ... 0362, 0363 (+ report-presence), 0364 (+ its post-deploy plan), 0365, 0366;
B5 Auth settings independently (no migration dependency); review-login only after REVIEWER_EMAIL is set.

### CAPTCHA (Cloudflare Turnstile) + review-login race + post-deploy plan (2026-10-30, BUILT, NOT APPLIED / NOT DEPLOYED)
Owner chose Turnstile. Client: `utils/captcha.js` (pure rules: config from app.json `extra.turnstileSiteKey` +
`turnstileHost`, widget page, message parsing, one-use token store), `hooks/useAuthCaptcha.js`, `components/TurnstileWidget.js`
(Cloudflare's widget in a `react-native-webview` WebView, invisible unless Cloudflare needs a tick, links open in the browser)
+ `TurnstileWidget.web.js` (website export). LoginScreen takes a FRESH token per "Send Code" (`captchaToken` on
`signInWithOtp`), button reads "Checking…" while it waits, a widget failure or Auth refusal = Try Again (never raw). Site key
EMPTY in app.json = no widget, no token = exactly today's behaviour; a token sent while Auth CAPTCHA is off is ignored, so a
build can carry this long before the switch. 2 new strings `login.checking` / `securityCheckA11y` (10 languages machine-authored,
need native review). NEW NATIVE DEPENDENCY `react-native-webview` 13.15.0 (`expo install --check` clean): a build made from
this commit differs natively from build 86; the switch needs a build WITH the site key on every device.
Switch: `scripts/trust-safety/captcha-settings.js` (plan read-only; `enable` refuses unless app.json has a valid site key/host,
`NEARBY_CAPTCHA_MIN_BUILD` set, no session from an older build / unknown client active in 30 days, website sessions only with
`NEARBY_CAPTCHA_WEB_CONFIRMED=1`, `TURNSTILE_SECRET` set (never committed; goes only to Supabase Auth), approval code from
plan; `disable` = instant rollback). Owner to do: Cloudflare account, Turnstile widget with hostname `allenklein94.github.io`,
site key into app.json, build, then plan -> enable. Live tests sign in via `src/qa/live/signInTestAccount.js` (password,
else a server-issued magic link when CAPTCHA refuses; dedicated account only).
B5 script: new `verify` mode (the three keys set AND phone/email/sign-up/CAPTCHA settings unchanged). Existing passwords
shorter than 10 still sign in (Auth only reports weak_password on sign-in).
review-login: record-then-count (the old count-then-record let N parallel guesses all pass the cap); a refused request removes
its own row, a correct PIN removes its own; cannot record = 503. At most 20 PIN checks per 15 min however requests interleave;
`src/utils/reviewLoginConcurrency.test.js`. Redeploy still needs REVIEWER_EMAIL + approval.
`scripts/live-verify/post-deploy.js`: one read-only plan per staged migration 0348-0366 + edge functions + Auth settings
(rollback file, journeys without prelude, live tests, SQL/manual checks); `--list` prints it.
Tests: Jest 528 suites / 7190; iOS bundle exports clean. Nothing applied to production.
Update (owner, 2026-10-30): Turnstile widget created (hostname `allenklein94.github.io`); public site key
`0x4AAAAAAFsh5P6dQBgjPrup` committed in app.json; the secret stays with the owner (only `TURNSTILE_SECRET` at `enable`). The
device now FAILS OPEN: a check that can't complete (widget error, timeout) sends the request with no token, so with Auth
CAPTCHA off sign-in is exactly today's; once on, Auth refuses tokenless requests (-> Try Again). Phone check before enable:
the widget stays invisible, "Send Code" gets a token (no visible delay beyond "Checking…"), and sign-in still works.
Interactive-challenge fix (owner approved, 2026-10-30, before build 87): the token wait has two limits, never none: 15 s
while the widget works on its own (never loads / stops responding), 120 s while Cloudflare shows its tick box (a person
ticking is never cut off; a hung challenge still ends). The box closing without a token restarts a full 15 s; Cloudflare's
own `timeout-callback` and any widget error end the wait at once; every end = the existing retryable failure (fallback
unchanged: no token while Auth CAPTCHA is off, Supabase refuses once it is on -> Try Again with a fresh token). Native page +
website widget report the box; hook routes it. Tests: success, slow human, box before the tap, cancelled box, stuck
challenge, never loads, failure during the box, retry. Jest 528 / 7199; iOS export clean; dependencies up to date.
Phone verification of a REAL token (not just the SMS arriving): Cloudflare Turnstile Analytics for this widget, solved
challenges at the exact test times (one tester, one device); the app logs no token.

# 2026-10-30: near-duplicate photos + review case history (0368 + 0369, staged, NOT deployed)

Owner approved the two-migration plan with safeguards (2026-10-30; "final targeted improvement", trust & safety scope then
closed unless a genuine vulnerability). Nothing deployed, website not published, detection not switched on, production
unchanged.

- **20270368 similar photos:** `moderate-photo` (changed, not redeployed) hashes the file it already downloads: dHash + pHash,
  six variants (whole, mirrored, centre 90%/80% and their mirrors; `supabase/functions/_shared/perceptualHash.js`), recorded
  per storage object (service role only, `private.photo_perceptual_hashes`, forgotten with the photo). Similar = both
  distances within the limits for one allowed pairing. Cases open only under 0357's rules (3 accounts, or 2 with similar
  names); a photo already in any case never opens another. **OFF until the owner approves distances** (columns null; a
  separate activation migration). No AI, face or identity analysis, no third party, never restricts or tells anyone.
- **Calibration:** `PRODUCT_AUDIT/PHOTO_SIMILARITY_CALIBRATION_2026-10-30.md`: 314 photos, 5,024 edited copies, 49,141
  unrelated pairs. 0 false matches up to 12/12 (and 20/10); first false matches at 14/14 (headshots). Centred 20% trim
  caught 100%, a 20% trim from a corner 0%: never claim "catches 20% crops". Script recommends 20/10; margin thin (closest
  unrelated pair 13); cautious start 10/10. Deno decode path = Node calibration, 1,884/1,884 hashes identical.
- **20270369 case history:** append-only `private.account_review_case_events` (opened, account added, new evidence, note,
  outside check, report linked, closed, reopened; updates refused except nulling a deleted person's id). A closed case never
  reopens itself: same photo again = nothing; a new account with it = "new evidence since closed" + surfaces in the queue,
  stays closed; behaviour signals after closing = evidence on the closed case. Only an admin reopens, with a written reason.
- **Photo review:** a case keeps its photos; `admin_get_account_review_case` gives paths to admins only; Storage policy
  "Admins can view photos under review" (`admin_review_photo_visible`) re-checks the admin per file; 15-minute links;
  bucket stays private; after a case is purged no admin can read those photos this way.
- **Reports:** never open a case by themselves; an admin may open a linked investigation (`admin_open_case_from_report`):
  joins the reported person's open case or opens a 'report' case; the report and its frozen evidence are untouched.
- **Retention:** closed cases deleted 12 months after last closed / last new evidence (with members, photos, links,
  events; daily purge). Open cases never auto-close: review date 30 days after opening/reopening, overdue listed first and
  counted; a case with no remaining accounts is removed.
- **Website admin screen** `AdminReviewScreen` (business website only, `BusinessWebNavigator`; native app/build 87
  unchanged): queue (overdue first), side-by-side photos per account, history, notes, outside check, close/reopen with
  reason, open from report. Registry 69 -> 70 (`AdminReview`, job C). Website export NOT regenerated (would publish).
- **Tests:** journey `reviewCaseHistory` 14/14 on prod with 0348-0369 (rolled back); prod journeys 821/821 with 0348-0369;
  from-scratch replay 493/493 + journeys 821/821 + 6 concurrency scripts incl. new `review-case-concurrency.js` (parallel
  uploads = one case, closed case stays closed, two admins reopening at once = one reopen); rollbacks round-trip exactly
  (catalog fingerprint, aborted transactions on prod); Jest 531 suites pass (incl. `adminReviewCase.test.js`,
  `perceptualHash.test.js`). Post-deploy: `scripts/live-verify/post-deploy.js` steps + gated
  `src/qa/reviewCaseAdminSignedIn.live.js`.
- **Deploy order (each its own approval):** after 0367: 0368 (+ `moderate-photo` redeploy, either order), 0369; then the
  activation migration with the owner's distances; then the website export + publish; Privacy Policy sentence above first.

## Suspended-number re-registration (owner decision 2026-10-31; BUILT + STAGED as 20270374, NOT DEPLOYED, required before external users)

Gap: a suspended person can delete their account, free the phone number and register again without the suspension history following them.

Approved design (owner first said after Tier 1, then 2026-10-31: build it now as an exception to the freeze; branch `post-tier1/suspended-number-retention`, never in build 87, own deploy approval):
1. On deletion of a suspended account, retain only a keyed hash of its phone number (HMAC with a server-side secret, never a plain or unsalted hash), expiring automatically 12 months after deletion.
2. A new registration whose number matches is allowed and opens a private admin review case. No automatic suspension or restriction from the match alone (numbers are reassigned); an admin decides on the evidence.
3. Keep the suspension audit record (decision, reason, administrator, timestamp) with data minimization; do not keep the deleted profile.
4. Nothing public reveals the match: no badge, API response, error text or timing difference exposes whether a number was previously suspended.
5. Privacy Policy disclosure and retention/expiry handling.

Verification required: concurrency tests, from-scratch replay, rollback round trip, real-API tests where appropriate. Production unchanged until the owner approves deployment.

Limit: closes same-number re-registration only. Return with a different number stays covered by the duplicate-account signals (0357, 0368) and human review.

### As built (20270374, staged after 0373)

- **Key:** `private.phone_number_key(phone)` = HMAC-SHA256 of `suspended-number:v1:<digits>` under `private.phone_match_secret` (32 random bytes generated by the migration; no client grant; the private schema is not exposed by the API). Never the number, never a plain or unsalted hash. Only a CONFIRMED number is kept.
- **Retained record** `private.suspended_account_records`: key (nullable for email-only accounts), former account id (links reports that outlive the account), how the number was released (`account_deleted` / `number_changed`), suspended time, the copied decisions (action, reason, admin, report id, time, sessions ended), `expires_at` = release + 12 months (check constraint). Nothing from the profile. Append-only (update refused; delete refused until expired). Purged daily (`purge-suspended-account-records`).
- **When kept:** a BEFORE DELETE trigger on `auth.users` (every deletion path: the app's delete-account, the dashboard, admin API) copies it when the account is suspended (profile `suspended_at`; if delete-account already removed the profile, the latest admin decision). Also when a suspended account changes away from a confirmed number. A reinstated account leaves nothing.
- **Matching:** an AFTER INSERT/UPDATE trigger on `auth.users` puts every newly confirmed number's key in `private.phone_match_queue` (one insert for every number, match or not), and `match-suspended-numbers` (every 10 minutes, outside any request) compares the queue with unexpired records. A match opens one private review case (`signal = prior_suspension`, `reason = suspended_number_reused`, the new account as subject); later records for the same account = new evidence on that case (a closed case stays closed and surfaces, 0369's rule). The new account is never suspended, hidden, banned or limited.
- **Admin:** the website's Admin review screen shows the case ("Phone number of a suspended account") and, through `admin_get_prior_suspension(case)` (admins only), the earlier decisions with who/why/when, never the number or key, plus: "A matching phone number is a reason to look, not proof it is the same person: carriers reassign numbers. Nothing has happened to this account."
- **No disclosure:** no client-readable table, function, column, error, push or badge; the Auth triggers never raise (a failure is written to `private.suspended_number_failures`, sqlstate only, and Auth goes on); sign-up does identical work for every number.

Verification (2026-10-31): journey `suspendedNumberRetention` 10/10 (fails 10/10 without 0374); prod journeys 868/868 with 0348-0374 as prelude (rolled back); from-scratch replay 498/498 + journeys 868/868 + all 10 concurrency scripts on it; real Auth v2.197.0 on the replay 14/14 (`scripts/replay/suspended-number-auth-local.js`); rollback round trip: replay (rollback then re-apply = identical, 5504 items) and prod (aborted transaction: 0374 changes 64 items, rollback restores all); grants replay == prod+0348-0374 3287/3287; Jest 536 suites / 7279 tests. Prod checked read-only afterwards: no 0374 table, trigger or cron job.

Known limits:
- Closes same-number re-registration only; a different number stays covered by the duplicate-account signals (0357, 0368) and human review.
- The secret lives in the database: anyone with access to the private schema (database owner, a leaked service connection) could test candidate numbers against kept keys. Rotating the secret orphans every kept key (they can never match again).
- A match is found up to 10 minutes after the number is confirmed (deliberately outside the request).
- If the retention trigger fails, the deletion still completes and only a failure row records it (the record is lost): checked read-only after deploy.
- An account suspended and then deleted in the SAME second as a reinstatement can't be ordered by the decision log (only when delete-account has already removed the profile); not reachable through the admin screens in practice.
- Numbers on accounts deleted before 0374 is live are not retained (production has never suspended anyone: 0351 is not live).

### Owner decision (2026-10-31): ACCEPTED + CLOSED as code-complete and locally verified, NOT deployed

Stays on its branch; migration order and individual deploy approvals kept. Mandatory activation gates: (1) focused security review of the keyed-hash secret before final deploy approval (access by ordinary database roles, exposed APIs, backups reachable by lower-trust operators, logs; whether to hold the key outside the database, e.g. an edge-function secret or Vault). Phone numbers are a small, predictable search space, so anyone who can read the secret and the kept keys can test guesses. Change the implementation only if the review finds a material exposure. (2) Privacy Policy sentence below, published with the deploy. (3) The post-deploy real-SMS test. No merge, no deploy; development frozen again.

### Privacy Policy sentence (DRAFT, publish with 0374; owner + counsel approve the wording)
- (§ on safety / retention): "If we suspend an account for breaking our rules and that account is later deleted, we keep a
  scrambled code made from its phone number (not the number itself) and a record of our decision for 12 months, then delete
  them. If someone signs up with the same number during that time, a member of our safety team reviews it. Phone numbers are
  reassigned, so this never by itself leads to action on the new account."

## Account takeover through a phone number / SIM swap (owner exception 2026-10-31; BUILT + STAGED as 20270375, NOT DEPLOYED)

Owner (2026-10-31): finish the SIM-swap and phone-number account-takeover review now, as an exception to the freeze for genuine
account-security vulnerabilities; audit first, fix only confirmed critical gaps, smallest effective change, separate post-Tier-1
branch (`post-tier1/account-takeover`, stacked on `post-tier1/suspended-number-retention`), never in build 87, no merge/deploy.
Requirements kept: simple phone-code sign-up, no mandatory ID, no device fingerprinting or vendors, no public score or badge,
no lock-out of people who change phones or numbers, existing account-state rules.

### Audit (2026-10-31; production Auth settings + accounts read-only; attacks played against a real Auth v2.197.0 = production's version with production's settings, locally)

Production: 10 accounts (4 phone-only, all 4 already carry an Auth-generated password hash; 1 with both), 0 MFA factors, sms
provider Twilio Verify, refresh-token rotation on, `security_update_password_require_reauthentication` false, secure email change
on, TOTP enrolment ON, no triggers on `auth.users` / `auth.sessions` before 0374.

**Already protected:**
- Suspension (0351, staged): an Auth ban + database refusals; a code, a password reset or a refresh never lifts it.
- Settings > Sign Out = `auth.signOut()` with the library's default scope `global`: it ends EVERY session of the account (proven
  on real Auth: the intruder's refresh is refused afterwards).
- Email accounts: an email change needs both addresses to confirm (secure email change on).
- New accounts by phone only (0367 + switch, staged); a suspended account's number returning = a private case (0374, staged).
- The app never offers a password, an email or an authenticator app on a phone account; a number change only in Settings.

**Genuinely exploitable (confirmed on real Auth), by anyone who gets ONE valid SMS code for the owner's number (SIM swap,
carrier port-out, or a recycled number):**
- **V1 (critical) the account moved to the intruder's number:** Auth asks only the NEW number for a code; the owner's number then
  opens a new, empty account. Full, permanent takeover.
- **V2 (critical) a password added to a phone-only account:** Auth ends every other session (the owner is signed out) and the
  intruder can return by phone + password without any SMS, even after the owner recovers the number.
- **V3 (critical) an email added to a phone-only account:** the confirmation goes only to the new (intruder's) address: a second
  way in (email code, magic link, password reset).
- **V4 (critical, after V3) an authenticator app enrolled:** the owner can then change neither phone, email nor password (AAL2).
  (Without an email, TOTP enrolment fails on a phone-only account.)
- **No signal to the owner** of a new sign-in or a number change, and **no record** for an admin.

**Theoretical or inherent (not fixed, see limits):** the SMS sign-in itself; a recycled number; deletion by the intruder.

### As built (20270375, staged after 0374; needs 0369's `private.require_admin`)

1. **A phone-only account never gains a password or an email** (BEFORE UPDATE trigger `aa_account_takeover_guard` on
   `auth.users`): the change is quietly not saved (Auth goes on, nothing raised inside Auth), the attempt recorded. Closes V2,
   V3 and so V4. Email accounts change their own password and email as before.
2. **A number change waits 24 hours after the account's latest sign-in** (same trigger; starting a change and the number itself;
   a token refresh is not a sign-in; ONE rule `private.phone_change_allowed_at`). A fresh sign-in may be a new device; someone who
   just got in with a stolen code must keep the account a full day before moving it, while the owner is told (3). The app asks
   first (`get_my_phone_change_wait`, own row only) and says when ("Try again later" / "...You can change it after {time}.", 11
   languages, 10 machine-authored); an account signed in longer changes its number exactly as before. Narrows V1.
3. **One security notice** (push `account_security_notice`, high priority, never muted, opens Settings with an "Open Settings"
   button; no name, device or place): a new sign-in while another session of the account was used in the last 30 days (at most
   one an hour; not the session a number change itself opens), and a completed number change. Wording: "New sign-in to your Nearby
   account" / "If this wasn't you, open Settings and tap Sign Out to end every session, then contact your mobile carrier."; "Your
   Nearby phone number was changed" / "If this wasn't you, contact Nearby support right away."
4. **A private record** `private.account_security_events` (kind + time only; no number, IP or device; 12 months then purged
   daily; kept if the account is deleted), read only by admins (`admin_get_account_security_events`). Never an automatic
   restriction, a public signal or a case on its own. Any failure inside a guard fails closed on the sensitive fields, never blocks
   Auth, and leaves a `guard_failure` row.

Files: migration `supabase/migrations/20270375_account_takeover_protection.sql`, rollback
`scripts/rollback/20270375_account_takeover_protection.rollback.sql`, journey `src/journeys/accountTakeoverProtection.journey.js`,
real-Auth check `scripts/replay/account-takeover-auth-local.js`, concurrency `scripts/replay/account-security-concurrency.js`,
gated live test `src/qa/accountTakeoverSignedIn.live.js`, post-deploy step (`scripts/live-verify/post-deploy.js` 20270375), app:
`src/utils/phoneChangeWait.js` (+ test), Settings' number change, push tables (destination, priority, action, never-muted list,
`send-push` copy), lifecycle matrix regenerated.

### Verification (2026-11-01; a codespace restart interrupted it, everything was rerun afterwards)

- Journey `accountTakeoverProtection` 8/8 with 0348-0375 as prelude; fails 8/8 without 0375.
- Prod journeys 876/876 with 0348-0375 as prelude (rolled back); prod checked read-only afterwards: no 0375 table, trigger or job.
- From-scratch replay 499/499 + journeys 876/876 on it; all 10 existing concurrency scripts + the new one pass (six simultaneous
  sign-ins = ONE push; four parallel takeover writes = nothing saved, each recorded, no error to Auth; two simultaneous number
  changes = one saved, the other refused by the clock the first started, one push).
- Real Auth v2.197.0 on the replay with a mail catcher, 19/19: the intruder's code sign-in works (inherent) and the owner gets ONE
  notice; no password (phone + it doesn't sign in), no email (the mailed confirmation doesn't attach it), no authenticator, no move
  to the intruder's number; the owner's number still opens the SAME account; the owner's Sign Out ends the intruder's session; a
  long-signed-in account changes its number normally with ONE notice; an email account changes its own password; no failures.
- Rollback round trip identical: replay (4773 -> 4750 -> 4773 items) and prod in an aborted transaction (4975 -> 4998 -> 4975).
- Grants replay == prod+0348-0375 3291/3291 (0374's 3287 + the 4 intended EXECUTE lines on the two public functions).
- Jest 537 suites (536 pass; the one failing suite is the known date-dependent `askUnderstanding.benchmark`, 4 cases, test debt).

### Remaining risks (recorded, not fixed)
- **The SMS sign-in itself can't be stopped by SMS alone.** Someone holding the number gets a session and can read what the
  account can read until the owner signs out everywhere. Real protection needs a second factor or passkeys: a later decision.
- **The intruder can still sign the owner out:** on a password attempt Auth ends the other sessions before the database refuses
  the password (observed on real Auth). Denial, not takeover; the owner signs in again by SMS once they have their number.
- **The 24-hour wait can be outlasted** if the owner has no signed-in device (then no notice reaches them); a recycled number's
  new holder is in the same position after 24 h. Support contact is the recovery path.
- **The intruder can delete the account** from a stolen session (delete-account): destructive, not a takeover; a re-check by SMS
  wouldn't help (the intruder holds the number) and delaying deletion conflicts with easy in-app deletion (App Store 5.1.1(v)).
  Not changed: owner decision if wanted.
- **Email accounts** (business owner, reviewer, test account): a stolen session can change the password without re-checking;
  B5's staged Auth settings (`security_update_password_require_reauthentication` true) close it when applied.
- Production sends codes by Twilio Verify; the local test used Auth's test OTP: the Verify path is a post-deploy phone check.
- An operator with database-owner access works around every rule (as for every guard).

### Owner review (2026-11-01): accepted as code-complete + staged, residual risks open

Decision: 0375 is ACCEPTED as code-complete and staged; NOT deployed. R1-R4 stay OPEN for the external-launch security review;
SMS-only sign-in is never described as resistant to SIM swaps. Next = build 87 + Tier 1, then the controlled staged deployment.

Questions answered (from the migration + the real-Auth test; no new code):
- **What the 24 h clock measures:** `auth.users.last_sign_in_at`, the account's MOST RECENT sign-in on any device (Auth sets it
  on every successful sign-in: SMS code, password, magic link), never the creation time of the session making the request; a
  token refresh never moves it. Evidence: the real-Auth test sets the owner's last sign-in to 3 days ago, the intruder then signs
  in by code, and the intruder's number change is refused (so Auth's code sign-in moved the clock). Consequences: whoever signed
  in last restarts the wait for everyone (an owner signing in again pushes an intruder's window out; the owner's own change also
  waits 24 h after their sign-in). Not checked: whether Auth's `reauthenticate` nonce moves it (the app doesn't use it).
- **Recovery after an unauthorized number change: NONE that works reliably (R4).** If the owner still has a signed-in device they
  get "Your Nearby phone number was changed" and could, in principle, change the number back from Settings (the intruder's
  sign-in is then >= 24 h old) before tapping Sign Out; NOT TESTED (whether Auth ends other sessions on a number change, and the
  race with the intruder). If the owner has no signed-in device, the only path is "contact Nearby support", and today there is no
  support runbook, no way for a phone-only owner to prove ownership (the number now belongs to the intruder), and the guard also
  refuses an admin-API number change within 24 h of the intruder's latest sign-in. The private record (`phone_changed`, time
  only) is the only evidence. To be designed in the launch review together with R1/R2 (second factor / passkeys, protected
  deletion); not built (development frozen).

### Deployment dependencies (each its own approval; nothing deployed)
- After 0374, in migration order, through `deploy.js`.
- A build that asks `get_my_phone_change_wait` for the friendly wait message; older builds still work (the change isn't saved
  within 24 h and their code step fails with Auth's own error).
- `send-push` redeploy for the high priority + "Open Settings" button (without it the notice is delivered at medium, no button).
- Privacy Policy sentence below, published with the deploy.
- The post-deploy checks in `post-deploy.js` (incl. the Twilio Verify phone checks with test numbers, owner present).

### Privacy Policy sentence (DRAFT, publish with 0375; owner + counsel approve the wording)
- (§ on security): "To protect your account, we keep a short record of security events, such as a new sign-in while you're
  signed in elsewhere, a phone number change, or a blocked attempt to add a password or email. It holds only what happened and
  when, never your number, device or location, is seen only by our safety team, and is deleted after 12 months."

## Repeat bad actors cycling accounts (owner idea 18, decision 2026-11-01): COVERED BY STAGED PROTECTIONS, TWO KNOWN GAPS, nothing built

Covered (all STAGED, none deployed; none protects a live user until deployed + verified): 0352 (verified phone for social
actions + discovery: each new account costs a real number), 0374 (a suspended account's number re-confirmed elsewhere opens a
private admin case with the earlier decisions; never an automatic restriction), 0357 + 0368 (name / identical + near-duplicate
photo signals to admins; near-duplicate detection OFF), 0356/0358/0362 (progressive trust: tight limits for new accounts),
0375 (recovery needs a case + a takeover signal, a trusted device alone is not evidence, 42 days per incident, second admin
for a new incident, audited). No single signal restricts anyone; only an admin decision does.

Residual gaps, DEFERRED (documented, not fixed):
1. No device-level signal. Cheapest later option = the same push token on a second account (tokens already private, 0347) as a
   private admin-review signal only; never proof of the same person (shared/resold phones), never a block.
2. A banned person with a DIFFERENT number is not caught by 0374 (only by 0357/0368 if a name/photo is reused). Virtual/VoIP
   number checks at sign-up are not built (would need a paid lookup vendor and would turn away some real users).

Not to add: device fingerprinting, third-party vendors, automatic account restrictions, extra sign-up friction. Revisit only if
real usage or abuse investigations show repeat account cycling the existing controls cannot adequately detect.

## Shared device notification token (owner 2026-11-01, idea 18 gap 1; BUILT + STAGED as 20270376, NOT DEPLOYED, detection OFF)

Branch `post-tier1/shared-device-signal` (stacked on the 0375 branch; off main, build 87 unchanged). No app change for
users; the website admin review screen gains one evidence block (`sharedDeviceLines`, `SHARED_DEVICE_NOTE`).

**What it does.** The Expo push token the app already registers (20270347, `private.push_tokens`) identifies an app
install, not a person. When the same token is registered by several accounts, a private admin-review case may open.
Never proof, never a block: families share phones, one person has several accounts (the owner's iPhone has 3 on one
token), tokens move and rotate. No device fingerprinting: no model, OS, IP, location or advertising id is read or stored.

- Stored: an HMAC-SHA256 key of the token under a server-only secret (`private.device_signal_secret`), per account, with
  first/last registration time (`private.device_sightings`, 90 days after the last registration, purged daily). Never
  the token. Sign-out removes the token (0347) but keeps the sighting, so a later account on the same install compares.
- A suspended account being deleted keeps only its keys, 12 months (`private.suspended_device_keys`, same rule as 0374).
- Case rules (each off until approved): `suspended_device` = a token on a suspended account (live, suspended later, or
  deleted within 12 months) and on another account; `many_accounts` = at least N accounts in 90 days, N >= 3 enforced by a
  check constraint (two accounts alone, the shared family phone, never open anything).
- One case per token; later accounts join it; on a closed case a new account is "new evidence" and the case stays closed
  (0369); only an admin reopens. Evidence = counts + suspended accounts' ids and times; never the token or key.
- Never restricts, hides, suspends, notifies or limits anyone; push delivery untouched; every step in its own exception
  block (failures -> `private.device_signal_failures`, no personal detail), so token registration, suspension and account
  deletion never fail because of it. Concurrency: advisory lock per key + unique index on the case's key.

**Activation (separate migration, owner approval):** set `shared_device_suspended_enabled` and/or
`shared_device_min_accounts` (proposed: suspended on, many-accounts 4 — the owner's own phone already has 3), then run
`private.backfill_device_sightings()` once. Before that: the Privacy Policy sentence below published.

**Privacy Policy sentence (DRAFT, publish with activation):** "To help detect people who return after being suspended,
we keep a scrambled, one-way code derived from your device's notification token (not the token itself, and nothing else
about your device) for 90 days after you last used Nearby on that device. If the account is suspended and then deleted,
that code is kept for 12 months. It is only used to let our team review possible misuse; it never blocks or limits an
account by itself."

**Limits.** A token changes on reinstall or a new phone, so a determined person evades it; denying notification
permission means no token and no signal; the secret lives in the database (same accepted limit + same pre-deploy secret
review as 0374).

**VoIP / virtual numbers (gap 2):** assessed, NOT built, NOT activated: `PRODUCT_AUDIT/VOIP_NUMBER_ASSESSMENT_2026-11-01.md`
(not available through the current Twilio Verify integration; $0.008/lookup via Lookup v2; the owner's own Google Voice
login would be flagged; recommendation = do not build until real abuse shows the need, then evidence-only, never reject).

**Owner decision (2026-11-01):** 0376 ACCEPTED as code-complete, tested locally and staged. Activation preferences (not
permission to deploy or activate): suspended-account token reuse ON; shared-token threshold N = 4 within 90 days; admin
review only, never an automatic restriction; VoIP/virtual-number lookup DEFERRED. Gates kept: production-equivalent tests
(prod journeys with 0348-0376 prelude, aborted rollback on prod, grants vs prod), secret-storage review, Privacy Policy
approval, real-device push verification after deploy. No merge, deploy, activation or production change authorized.

## Friend-request burst limit (owner 2026-11-01, from idea 24; BUILT + STAGED as 20270377, NOT DEPLOYED)

Branch `post-tier1/friend-request-burst` (stacked on `post-tier1/shared-device-signal`); not in build 87; own deploy
approval after 0376. Number = the owner's proposed starting point, kept as is after inspection (no reason found to change it).

**Rule.** At most 5 friend requests per rolling 10 minutes, both trust levels (unsolicited outreach: age never raises it,
20270358). The existing 15 per local day (`enforce_friend_request_daily_limit`) is unchanged and checked first.
**Mechanism.** The ONE rate-limit mechanism of 20270356: rule rows `friend_request` (600 s, 5) + a case in
`private.rate_limit_count`; `zz_rate_limit_friend_request` (BEFORE INSERT on `friendships`) locks the sender's `profiles`
row (the same row the daily limit locks: same order, no deadlock) then checks; `zz_log_friend_request` (AFTER INSERT) writes
one `private.limited_action_log` row ('friend_request') per request REALLY created. Refusal = hint `friend_request_limit`,
app sentence `ui.shared.errors.friendRequestLimit` (11 languages, 10 machine-authored: native review) via
`utils/recoverableError.js` on every screen that sends one (Friends, a profile, story viewers); no Try Again.
**What counts.** Only the signed-in person's own new pending request. Never counted: a refused insert (duplicate pair
23505, block policy, missing phone, suspension, the daily limit, this limit), an "on conflict do nothing" skip, the mutual
Connect in friend discovery (a trusted server write), other server writes. A declined request still counts for its 10
minutes (cancel-and-resend can't get around it). The log is private (no client grant), purged after 30 days with the rest.
**Never.** Restricts, suspends, scores, flags or asks to verify an account; it refuses that one request.

**Daily counter fix (owner, 2026-11-01, in 0377).** The daily limit added its +1 in a BEFORE INSERT trigger, and Postgres
runs BEFORE triggers before the conflict check, so an "on conflict do nothing" insert of an existing pair (a direct API call;
the app never sends one) used a daily slot without creating anything. Now `enforce_friend_request_daily_limit` only locks +
checks (same limit, message, scope, lock) and `_count_friend_request_daily` (AFTER INSERT) adds the +1 only for a row really
written; the profiles-row lock taken before the check is held to commit, so simultaneous requests still see each other's +1.
Remaining, existing behaviour: at 15/day a skip is still REFUSED by the daily check (it runs before the conflict is seen);
it creates nothing and uses no slot either way.

**Verification (replay only; nothing touched production; re-run 2026-11-01 after the daily counter fix + test isolation).**
Fresh from-scratch replay (real Auth first) 501/501. Journey `friendRequestBurstLimit` 13/13 (boundaries 5/6, duplicate +
reverse-duplicate retries, blocked pair, rolling window still counted at 9:59 and released at exactly 10:00, decline keeps the
count, daily-cap interplay + a burst refusal never consumes the daily counter, on-conflict skips (both directions) use neither
allowance and leave the 15th slot free, the daily counter restarts on a new local day, mutual Connect, established = same 5,
client can't read the log or call the check); with the rollback as prelude it fails 9/13 (the skip test included; the 4 that
pass don't depend on 0377). Full journeys 914/914, then all 13 concurrency scripts, then full journeys AGAIN on the same
reused replay 914/914 (the order dependence is fixed: `trustSafetyI123`'s admin-push titles/bodies read only its own admins;
`behaviorReviewSignals` measures only the overflow count it adds). Concurrency `friend-request-concurrency.js` 10/10 runs
(new case 5: 3 parallel skips + 1 new request at 14/day = the new request created, daily 15, 2 log rows; depending on
interleaving 0-3 skips are refused by the daily check after the 15th commits, never another error: all four interleavings
seen). Rollback round trip: rollback + re-apply = 0 differences over 4676 sorted catalog items (functions, triggers,
policies, constraints, table ACLs, columns, rule rows); the rollback removes exactly the 0377 objects and restores 0361's
`enforce_friend_request_daily_limit` body byte for byte. Jest 538/538 suites (7294 passed).
**Not run (deploy gates):** prod journeys with the 0348-0377 prelude, an aborted rollback on prod, grants vs prod; the phone
check in `scripts/live-verify/post-deploy.js` (20270377).
**Daily-limit message localized (owner 2026-11-01, in 0377; no separate migration: 0377 already redefines the function).**
The daily refusal keeps its exact English text (build 87 and older keep showing it) and now carries hint
`friend_request_daily_limit` -> `ui.shared.errors.friendRequestDailyLimit` in all 11 languages (es, de, fr, pt, ht, zh, vi,
tl, ru, ko machine-authored: NATIVE REVIEW NEEDED). Tested together with the burst message: Jest runs both refusals through
`recoverableErrorCopy` in every supported language (own sentence each, distinct, "15" kept, no Try Again, the English = the
old wording, the migration raises that hint); journey case "both limits together" on a fresh replay: 9 today + 5 in a row =
daily 14, the 6th = burst hint, both full = daily hint (its trigger fires first), burst window passed with daily 15 = still
daily, new local day = through (counter 1), 6 log rows. Re-verified: fresh replay 501/501, journey 14/14 (fails 10/14 with
the rollback as prelude), journeys 915/915 before and after the 13 concurrency scripts, rollback round trip identical (4676),
Jest 538/538 (7295). Post-deploy phone check added (non-English language, needs a build with the mapping, not build 87).
IMPLEMENTATION CLOSED (owner, 2026-11-01).
**Known gaps / existing behaviour left as is.** No reset time is
shown (the window is rolling; the sentence says "a few minutes", true for <= 10).

## The same public text on several accounts (owner 2026-11-01, idea 4 gap 1; BUILT + STAGED as 20270378, NOT DEPLOYED, detection OFF)

Branch `post-tier1/shared-text-signal` (stacked on `post-tier1/friend-request-burst`); not in build 87; own deploy approval
after 0377. Owner decision (2026-11-01): build the cross-account public-text duplication signal now, keep it disabled;
**cross-account behavioural-sequence detection DEFERRED** (more complex, higher false-positive risk, no real usage data to
validate it; 0363/0365's per-account behaviour signals stay the only behaviour detectors).

**Inspected first (no duplication).** Nothing compared TEXT across accounts: 0357/0368 compare names + photos, 0363 repeated
messages per sender only, 0356 limits commercial public posts per account, 0373 screens each text on its own. The review
queue (0357 + 0369 history, website admin screen) is reused; the mechanism mirrors 0376 (keyed hash, sightings table,
cluster rule, settings null = off, separate activation migration with backfill). No material architectural or privacy
concern found; the one accepted limit is the same as 0374/0376 (the HMAC secret lives in the database).

**Rule.** Looks ONLY at text others can already read: a profile's published bio and the description of a public gathering
(visibility `everyone`, `moderation_state` `visible`; a 0373-held gathering is read only once approved, a held bio edit
keeps the published bio). Friends-only / community / invite-only gatherings and every message are never read. Normalized
(lower case, NFKC, every run of non-letters/digits = one space), then left out when shorter than 80 characters or fewer than
12 distinct words, or listed as a known template (`private.exclude_shared_text`, server-only). Stored = HMAC-SHA256 key under
`private.text_signal_secret` + account + source (+ gathering id) + first/last time; never the text, an excerpt, its length
or language; kept 30 days after last posted (daily purge), deleted with the account. A case (0357 queue, signal
`shared_text`, reason `many_accounts`) opens only when >= `shared_text_min_accounts` DISTINCT accounts posted the same key
within 30 days (owner's starting point 5; >= 3 enforced; an initial testing assumption, NOT a proven abuse threshold).
One host's recurring gatherings are one account. **One cluster = one case:** a qualifying key joins an existing shared-text
case when at least half its accounts are already members (the same group's bio AND gathering description = one case); later
accounts join the open case; on a closed case a new account is "new evidence" and the case stays closed (0369); closing as
"No action needed" is how a legitimate shared text is dismissed for good. Evidence = counts (accounts, texts, by source),
the window, up to 20 public gathering ids. **Never** bans, suspends, hides, restricts, limits, scores, notifies or tells
anyone; each step runs in its own exception block (a failure never blocks a save; recorded in `private.text_signal_failures`
with no detail about the person). Concurrency: an advisory lock per key + one for the cluster decision; a unique index on
each key's case backs it up. Website admin screen: "Same public text" case title, a not-proof note, count lines + short
gathering ids (`sharedTextLines`, `SHARED_TEXT_NOTE`); not published (website publish = its own approval).

**Verification (replay only; nothing touched production).** Fresh from-scratch replay (real Auth first) 502/502. Journey
`sharedPublicText` 15/15: off = nothing stored; key = 32-byte keyed hash, not a plain hash, case/punctuation/spacing variant
= same key, short / few-word / blank = none; 4 accounts = no case, 5th = one case (evidence counts only); variant joins it;
re-saving adds nothing; short, few-word and listed-template bios never recorded (false-positive cases); one host's 4
recurring gatherings = no case; friends-only gatherings never read; a held public gathering not read until approved; 5 hosts'
public description = a case with 5 gathering ids; the bio group's gathering description joins its bio case (one case, 2
texts); a sighting 31 days old doesn't count; closed case + new account = new evidence, still one closed case; nobody
restricted, hidden, banned or pushed, bios kept, flagged account keeps creating; no text or key in any stored row; admins
list/read cases, 11 client/anon probes all refused; deleted account = no sightings; purge, backfill (public only; 0 while
off), cron job, 0 failure rows. With the rollback as prelude it fails 15/15. Full journeys 930/930, then all 14 concurrency
scripts (new `shared-text-concurrency.js`: six parallel saves = one case; closed case + four parallel new accounts = still one
closed case, 4 new-evidence events; bio and gathering description reaching the threshold in parallel = ONE case with both
texts, 3 rounds; one account from three sessions = one sighting; no failure rows; cleanup verified), then journeys again
930/930. Rollback round trip on the replay: apply -> rollback -> apply -> rollback -> apply, applied states identical (5318
sorted catalog items), rolled-back states identical (5255); the difference is exactly 0378's objects plus the case-kind
constraint restored. Jest 538/538. Test helpers fixed on the way: the real-Auth replay helpers (`account-takeover-auth-local.js`,
`suspended-number-auth-local.js`) now attach both networks before Auth starts (it could otherwise start before reaching the
database and fail on the existing `auth.schema_migrations`).
**Not run (deploy gates):** prod journeys with the 0348-0378 prelude, an aborted rollback on prod, grants vs prod, the
secret review (with 0374/0376), validation of the 5-accounts starting point against legitimate shared text (recurring
meetups, co-organisers, a club's standard description) before activation, the post-deploy checks in
`scripts/live-verify/post-deploy.js` (20270378).

**Privacy Policy sentence (DRAFT, publish with activation):** "To help our team find networks of fake accounts, when the
same longer profile bio or public gathering description appears on several accounts, we keep a scrambled, one-way code of
that text (never the text itself) for 30 days. It is only used to let our team review possible misuse; it never blocks or
limits an account by itself."

**Known gaps (left as is).** Exact match after normalization only: changing one word evades it (near-duplicate text, like
photo similarity, deferred until real abuse shows it); private and group messages stay reports-based (owner decision
2026-10-31); a shared URL alone is not compared (0356's commercial-post limit covers links in public posts); editing a text
away doesn't delete its sighting (it was posted within the window); the cluster join is a half-overlap heuristic (two
different groups sharing many members merge into one case: acceptable, a person reviews it); a later normalization change
needs a new key version (`public-text:v1:` prefix).

**ACCEPTED AS BUILT + LOCALLY TESTED, CLOSED (owner, 2026-11-01).** Complete but staged, disabled, unmerged and undeployed;
every existing deployment and activation approval stays required. The 5-account threshold is PROVISIONAL (five matches open
a review, never imply wrongdoing) until legitimate shared-text scenarios are reviewed. **Activation checklist (all
mandatory):** (1) secret-key security review: `private.text_signal_secret` and the fingerprints protected against
unauthorized access, the secret kept outside any client-reachable object (with 0374/0376's review); (2) prod journeys with
the 0348-0378 prelude + an aborted rollback round trip on prod; (3) grants vs prod; (4) Privacy Policy sentence approved +
published; (5) threshold validated against legitimate shared text. The one-word-change evasion is ACCEPTED for this version:
no fuzzy text matching, no cross-account behavioural clustering, no further security features (owner).

## Launch requirement: direct reporting of gatherings and communities (owner, 2026-11-06)

Blocks outside users, not build 87 or the owner's own Tier 1 testing. NOT BUILT. Include it in the consolidated deployment checklist.

- Found 2026-11-06: no report action on the gathering or community screen, and `reports.content_type` has no such type. A person can only
  report the host's profile, an attendee or a chat message, so the admin may not see which gathering prompted the report.
- Scope: Report Gathering and Report Community in the existing ⋯ menus; the existing report form, admin queue and moderation.
- Evidence: the server keeps the reported title, description and relevant metadata at report time, surviving later edit or deletion.
- Access: works without joining, only if the reporter is authorized to view the content. Privacy rules unchanged.
- Tests: direct-API bypasses, including a fabricated id and content the reporter can't see.
- Delivery: a separate post-Tier-1 migration + app build, each with its own approval.
