# Item 148: Stories & Sightings location privacy (scope, 2026-10-17) - HIGH PRIORITY PRIVACY

Owner decision (2026-10-17): its own security item, separate from item 146 (gathering precise point, done) and item 147
(non-public gathering rows, open). (Unrelated to the older "Item 148" of 2026-09-19 in CLAUDE_HISTORY.md, business
notification mute groups.)

**Status (2026-10-17): IMPLEMENTED (owner, D1-D4 LOCKED), LIVE; device and residual checks OPEN (see "Still open" at the end). Not complete.** Migration
`20270321_story_sighting_location_privacy.sql` applied to production; build + verification record at the end of this file
("Build and verification"). Device checks: `ITEM_148_STORY_SIGHTING_LOCATION_DEVICE_CHECKLIST_2026-10-17.md`. Photo/video
metadata (finding 7) stays DEFERRED and UNRESOLVED until a real-device test.

Acceptance criterion (owner): no unauthorized user can retrieve or reconstruct a person's precise location through Stories
or Sightings, while approved location-dependent features keep working.

## Findings (confirmed live, 2026-10-17)

Evidence: `scripts/live-verify/item-148-story-sighting-location-probe.js`, one transaction under the REAL API roles
(`set local role anon` / `authenticated` + JWT claims, like journey `preciseLocation`), always rolled back (checked after:
0 probe profiles, 0 stories left). Test point mid-Atlantic (12.3456789, -45.6789123).

**Production data today:** `stories` has 0 rows, `sightings` has 1 row. No real person's location is exposed right now;
the exposure is in the design and starts with the first public story.

### Stories (the real exposure)

| Who | Direct `latitude/longitude` read | `get_public_stories_with_fuzzed_coords` |
|---|---|---|
| Signed out (anon) | 0 rows (table + column grant exist, but the only SELECT policy is for `authenticated`) | permission denied |
| **Any signed-in stranger** | **exact point of every live public story** (7 decimals, as the phone sent it) | **pin + id; subtracting `md5(id)` gives the exact point** |
| Accepted friend | exact point of public AND friends-only stories that carry coordinates | same as stranger |
| Blocked either way | nothing | nothing |

1. **Raw columns readable.** `stories.latitude/longitude` have column SELECT for `anon` and `authenticated`. The RLS policy
   `Stories visible to poster, connections or the people there` lets every signed-in user read every live public story
   and every live business moment (`partner_id is not null`). So the map's fuzz is irrelevant: the exact point is one
   `select latitude, longitude from stories` away. A filter on the column also works (oracle), but is moot next to the read.
   Correction to CLAUDE.md's residual note: anon gets no rows (no anon policy); the exposure is to signed-in users.
2. **The map pin is reversible.** The RPC returns `id` + `latitude + f(md5(id||'lat'))`; the offset uses only the public id,
   so `pin - f(id)` = exact point (probe: recovered 12.3456789 / -45.6789123 exactly). Same flaw item 146 removed for gatherings.
3. **What the point means.** `uploadStory` (`src/services/stories.js`) captures the phone's GPS fix at posting time for
   public stories and business moments, unrounded, next to `user_id` (and the RPC returns `user_id`). That is a named
   person's exact position at a known time, often home. Rows expire after 24 h (hourly `delete_expired_stories` deletes
   them); expired rows are already invisible to others.
4. **Business moments store a location no feature uses.** Business moments are inserted with `is_public = false`, so they
   never reach the map RPC, yet the client still captures the owner's GPS and every signed-in user can read it directly.
5. **Friends-only stories:** the client sends no coordinates for them, but the table accepts them and friends can read them.
   Minor (the poster's own client would have to send them), closed by the same fix.
6. **Even a secret pin can be averaged (design point for the fix).** A pin that is random per story but bounded
   (+/- 0.0035 deg, ~390 m) leaks when the same person posts repeatedly from the same place: the true point lies inside the
   intersection of every pin's box, whose expected width is about 0.014/(n+1) deg per axis (10 stories from
   home ~= a 140 m box, 30 ~= 50 m). Item 146's
   gathering pin is keyed per gathering id and has the same property for a host who hosts many gatherings from the same
   point; recorded here as an observation, item 146 is not reopened.
7. **Story media metadata: NOT VERIFIED.** Story photos/videos are uploaded as the picker returns them
   (`launchCameraAsync` / `launchImageLibraryAsync`, quality 0.7), never re-encoded through `expo-image-manipulator` /
   `utils/mediaBudget.js`. Whether GPS EXIF survives is platform-dependent and needs a real-device file check (library photos
   for gathering memories are the most likely carriers). Public-story media is readable by every signed-in user (storage
   policy follows the story row).
8. Paths checked and clean: no views or rewrite rules over `stories`/`sightings`; neither table is in the realtime
   publication; no edge function reads them; no client `select` names `latitude/longitude` (the map uses only the RPC); the
   poster cannot UPDATE a story (no policy, 0 rows); gathering memories carry no coordinates (client sends none).

### Sightings (smaller, latent)

| Who | `approx_area` read | `get_sighting_fuzzed_coords` |
|---|---|---|
| Signed out | denied (`is_blocked` not executable by anon) | permission denied |
| Stranger | nothing | nothing |
| **The other participant** | **`approx_area` directly: 4 decimals (~11 m)** | pin; md5 reversal gives `approx_area` back |

- `approx_area` is a text `"lat,lng"`. The only production row has 4 decimals (~11 m), so the name "approx" is not true.
  The other person in a sighting learns where they crossed paths to ~11 m (where the other person was at that time).
- Clients cannot insert (RLS refused the probe's insert). CORRECTED below: the producer is the deployed `report-presence`
  edge function (its repo source was an empty file), writing the client's 4-decimal area. `get_sighting_fuzzed_coords` has no client caller (dead) and its md5 offset is
  reversible, but moot next to the direct read.
- Related, already in residuals and NOT part of this item: the crossed-paths push names the other person regardless of
  Dating consent.

## Proposed remediation (for owner approval; smallest safe fix first)

No flow in the product needs a story's or a sighting's exact point: the map shows a blurred pin, and nothing else reads them.
So the smallest safe fix is to **never keep the exact point**, rather than guard it.

1. **Stories: store only a blurred point (D1).** A BEFORE INSERT/UPDATE trigger replaces `latitude/longitude` with the
   server-side pin before the row is written; the exact fix never lands in the table, so no read, oracle, backup or replay
   can return it. The pin uses item 146's server-only secret (`private.pin_secret`, one mechanism, no second scheme) and is
   **keyed by the person + a coarse cell, not the story id** (D2) so posting again from the same place gives the same pin
   and averaging (finding 6) gains nothing.
2. **Revoke client SELECT on `stories.latitude/longitude`** (column allowlist, like item 146) as defence in depth; the map
   RPC returns the stored pin as is (no md5 offset). No client code changes (none reads the columns).
3. **Business moments: no coordinates (D3).** Drop the GPS capture for `partnerId` in `uploadStory` and null them in the
   trigger for `partner_id` rows (no feature uses them; a business's place comes from its profile).
4. **Sightings (D4):** revoke client SELECT on `approx_area`; coarsen it at write (same pin/cell rule) so the other
   participant never gets better than the pin; drop the unused `get_sighting_fuzzed_coords` (or make it return the stored
   coarse value). No client change (clients select only id/user_a/user_b/last_seen_at).
5. **Media metadata:** verify on a device first (finding 7). If GPS EXIF is present, re-encode story images through the
   existing media budget path before upload (videos: check container metadata). Not built without device evidence.
6. Existing rows: `stories` is empty; the one `sightings` row is coarsened by the migration.

### Owner decisions needed

- **D1** Store only the blurred point (recommended) vs keep the exact point and only guard it (more surface, no product use).
- **D2** Pin keyed by person + cell (recommended, defeats averaging) vs per story (item 146's style, averageable).
  Pin size: keep ~390 m (+/- 0.0035 deg, today's map look) unless the owner wants coarser.
- **D3** Remove business-moment location capture (recommended).
- **D4** Sightings: coarsen + revoke + drop the dead RPC (recommended).

## Verification plan (when approved)

- A journey under the real roles (`storySightingLocation`): anon, stranger, friend, blocked, poster, both sighting
  participants: no exact point by direct read, `select *`, whole-row read, column filter, the map RPC (old md5 reversal
  fails), the sighting RPC; stored point = the pin; the same person posting twice from one place gets the same pin; pin
  within the bound; business moment stores no coordinates; map still shows public stories (journey `gatheringMemory`'s
  `publicMemoryOnMap` step keeps passing).
- Grant guard test like `gatheringPreciseLocationGuard.test.js` (no client SELECT on the location columns).
- Full Jest + all journeys; from-scratch replay incl. the migration; grants/policies replay = prod.
- Device: story pin on the Discover map, posting a public story and a business moment, EXIF check on uploaded media.
- Changes to existing pins/distances: story pins move from md5-offset to the secret pin (same size); no distances are
  shown for stories.

## Not in scope

Gathering coordinates (item 146, done; finding 6 noted only). Non-public gathering rows (item 147). The crossed-paths push
naming (existing residual). Any other table holding a person's location (e.g. profile/last-known location) is not audited
here; worth a separate pass if the owner wants one.

## Build and verification (2026-10-17, owner approved D1-D4)

**Built (migration 20270321, LIVE):**
- `private.location_pin(scope, owner_key, lat, lng)`: the point's cell on a fixed 0.007 deg grid and a pin inside it
  chosen by HMAC-SHA256 with item 146's server-only secret (`private.pin_secret`) over scope + owner + cell. It depends only
  on (person, cell), never on where in the cell the point was, so repeated posts from one place give ONE pin and averaging
  learns nothing beyond the cell. Middle 90% of the cell, so pinning a pin returns itself.
- Stories: BEFORE INSERT/UPDATE trigger `story_location_to_pin` stores the pin in `latitude/longitude` in place of the
  point (D1, D2); a business moment (`partner_id`) stores nothing (D3); half/out-of-range/NaN stores nothing.
- Sightings: BEFORE INSERT/UPDATE trigger `sighting_area_to_pin` stores the pair's pin (order-independent key) in
  `approx_area` at 6 decimals; unparseable stores nothing (D4). The one production row was re-pinned in place.
- Column allowlists (defence in depth only): no client SELECT on `stories.latitude/longitude` or `sightings.approx_area`.
  Forward rule: a new column on either table needs `grant select (<col>)` in its migration.
- `get_public_stories_with_fuzzed_coords` returns the stored pin (same signature, grants: authenticated only); also never
  a business moment. `get_sighting_fuzzed_coords` DROPPED: no caller anywhere (its only client call was removed on
  2026-07-28 in commit 00005af2), so the sighting map pins (`SightingsOverviewMap`, the single-sighting map button) have had
  no coordinates since then and still have none. Restoring them would need its own decision (a pin-returning read).
- Client: `uploadStory` asks for a location only for a public personal story (never a business moment) and sends it
  rounded to 3 decimals (~110 m), so the exact fix never leaves the phone. Business web export regenerated.

**Paths audited:** grants (table, column, function) for anon/authenticated; the RLS policies on stories, sightings,
story_views and story storage (the storage policy reads only `media_path`, granted); no views/rules over either table; not
in the realtime publication; no edge function reads them; every SECURITY DEFINER function touching them (purge, delete-
expired, daily limit, new-story push, crossed-paths push: none returns a location); every client select (guard). Postgres
logging: `log_statement = ddl`, parameters never logged on error (`log_parameter_max_length_on_error = 0`), no pgaudit, so
an insert's values are not written to the database logs; combined with client rounding the server never receives the
exact fix. Not inspectable from here: Supabase's own API gateway logs (request bodies are not normally logged) and
production backups/PITR history, which may still hold the one sighting row's previous 4-decimal value until they age out.

**Verified:**
- Journey `storySightingLocation` (14 tests, real roles): stored value is the pin in the right cell, no column holds the
  exact value; 31 posts from one place with ~30 m jitter + one ~250 m away in the same cell = 1 distinct pin, mean = the
  pin; another cell / another person = another pin; a trusted rewrite to the exact point stores the pin again; business
  moment stores null; half/invalid coordinates store null; map RPC = stored pin, md5 reversal no longer gives the point,
  no business moment on the map; sighting = pair pin (either order), unparseable = null, old RPC gone; direct reads
  (column, `*`, filter, whole row) refused for anon, stranger, friend, poster; the app's own column lists still read;
  pin/trigger functions and the secret unreachable. Mutation check on the rebuilt DB: with the story trigger dropped and
  the table grant restored, 8 of 14 fail; restored, 14/14.
- Guard `src/utils/storySightingLocationGuard.test.js` (8): client selects name granted columns only, no location embed,
  nothing calls the dropped RPC, `uploadStory` capture rule + rounding, triggers + secret in the migration, forward rule.
- Full Jest 459 suites / 6121 passed. Journeys 445/445 with the migration as prelude on prod, then 445/445 on prod after
  applying (no prelude). From-scratch replay 445/445 migrations, journeys 445/445 on it, booking + offer-revision
  concurrency pass; grants replay = prod 1177/1177 (tables, the three tables' column SELECTs, non-extension functions in
  public/private); the four new/changed function definitions identical (md5). Probe
  `scripts/live-verify/item-148-story-sighting-location-probe.js` on prod after: direct reads "permission denied", the
  md5 reversal returns a point ~0.004 deg (~430 m) off, not the point, the sighting RPC does not exist.

**Behaviour changes to know about:**
- Story map pins: the pin is anywhere in the ~780 m x ~700 m cell (South Palm Beach) holding the post, so it can sit up to
  ~1 km from where it was posted (before: up to ~550 m, but reversible). What an observer can narrow the post to is the
  cell, about the same area as the old +/- 0.0035 box. Several stories by one person from one place stack on one pin.
- Known residual (documented, accepted by design): a place within GPS jitter of a cell edge can land in two neighbouring
  cells across posts; two pins then reveal the point is near their shared edge (one axis narrowed; a point only near a corner).
- Story pins carry `user_id` as before (the map shows whose story it is); only the location became coarse.

**Not done / not verified:** device checks (checklist); EXIF/metadata in story media (DEFERRED, unresolved); a signed-in
REST probe through the real API (no test account; the journey runs the same roles inside the database); item 146's
averaging weakness (documented in its scope doc, not changed).

## Follow-up (2026-10-17): corrections, open checks, new findings

**Correction: a sightings producer DOES exist, live.** Earlier this document (and CLAUDE.md) said none exists. The repo's
`supabase/functions/report-presence/index.ts` was an EMPTY file, but `report-presence` v11 is deployed and ACTIVE. Its
source (recovered read-only from the deployed bundle's source map, now restored verbatim into the repo; not redeployed)
takes the client's 4-decimal area (`proximity.js` `coarseAreaLabel`, ~11 m), upserts `presence_reports` (one row per
person, area + time), finds others in the same ~11 m bucket (3x3 for premium) within 10 min, and upserts a `sightings` row
per pair with `approx_area` = that area. Item 148's trigger pins `approx_area` on that upsert too, so crossed-paths
detection keeps working (it matches on `presence_reports`, not on `approx_area`) and sightings no longer keep the ~11 m value.
The device checklist's check 8 covers crossed paths still appearing.

**New finding A (reported, not changed): `presence_reports` keeps each person's last area at ~11 m indefinitely.**
Server-only (RLS on, no policies: clients read and write nothing; `confidenceMode.js`'s read of it therefore always gets 0
rows), 2 rows in prod (latest 2026-10-17). The matching needs a fine bucket while fresh (10-minute window), but
`purge_expired_sightings()` (which deletes presence rows older than 1 h and expired sightings) is **not scheduled**: there
is no cron job for it, so presence rows never age out and the one sighting (expired 2026-09-07) was never deleted.
Smallest fix to propose: schedule the existing purge (e.g. every 10 min). Needs its own approval (it deletes data).

**New finding B (reported, not changed): two more deployed edge functions have EMPTY sources in the repo:**
`delete-account` (v8, ACTIVE) and `moderate-photo` (v16, ACTIVE). A redeploy from the repo would deploy nothing. Not
location-related; recovering their sources the same way is a separate step.

**Production backups (the old ~11 m sighting value):** organisation plan = Free. Management API
`/database/backups`: `pitr_enabled = false`, **0 backups listed**, `walg_enabled = true` (WAL archiving is on:
`archive_command = admin-mgr wal-push`). So no backup the owner can restore exists, but Supabase's internal WAL archive
may still hold the row's earlier values (written 2026-08-23 .. 2026-09-05, overwritten 2026-10-17). Its retention for a
Free project is not published in anything this session can read and cannot be inspected through the API. **Not assumed
gone:** the owner must ask Supabase support for the WAL/backup retention of project `enmosvippabmuqslzrox`, and record the
answer and the resulting expiry date here. (`presence_reports` still holds current ~11 m areas live, finding A, which
matters more than the archive.)

**Signed-in API test: still OPEN.** The journey covers the `authenticated` role inside the database; a request through
the real REST API with a real session has not been made. It needs an authorized disposable test account (create, probe
`stories?select=latitude`, `select=*`, the map RPC, `sightings?select=approx_area`, `rpc/get_sighting_fuzzed_coords`,
then delete the account), which needs the owner's go-ahead.

### Still open (item 148 is not complete until each is recorded)

1. Photo/video GPS metadata: unresolved until device check 10; then scope removal if present.
2. Device checklist `ITEM_148_STORY_SIGHTING_LOCATION_DEVICE_CHECKLIST_2026-10-17.md`, checks 1-9.
3. Signed-in API test through the real API with an authorized test account.
4. Backup/WAL retention confirmed with Supabase and the expiry date recorded.
5. (Related, separate approvals) presence purge scheduling (finding A); empty function sources (finding B).
