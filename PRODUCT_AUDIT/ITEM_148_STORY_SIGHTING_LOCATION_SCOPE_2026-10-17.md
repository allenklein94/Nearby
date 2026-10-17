# Item 148: Stories & Sightings location privacy (scope, 2026-10-17) - HIGH PRIORITY PRIVACY

Owner decision (2026-10-17): its own security item, separate from item 146 (gathering precise point, done) and item 147
(non-public gathering rows, open). (Unrelated to the older "Item 148" of 2026-09-19 in CLAUDE_HISTORY.md, business
notification mute groups.)

**Status: SCOPED, INVESTIGATED, NOT STARTED, OPEN.** Nothing changed. The fix needs the owner's approval of a remediation
plan (proposal below, decisions D1-D4).

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
- No producer exists in the repo (clients cannot insert: RLS refused the probe's insert; no RPC writes it), so precision is
  whatever the absent producer wrote. `get_sighting_fuzzed_coords` has no client caller (dead) and its md5 offset is
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
