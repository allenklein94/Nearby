# Trust & safety launch-blocker fixes (owner approval 2026-10-27)

Built and tested in isolation. **Nothing deployed**: no migration applied to production, no edge function deployed, no
identity document deleted, no live account permission changed. Every production test ran inside a transaction that was
always rolled back (verified afterwards: no new column, trigger or table exists in production).

Source audit: `PRODUCT_AUDIT/TRUST_SAFETY_AUDIT_2026-10-27.md`.

## What was built (one migration per fix, deploy in this order)

| Migration | Fix | What it does |
|---|---|---|
| `20270347_verification_self_grant_guard` | 1 | Nobody grants themselves verification or admin. Profile INSERT by a signed-in user starts every privileged column at its default (**new finding, proven: a brand-new account could create its own profile as admin + premium + verified**; admin = read every report and ID image, approve IDs). `photo_verified` only true -> false from the client; a new photo resets it and must be in the person's own folder (main + extra photos). ID submissions: INSERT only as pending/unreviewed, paths in own folder, one pending per person. An admin can never review their own submission. `swap_main_photo` = the one way to set an extra photo as main (each photo keeps its own screening result). |
| `20270348_identity_verified_separate` | 3 | New `profiles.id_verified` (+ `id_verified_at`), set only by `admin_approve_id_verification`, never by the person or photo screening. Approving an ID no longer marks the photo screened. `photo_verified` keeps meaning "main photo passed screening" and keeps controlling profile visibility (5 read policies use it; unchanged). Views + Friends Browse return `id_verified`. |
| `20270349_account_suspension` | 2 | `profiles.suspended_at` (only via the two admin functions). `admin_suspend_user(user, reason, report, end_sessions = true)`: admin only, never yourself, reason required, report must be about that account; hides the profile, ends sessions + refuses sign-in (`auth.users.banned_until`, which Supabase Auth enforces), records the action. `admin_reinstate_user(user, reason)`: restores the earlier hidden choice, lifts the ban, records it. `account_moderation_actions` = audit trail (admins read, nobody writes from a client). A suspended person's inserts/updates on 24 social tables are refused (`account_suspended`) whatever the path (app, direct API, server function acting for them). A suspended host's gatherings stay visible to people already in them, never to anyone new (so nobody new can join). Reports, blocks, deleting own content stay possible. |
| `20270350_phone_required_for_social` | 5 | Without a verified phone (`auth.users.phone_confirmed_at`, i.e. SMS-confirmed): no 1:1 / gathering / community / plan chat messages, photo comments, questions to a host, waves, friend requests, invitations, hosting a gathering or starting a community (`phone_required`, 11 tables, INSERT). Absent from Dating discovery, Friends Browse and Friends Crossed Paths (`person_discoverable`). Still allowed: browsing, joining / marking Interested, accepting what others send, the whole business side, asking businesses. Email sign-up stays available. |
| `20270351_crossed_paths_push_consent` | 6 | The crossed-paths push names the other person only when both are discoverable (`person_discoverable`), the other's profile is visible, there is no block either way (the old trigger's block check could never work: it ran with no signed-in user), both opted into the SAME pool (both Dating, or both open to friend discovery), and the recipient's proximity notifications are on. Otherwise no push at all (never a nameless one: the push data carries the other person's id). |
| `20270352_id_verification_upload_limits` | 4 (part) | id-verification bucket: images only (JPEG/PNG/WebP/HEIC/HEIF), 10 MB each. |

Dependencies: 0348 needs 0347; 0349 needs 0348; 0350 needs 0349; 0351 needs 0350. 0352 is independent.

App changes (ship with a new build; harmless before the migrations except where noted):
- Verified badge + "Verified only" filters read `id_verified` (ViewProfile, Dating cards + filter, Friends cards + filter;
  `proximity.js`, `friendDiscovery.js`). **Needs 0348 live first** (the selects name the new column).
- "Set as main photo" calls `swap_main_photo` (**needs 0347 live first**). New finding: the old client update could never
  have worked, `profile_photos.photo_verified` has no client UPDATE grant, so it failed halfway in production today.
- Admin Reports: Suspend calls `admin_suspend_user` with the report, says what the server actually did, offers Reinstate
  (also on resolved reports). **Needs 0349 live first.**
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
  rolled back). Rollbacks: `scripts/rollback/20270347..20270352_*.rollback.sql`.
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

## Decisions needed from the owner

1. **Phone-session seed vs fix 5.** The approved seed (code 7530ef9b5bb4) creates its test gatherings as its test
   hosts, who have no phone. With 0350 live the seed fails at its first gathering (proven, rolled back). Either deploy
   0350 after Session B, or approve a one-line seed change (give the 3 test people a fictional verified phone) and a new
   seed code. I did not change the approved seed.
2. **ID image retention (proposed, NOT built):**
   - approved: delete the selfie + ID images 7 days after the decision (the decision row stays: who, when, approved);
   - rejected: delete 30 days after the decision (time to resubmit or appeal with the admin's notes);
   - pending and never reviewed: auto-reject and delete after 60 days;
   - orphan uploads (no submission row): delete after 24 hours;
   - account deletion: the whole folder at once (built in `delete-account`, not deployed).
   Built as one scheduled edge function using the Storage API (the database can't delete stored files), plus an
   `images_deleted_at` column and a Privacy Policy sentence. Needs your approval of the periods first.
3. **Suspended people and their own data.** A suspended account can't sign in, so it can't delete itself or export its
   data in the app. Recommend: the Privacy Policy names a support email for those requests. (Not built.)
4. **The email test account** loses social features under fix 5. Fine for its business-owner role; if it is also meant to
   act as a consumer in tests, it needs a verified phone (an account-level change: your call).

## Must be deployed before external users join

All six migrations (0347-0352), the app build with the client changes above, the `delete-account` deploy, the retention
job once approved, and **N1 below** (not built). Without 0347, any new account can make itself admin.

## New findings while tracing (reported, not fixed)

- **N1 (HIGH, launch blocker, proven read-only):** any signed-in user can read other visible users' `expo_push_token`
  (and Spotify tokens if stored; none are today) from `profiles` / `people_visible_to_me`: the table has a full SELECT
  grant and the read policy is row-level only. With someone's Expo push token, anyone can send them notifications that
  look like Nearby's unless Expo push security (an access token on sends) is on. Proven: applereview read 2 other
  accounts' push tokens (rolled back). Fix proposal: column-level SELECT grants on `profiles` (as `gatherings` already
  has), excluding tokens, counters and settings, and dropping those columns from `people_visible_to_me`; needs a full
  column audit of every client read first. Your approval needed.
- **N2 (fixed by 0347):** profile INSERT had no privileged-column guard (self-admin, above).
- **N3 (fixed by 0347):** "Set as main photo" failed halfway (above).
- **N4 (small, open):** `moderate-photo` screens the photo path it read, then marks the profile's current photo; a photo
  changed in those seconds could inherit the result. 0347 resets the flag on every client photo change, which narrows it
  to a change made during the screening call itself. Fix = compare the path before writing (edge function change).
- **N5 (open):** after a suspension, the person's current access token stays valid up to 1 hour: reads still work in
  that hour, every social write is refused.
