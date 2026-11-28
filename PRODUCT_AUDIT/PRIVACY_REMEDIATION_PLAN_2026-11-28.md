# Privacy + moderation remediation: findings and expedited plan (2026-11-28)

PREPARATION ONLY. Nothing was deployed or written. Production was read through the Management API with `read_only: true`
(verified: `transaction_read_only = on`), catalog and aggregate counts only: no profile value, email, phone or location was
retrieved. Migration packets, codes and per-migration checks: `BATCH1_APPROVAL_PACKET_2026-11-25.md` (hashes re-checked
today: all seven match HEAD, incl. the 2026-11-28 0353).

## 1. What is exposed today (production at 0347)

**Profiles (0348).** `profiles` has 107 columns; `authenticated` can SELECT **all 107** (anon: 0). The only row filter is
"own row OR (photo_verified AND not profile_hidden)". So any signed-in account reads every column of every visible profile.

| | Count today |
|---|---|
| Accounts in Auth | 10 (all the owner's; newest created 2026-10-27; **0 created in the last 30 days**) |
| Profiles / readable by any signed-in account | 4 / 3 |
| Readable profiles with a birthdate / sexual orientation / wide area (0.1 deg) | 3 / 1 / 1 |
| ... flagged admin / business manager / referral code | 1 / 1 / 1 |
| ... gender or ethnicity marked hidden but stored | 0 / 0 |
| Push or Spotify tokens left in `profiles` | 0 (moved by 0347, live) |

Fields that should never reach another account and are readable today: `birthdate` (exact), `sexual_orientation`,
`gender` / `ethnicity` even when `*_hidden` (hidden is enforced only by the app), `ethnicity_preferences`, dating
preferences (age, height, hair/eye), `interested_in_genders`, `wide_area`, `timezone`, `is_admin`, `managed_partner_id`,
`referral_code` / `referred_by`, every notification setting and counter, `intent_visibility`, `share_interest_in_demand`,
`voice_intro_path`. 0348 replaces this with a viewer-safe column list + `get_my_profile()` for the own row.

**Who could exploit it now:** email sign-up is still open in Auth, so a stranger could create an account through the API
and read the three visible profiles. No such account exists (above). Practical exposure today = the owner's own accounts.

**Crossed Paths (0353 + 0383).** On production the push trigger tells anyone the other person crossed, with no check of
either person's Dating / friend-discovery opt-in, blocks or visibility; sightings are recorded and readable regardless.
Today: 1 sighting row, **2 crossed-paths pushes ever (last 2026-11-27 21:08 UTC)**, all between the owner's accounts.
Server-side boundaries after Batch 1 (the 2026-11-28 0353 carries 0383's guard verbatim):
- push: `_crossed_paths_may_tell` per direction (both discoverable, visible, no block, same pool, proximity on);
- write: `aa_sighting_consent_guard` BEFORE INSERT/UPDATE drops a refused sighting (report-presence unchanged);
- read: the sightings policy also needs the pair rule, so a later opt-out / hide / block / suspension hides old rows;
- retention: `purge_expired_sightings` also deletes refused rows.
Verified (local replay to 0354, isolated network, `/workspaces/.nearby-verify/v481`): `crossedPathsConsent` (0383's own
journey) PASS, `sightingExpiry`, `storySightingLocation`, `datingConsent`, `profileColumnPrivacy`, `trustSafety`,
`photoScreeningBinding`, `build87Compatibility`, `appVersionCompatibility` PASS.

**What Batch 1 does NOT close (location processing):** `report-presence` still stores a presence report (rounded area,
about 11 m, deleted after 1 h) for any signed-in caller, opted in or not; the app sends it from Dating discovery and the
background task. 0353 stops it from becoming a sighting or a push. Stopping the storage itself is 20270384 (own
Crossed Paths switch, off by default, + anti-probing), which needs build 88's switch UI and a `report-presence` redeploy.
Moving 0384 into Phase A would turn Crossed Paths off for build 87 with no way to turn it on: **owner decision** (my
recommendation: keep 0384 in Phase B; the presence row lives 1 h and is never readable by another account).

**Suspension (0351).** Not on production (no suspension function or column). Until it is, an abusive account can only be
handled by deleting it. Matters only once outside users exist.

**Main photo (0349).** `swap_main_photo` does not exist on production, so build 87's "Set as main photo" fails. 0349 adds
it (plus the self-granted verification/admin guard and exact-file photo screening).

## 2. Interim containment (each is a production change: needs your approval; none is required if Batch 1 goes soon)

| Risk | Containment | Cost | Recommendation |
|---|---|---|---|
| Stranger signs up and reads profiles | Auth: `disable_signup = true` until Batch 1 + 0367's phone-only hook are live | blocks ALL new sign-ups (incl. phone; Tier 1 item 0(f) waits); existing accounts sign in normally; instant to undo | Do it only if Batch 1 can't go within days, or before inviting anyone |
| Crossed-paths push without consent | You turn off Settings > Notifications > proximity on your accounts | covers only your accounts (all accounts today) | Optional; Batch 1 fixes it server-side |
| No suspension | Don't invite outside users before Batch 1 | none | Already the rule |

There is no smaller safe migration than 0348 for the profile exposure (a column revoke IS 0348), and 0348's only device
gate (build 87 everywhere) is met: production's live sessions today = one `Nearby/87` session + one July session with no
app user agent.

## 3. Expedited, dependency-safe sequence

Number order is enforced by `deploy.js`; nothing is skipped or reordered.

| Step | Files | Gates (all existing; none bypassed) | Closes |
|---|---|---|---|
| 1a | 0348, then 0349 (+ `moderate-photo` redeploy, own approval) | R2 App Store Connect, R8 website pass before, same-day verified + encrypted backup, `--check`, your code per file | profile exposure, main photo, self-granted admin, Dating Browse empty on build 87 |
| 1b | 0350, 0351, 0352, 0353, 0354 (same day or next) | same backup window; 0351's Privacy sentence published with the `nearby-processing: 20270351` marker | suspension, verified phone for social, Crossed Paths consent (push + write + read + retention), ID bucket limits |
| 2-5 | 0355-0372 | as in the packets | rest of Phase A |
| 6+ | 0373-0435 | Wall B (section 4) | Phase B |

**Decision for you:** the packet lists R3 (Tier 1 passes on build 87) as a precondition of the whole batch. Tier 1 checks the
app on today's database; 0348/0349 fix two of Tier 1's known defects and have their own post-deploy checks. I recommend you
allow steps 1a-1b once R2 + R8 + backup are done, and run Tier 1 right after on the fixed database. If you keep R3 first,
nothing changes except the wait. The 2026-11-27 phone session does NOT count as Tier 1 (it was a findings session, not the
packet's list).

**Stopping conditions (any = stop, report, no automatic rollback or next file):** `--check` fails; a post-deploy check
or journey fails; `get_my_profile()` cross-user returns a row; the website pass after 0348 fails; a crossed-paths push
appears for a non-opted-in pair; build 87 can't sign in / open Profile / Dating after a file.

**Rollback:** each file has a proven rollback (to 0347 except ACL order + whitespace). 0348's rollback re-opens the
exposure (never once outside users exist); 0349's leaves issued photo links valid for their 15 min.

## 4. Phase B requirements (0373-0435)
- Build 88 (this branch, after merge) installed on EVERY device; "released" is not "installed": check production
  sessions by user agent (`Nearby/<n>`) shows no build <= 87 still refreshing, and TestFlight build 87 expired/removed.
- No App Store / external TestFlight copy of build <= 87 (0373 refuses unscreened public text; 0382 breaks 87's Dating).
- Anthropic credit returns allow/deny from `screen-business-content` (else every public post fails closed).
- Website re-exported from the merged branch and published (0419, 0422, 0424-0427, 0430 depend on it).
- Phase A post-deploy checks all PASS; 0435 (cuisine) is last and needs nothing beyond Wall B.
- 0434 (version policy) enforcement and strict mode stay OFF; each is its own later approval.

## 5. Owner decisions (2026-11-28, later the same day) + what was checked

**Decided by the owner:** Batch 1 (0348-0354) may go BEFORE Tier 1, with every other gate kept (R2 App Store Connect,
R8 website pass before + after 0348, same-day verified + encrypted backup, `--check`, one approval code per file). The
2026-11-27 phone session is NOT Tier 1. Registrations closed while the profile exposure is open. 0353 carries 0383's
consent guard. 0384 stays in Phase B only with effective interim containment (below).

**Registrations (read-only, 2026-11-28):** production Auth already has `disable_signup = true` (it was `false` on
2026-10-30; nothing in this session changed it). Providers on: email + phone only (no Google/Apple/other); the 0367 hook
is off. 10 accounts, newest created 2026-10-27: no account was created since sign-up was last open. With `disable_signup`
on, Auth refuses account creation on every public path (email sign-up, phone code to a new number, email code / magic
link to a new address); existing accounts keep signing in (phone code, password, magic link). The two server paths that
create or link accounts are service-key only (`setup-review-account` checks the service key; `review-login` makes a link
for the existing reviewer address). A live probe from this session was refused by the session's safety rules, so the
refusals are NOT yet proven on production: run `SUPABASE_ACCESS_TOKEN=... node scripts/trust-safety/signup-closed-check.js`
(fictional address + reserved 555 number only; signs the dedicated test account in and out). Side effect accepted by the
owner: Tier 1 item 0(f) (a NEW phone sign-up) waits until sign-up reopens (after 0348 + 0367's hook).
Reopening later = Auth `disable_signup = false` (own approval; only after 0348 and, for phone-only, 0367 + its switch).

**Who could have read profile columns:** only signed-in accounts, and all 10 are the owner's (production row count +
creation dates above); sign-up has been closed since at least today. The Management API's log endpoint changed
(`logs.all` removed; the replacement refused the old `edge_logs` source), so request logs were NOT reviewed from here;
the Free plan keeps about a day of logs anyway. Owner option: Dashboard > Logs > API, filter path `/rest/v1/profiles`,
look for any user agent other than `Nearby/87`, the website or Supabase's own. No profile VALUES were read in any check.

**Crossed Paths interim containment: options (no production change made).** What today's production does: the
`report-presence` service stores a rounded presence row (~11 m cell, deleted after 1 h, never readable by another
account) for every signed-in caller, and makes sightings + pushes without consent checks. Presence rows are ALSO read by
`get-online-status` and by the location-targeted push rules (`push_target_areas`: recommended-for-you, gathering
interest threshold, the area pushes), so they are not only Crossed Paths data.

| Option | What it does | Breaks / costs | When it can go |
|---|---|---|---|
| A (recommended) | 0353 as staged: no sighting is written, kept or read and no push is sent unless BOTH people opted into the same pool (+ visible, discoverable, no block); refused rows purged | presence row still stored 1 h for everyone (private) | Batch 1b |
| B | A + a guard in 0353 that drops the presence row of anyone opted into neither Dating nor friend discovery | those people lose online status and the location-targeted pushes until 0384 + build 88 | Batch 1b (needs 0353 re-tested + re-coded) |
| C | Owner turns off proximity notifications on their accounts now | pushes only; collection unchanged | now (all accounts are the owner's) |
| D | Stop `report-presence` now (undeploy / return early) | build 87's Dating Browse "Crossed Paths" + online status stop; the presence call fails silently in the app (not phone-checked) | now, but an edge-function deploy (own approval) |

No option is needed before Batch 1 for TODAY's data: every account is the owner's, sign-up is closed, and there is 1
sighting row. Recommendation: A in Batch 1b, C now if you want the pushes to stop at once; B only if you want collection
stopped before build 88 and accept the online-status/push loss for non-opted-in people. Later 0383 on top of 0353:
the full replay applies 0353 then 0383 unchanged (0383 re-creates the same functions/policies; journey `crossedPathsConsent`
passes at 0435), see section 6.
