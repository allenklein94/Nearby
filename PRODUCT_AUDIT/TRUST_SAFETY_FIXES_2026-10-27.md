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
  flag. DO block + `trustedWriteScopeGuard.test.js` hold later migrations to it. Residual (same class, lower impact,
  recorded, not fixed): a forged flag also skips the friend-request daily limit and 0356's rate limits (checked inside
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
- Limits (§ on how we use information): "To prevent spam and abuse we limit how often some actions can be taken (for
  example, messages per minute or public posts with contact details per day). Limits depend on whether your phone number
  is verified and how long your account has existed."

### Still open (not decisions about these migrations)
- B5: stronger passwords and bot protection are Supabase Auth settings (production auth change, not done). The app has no
  email/password sign-up screen; Auth CAPTCHA would also gate the app's phone-code sign-in, so it needs a CAPTCHA provider
  + client integration in a new native build. Proposal: password minimum 10 + leaked-password check (if the plan allows);
  CAPTCHA only with a provider choice. 0352 (verified phone for social actions) is B5's other half, already staged.

## Priority order (owner, 2026-10-28)

1. N6 (fix first). 2. Deploy + verify 0349-0354 (number order; 0352 after Session B). 3. B5: KEEP email sign-up;
stronger passwords, bot protection, verified phone for consumer social actions (0352). 4. I2 limits. 5. I3 report
evidence + moderation history (launch blocker). 6. I1 exact-duplicate photos. 7. Risk scoring / liveness vendors:
deferred until real usage justifies. Session B proceeds on controlled test accounts only; no external users until
these pass ordinary-user API tests.
