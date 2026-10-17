# Item 146: gathering-pin averaging, security assessment (2026-10-17)

Owner (2026-10-17): reopen the security ASSESSMENT of item 146's pin; do not change the implementation without a reviewed
fix. Item 146 status: implemented, averaging risk still requires assessment. **Nothing changed by this document.**

## The weakness

`private.gathering_pin(gathering_id, lat, lng)` (migration 20270320) = the precise point + an HMAC-keyed offset per axis in
[-0.0035, +0.0035) deg, keyed by the GATHERING id. Each gathering at the same point gets an independent offset, so:

- **Intersection:** the point lies inside every pin's +/- 0.0035 box. With n gatherings at one point, the expected width
  of the intersection is about 0.014/(n+1) deg per axis: n=1 0.007 (~780 m), 4 ~= 310 m, 10 ~= 140 m, 30 ~= 50 m, 52 ~= 30 m.
- **Mean:** the mean of the pins converges on the point (standard error ~= 0.002/sqrt(n) deg).
- **Who can collect pins:** any signed-in caller of `get_gathering_distances(any origin, ids)` for gathering ids it holds.
  While item 147 is open, every gathering id of every visibility is readable (anon included), so ids are not a barrier.
  `get_bounded_nearby_gathering_ids` and the map show the same pins.

## Does it happen in real data (prod, aggregated, no coordinates read out)

25 gatherings with a point, 2 hosts; 5 (host, point) pairs reused by 2+ gatherings, at most 4 at one point.
4 gatherings -> ~310 m box instead of ~780 m. **Recurring gatherings make it systematic:** `generate-recurring-gatherings`
(hourly cron) creates a new gathering per occurrence at the same point, so a weekly series from a host's home publishes
52 pins a year (~30 m). No recurring rows exist in prod today.

## Candidate fixes (none built)

All reuse item 148's mechanism (`private.location_pin`, the same server secret) with a 'gathering' scope.

**A. Item 148's rule as is: pin keyed by (host, 0.007 deg cell), independent of where in the cell the point is (recommended).**
- Averaging gains nothing: all of a host's gatherings in one cell share ONE pin, whatever their points.
- Known-point safe: learning one gathering's real point (e.g. a public café named in its title) reveals nothing about the
  host's other gatherings in that cell.
- What an observer can narrow a gathering to: the cell (~780 m x ~700 m), about the same as one item-146 pin today, and it
  never shrinks.
- Behaviour changes: a pin can sit up to ~1 km from the meet-up point (today <= ~550 m); distance lines can shift up to
  ~0.5 mi (today ~0.25 mi); `get_bounded_nearby_gathering_ids`' bounding-box pre-filter must widen from 0.0035 to 0.007
  (the exact test stays on the pin, so the radius rule itself is unchanged: "inside the radius" = the pin is); every
  gathering pin moves once more; several gatherings by one host in one cell stack on one pin (the map needs to show a stack
  or offset them visually on the client, never by a server-side per-gathering offset).
- Edge residual as in item 148 (a point near a cell edge can show two neighbouring cells across gatherings).

**B. Same rule with a 0.0035 deg cell (~390 m).**
- Keeps item 146's approved look exactly: pin within 0.0035 deg per axis of the point, distance shifts <= ~0.25 mi, the
  pre-filter widening stays 0.0035.
- But the observer's region becomes the cell (~390 m box) at once: tighter than today for a one-off gathering (~780 m),
  better than today from 3 gatherings at one point up. Trade-off: weaker for most gatherings, stronger for repeat hosts.

**C. Rejected: keep the offset around the point but key it by (host, cell) instead of gathering id.** Repeated gatherings at
one point then share a pin, but every pin = point + the SAME offset: one known point (a public venue) reveals the offset
and with it every other gathering of that host in the cell, including home. Not safe.

**D. Rejected: snap only (pin = cell centre, no secret).** Anyone can compute it; it leaks nothing more than the cell, but
all hosts' gatherings in a cell collapse onto one public spot and the cell centre may be a real home. A gives the same
protection without that.

## What a reviewed fix needs (when the owner approves one)

- Owner decisions: A or B (cell size = displacement vs protection); acceptance of the map/distance/radius changes above.
- Migration: `private.gathering_pin` -> `private.location_pin('gathering', host_id, ...)`; pre-filter widening per the cell;
  no change to `get_gathering_meetup_point` (host + approved attendees keep the exact point) or to who can read what.
- Journey `preciseLocation` extended: n gatherings by one host at one point (and spread inside a cell) -> one pin; a known
  point reveals nothing about the others; radius tests on the pin; distances to the pin. Full journeys, from-scratch replay,
  grants parity, device checks (item 146 checklist 1-3 re-run).
- Independent of item 147, but item 147 narrows who can collect pins at all; doing item 147 first is consistent with that.
