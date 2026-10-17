# Place-count side channel (`count_gatherings_near_batch`): scope + lock conflict (2026-10-17)

**Decision (owner, 2026-10-17): Option A, final, plus a visible approximate-area line. BUILT + LIVE (migration 20270325); see
CLAUDE_HISTORY.md "Place-count oracle removed". Phone checks and native review still open.**

Owner asked (2026-10-17) to scope item 146 / item 146 Option A's remaining limitation #1. At scoping time nothing was changed: the
fix conflicted with item 146's locked behaviour, so per the owner's instruction this proposed the smallest safe revision first.

## Audit (as live, migration 20270320 section 4; 20270324 left it unchanged)

- `public.count_gatherings_near_batch(lats double precision[], lngs double precision[]) -> (idx, gathering_count)`,
  `security definer`, execute = `authenticated` only, at most 20 points per call.
- Counts future gatherings with `visibility = 'everyone' AND discoverable = true` whose **precise** point lies in a
  ±0.001° box (~220 m x ~200 m at 26° N) around each caller-chosen point. No rate limit, no tie to a real place.
- Only caller: `src/services/places.js` `searchNearbyPlaces` (Google Places results, up to 20) -> `gatheringCount` ->
  `ui.places.gatheringsHere` ("🎉 N gatherings here") on Discover's Places list (`DiscoverHubScreen.js:2140`).
- Response carries counts only (no ids, hosts, coordinates). That is already right; the counts are the leak.
- **Attack:** a signed-in account sends a 20-point grid per call (about two calls cover 1 km²); a non-zero
  cell locates a public, discoverable gathering's precise point to ~110 m, which item 146 otherwise restricts to the host
  and approved attendees (`get_gathering_meetup_point`). Refining with offset grids narrows it further (box edges).

## The exact conflict

Item 146's approved compatibility change 3 (`ITEM_146_PRECISE_LOCATION_SECURITY_SCOPE_2026-10-17.md`): *"N gatherings
hosted here" counts only public, discoverable gatherings. Residual: a public gathering's venue is still findable to ~110 m
(that's the feature). The alternative, comparing against pins, effectively switches the count off.* CLAUDE.md locks it as
"place counts public + discoverable only, max 20 points".

The conflict is built into the feature, not the code: a truthful "gathering **here**" for a future gathering IS its venue,
i.e. its precise point. Gatherings store no place id, so the server cannot tell a real Places lookup from a grid probe,
and rate limits only slow a scan (an attacker can use several accounts). Also checked and rejected:
- **Counting on the public pin:** leaks nothing new, but the pin sits up to ~390 m from the venue, so "here" becomes false
  (breaks the no-invented-numbers rule). Item 146 already rejected this.
- **Storing a Google place id at creation and counting by it:** still reveals the venue = the precise point. No safer.
- **Rate limiting alone:** defense in depth only; the owner's instruction rules it out as the only protection.

## Options (owner to pick one; each revises item 146 change 3)

**A. Remove the count (recommended, smallest).** Drop `count_gatherings_near_batch`; `searchNearbyPlaces` stops calling it;
`gatheringCount` and the "🎉 N gatherings here" line go away (`ui.places.gatheringsHere` unused, removed in 11 languages).
Leak closed completely. Cost: a secondary line that today is mostly 0 (no live market yet). No new strings.

**B. Keep a count only for busy venues, from past gatherings.** Count only gatherings that are already OVER (last 90 days),
public + discoverable, and show it only when **>= 5 distinct hosts** held them there (the `demand_min_people()` floor
precedent); below that, nothing (never 0). A future gathering can't be located; one host's routine can't be read; a
recurring series is caught by the distinct-host floor. Plus a per-account rate limit (e.g. 10 calls / 10 min) as defense in
depth. Cost: a new rule + wording change ("hosted here" means past), native review, a new journey; it shows almost never
until a real market exists.

**C. Keep it as locked.** Leave the ~110 m residual documented (today's state).

Either A or B: regression journey extended to `preciseLocation` (a 20-point grid around a public discoverable gathering
returns no cell that differs from an empty area; for B, a single host's past gatherings also stay invisible), the
`gathering-precise-location-access.sql` live-verify updated, a from-scratch replay, grants parity, business web export
regenerated (it bundles `places.js`).

## Related product check: the pin can sit up to ~0.5 mi from the meet-up point (Option A pins)

Kept as locked: the radius rule stays on the displayed pin. Finding: the UI does not say the pin is approximate to a
sighted user. Only the screen-reader labels do (`ui.mapView.gatheringA11y` "..., approximate location"). The visible
"0.3 mi away" line and the map pin read as exact. Sightings already show "An approximate area, not an exact location"
(`ui.smallParts.anApproximateAreaNotAn`, `SightingMapModal.js`). Proposal (needs the owner's go-ahead, new visible copy):
reuse that existing string as a quiet line under a gathering's map/detail location for viewers who are not host/approved,
and prefix distances for those viewers with "About" (`About 0.3 mi away`) if a new string is acceptable. Host and approved
attendees already get the exact point and directions (item 145).

## Not done / not verifiable here

- Item 146 phone checks 1-3 + 12 (stacked pins): NOT run; no phone or simulator has ever been available to this session.
- Signed-in real-API test for items 147 + 148: still DEFERRED (owner), unverified.
- Remaining limitations stay as reported: area-value crossing narrows to >= ~111 m per axis (typically ~670 m); a spot
  within GPS jitter of a cell edge can show two neighbouring pins; pins/distances can differ from the real spot by up to ~0.5 mi.
