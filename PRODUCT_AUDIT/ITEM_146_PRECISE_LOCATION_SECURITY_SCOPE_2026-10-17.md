# Item 146: Gathering precise-location database security (scope, 2026-10-17)

Owner decision (2026-10-17): scope as its own security item, separate from item 145. The existing protected lookup
(`get_gathering_meetup_point`) is the approved route, but it is not enough on its own.
(Unrelated to the older "Item 146 (2026-09-18) Universal Plan, pass D".)

**Status: SCOPED, NOT BUILT.** Nothing in the database or app changed for this document. Every probe below ran on
production inside a transaction that was rolled back, on a disposable gathering (`...0a1450`, invite-only, not public).

## Required outcome (owner)

1. Only the host and approved attendees can get a gathering's precise coordinates.
2. Pending requests, waitlisted people, strangers and signed-out visitors cannot.
3. Ordinary gathering reads and discovery keep working, without the precise columns.
4. `get_gathering_meetup_point` stays the approved route.
5. Audit grants, RLS, views, RPCs, API exposure and every client read before changing permissions.
6. Regression tests that try direct coordinate reads for each role and gathering state.
7. Full Jest + journeys, a from-scratch rebuild including the migration, authorized directions still work.

Constraints: don't weaken other gathering data access; don't rely on UI or query omission; least privilege; no
alternate view/RPC/API path; document unavoidable compatibility changes before applying them.

**Acceptance:** an unauthorized user cannot get precise gathering coordinates through any supported database or API
read path. The host and approved attendees keep access.

## Audit findings (live, 2026-10-17)

### P1. Direct table read: CONFIRMED, every gathering, not only visible ones
- `gatherings` has a TABLE-level `SELECT` grant to `anon` and `authenticated`. That covers every column, so a
  column-level `REVOKE` alone changes nothing. The table grant has to go, replaced by a column list.
- The only SELECT policy is `Anyone can view gatherings` with `qual = true` (role public). Any row of any visibility can be read.
- Probe: as `anon`, `select title, precise_lat, precise_lng from gatherings where id = <invite-only probe>` returned
  `probe 26.461537,-80.072118`. The earlier report said "any gathering they're allowed to see". That understated it:
  the scope is every gathering.

### P2. `get_gathering_distances`: CONFIRMED EXACT LEAK, worse than P1 for signed-in users
- `SECURITY DEFINER`, executable by `authenticated`, takes any gathering ids and checks no visibility.
- Its `fuzzed_lat/lng` = precise + an offset derived from `md5(id || 'lat'/'lng')`. The id is public and the formula is
  in the repo, so anyone can subtract the offset. Probe as a random signed-in uuid: recovered `26.461537,-80.072118`,
  the exact point of the invite-only probe.
- `distance_miles` is measured to the PRECISE point from any origin the caller chooses, unrounded. Three calls
  trilaterate the point even without the fuzz.
- Callers: `services/gatherings.js` (3), `services/homeDashboard.js` (1): map pins (fuzzed) and distance lines/scoring.

### P3. `get_bounded_nearby_gathering_ids`: location oracle
- `authenticated`, caller-chosen origin and `max_miles`, radius tested on the precise point. Repeated calls with a
  shrinking radius or moving origin narrow a discoverable future gathering down to its point. (Public gatherings are
  returned whatever the distance, so this mainly exposes non-public discoverable ones.)

### P4. `count_gatherings_near_batch` / `count_gatherings_near`: location oracle
- `authenticated`, caller-chosen points, no size cap. Counts every future gathering of ANY visibility inside a
  ±0.001° (~110 m) box around each point. A grid scan finds every gathering to ~110 m. Probe: `count_gatherings_near`
  at the probe's rounded point = 1.
- Client: only `_batch`, from `services/places.js` (Google place coordinates, up to 20; "N gatherings hosted here").
  The single-point `count_gatherings_near` has no caller.

### Checked and not leaking
- `get_gathering_meetup_point`: host or approved only (journey `gatheringDirections` 5/5).
- `plans.location_lat/lng` (copied by `create_plan_from_gathering`): readable only by `created_by` (the host).
- `business_requests.latitude/longitude` (copied from the gathering): readable by the requester, approved attendees,
  group-plan participants and organizers. No client-executable function returning latitude reads `business_requests`.
  To re-verify during the build: every business-facing RPC goes through `business_safe_request_summary`.
- Views over `gatherings` (`category_health`, `category_health_by_area`, `gathering_social_*`): no client grants.
- `gatherings` is not in any realtime publication; `pg_graphql` is not installed; no RLS policy references the precise
  columns; every other function reading them is either not client-executable or a trigger.
- `area` (0.01° grid, ~1 km) and `wide_area` (0.1°) stay readable. That is coarser than the pin fuzz, so acceptable.

### Found, out of this item's scope (needs its own decision)
- **Row-level exposure of non-public gatherings.** With `qual = true`, a signed-out visitor can read every invite-only,
  friends-only and community gathering's title, description, host, time, area, capacity, etc. Item 146 fixes only the
  coordinates (owner: don't change other gathering access here). Even after item 146, a stranger can still see that
  an invite-only gathering exists and roughly where. Recommended as its own item, high priority (it touches every
  gathering read, invite links and previews).

### Client reads (all 32 `from('gatherings')` calls in `src/services`, plus embeds and edge functions)
- Every read names its columns (`SAFE_GATHERING_FIELDS`, `NEARBY_GATHERING_SELECT`, `FRIENDS_ACTIVITY_FIELDS`, short lists).
  None names `precise_*`; no `gatherings(*)` embed; edge functions read via the service role.
- **One breaks under a column grant:** `createGathering` ends with `.insert({...}).select().single()` = `select=*` on
  the returned row, which would be refused with "permission denied for table gatherings". Publishing would stop working.

## Proposed fix (one migration + one client line)

a. **Column grants.** `revoke select on gatherings from anon, authenticated;` then `grant select (<every column except
   precise_lat, precise_lng>) on gatherings to anon, authenticated;`. INSERT/UPDATE on the precise columns stay for
   `authenticated` (the host writes them; RLS limits UPDATE to the host). The host's own direct read is denied too.
   The host uses the lookup, same as attendees (least privilege).
b. **`get_gathering_distances`:** offset from a server-only secret (a private table with no client grants), never from
   anything a caller can compute. `distance_miles` measured to the fuzzed point (a distance then reveals no more than
   the pin). Rows only for gatherings the caller may see (`_viewer_can_see_gathering`).
c. **`get_bounded_nearby_gathering_ids`:** the radius test on the same fuzzed point.
d. **`count_gatherings_near_batch`:** count only public, discoverable gatherings (what "hosted here" honestly means to
   anyone), cap at 20 points. Drop the uncalled `count_gatherings_near`.
e. **Client:** `createGathering` -> `.select(SAFE_GATHERING_FIELDS)`. Regenerate the business web export (it bundles this file).
f. **Guards:** live-verify `scripts/live-verify/gathering-precise-location-access.sql` (below); a Jest source guard that no client
   select on gatherings uses `*`/bare `.select()` or names `precise_*`; extend the replay's grant parity to table and column grants.
g. **New convention (forward compatibility):** Postgres column grants do not cover columns added later. Every future
   migration adding a `gatherings` column must also `grant select (<col>)` to anon/authenticated, or the app's reads of
   it fail. The live-verify asserts the client-readable set = all columns minus `precise_*`.

## Compatibility changes (to approve before applying)

1. **Every map pin moves once** (new secret offset, same ±0.0035° / ~390 m bound). Unavoidable: the current offset is
   public, so the existing pins already give the exact point away.
2. **Distances shift by up to ~0.25 mi** (measured to the pin, not the exact point). Effects: "0.3 mi away" lines,
   the `< 2 mi` close-distance score, and gatherings right at the radius edge may change. Wording unchanged.
3. **"N gatherings hosted here" on Places counts only public, discoverable gatherings.** Residual: a public gathering's
   venue is still findable to ~110 m (that's the feature). The alternative, comparing against pins, effectively
   switches the count off.
4. **Hosts lose direct table reads of their own coordinates.** No screen uses them; directions go through the lookup.
5. **Developer-facing:** new gathering columns need an explicit grant (item g).

## Verification plan

- Live-verify, rolled back, one gathering per state (public; invite-only), roles: anon, stranger, pending request,
  waitlisted, invited-not-joined, approved attendee, host:
  - direct `select precise_lat` / `select=*` / embed from `gathering_interest` -> permission denied for every client role;
  - ordinary `SAFE_GATHERING_FIELDS` read unchanged for every role;
  - `get_gathering_distances`: the md5 recovery no longer gives the point; `distance_miles` matches the fuzzed point;
    no row for a gathering the caller may not see; trilateration from 3 origins lands on the pin, not the point;
  - bounded-ids and count-batch probes resolve only to the pin / public gatherings; batch > 20 refused;
  - `get_gathering_meetup_point`: host + approved get the point; everyone else nothing.
- Journeys: extend `gatheringDirections` (direct-read denial per role) and run a create-gathering insert-return step.
  Full journeys + full Jest. From-scratch replay incl. the migration, journeys on it, table/column grant parity = prod.
- Device (after): Discover map pins, distance lines, Create -> publish, Get directions (item 145's checklist).

## Owner decisions needed before building

- **D1** Re-key the pin offset (compatibility 1-2). Recommended: yes. P2 can't be closed otherwise.
- **D2** Places count: public + discoverable only, capped at 20 (recommended), or remove the count.
- **D3** Row-level exposure of non-public gatherings: scope as its own item? Recommended: yes, high priority.
