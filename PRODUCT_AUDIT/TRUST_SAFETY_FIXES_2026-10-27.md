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

## Priority order (owner, 2026-10-28)

1. N6 (fix first). 2. Deploy + verify 0349-0354 (number order; 0352 after Session B). 3. B5: KEEP email sign-up;
stronger passwords, bot protection, verified phone for consumer social actions (0352). 4. I2 limits. 5. I3 report
evidence + moderation history (launch blocker). 6. I1 exact-duplicate photos. 7. Risk scoring / liveness vendors:
deferred until real usage justifies. Session B proceeds on controlled test accounts only; no external users until
these pass ordinary-user API tests.
