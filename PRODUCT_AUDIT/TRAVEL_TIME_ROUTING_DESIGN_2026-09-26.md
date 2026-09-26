# Real travel time for typed asks: design (NOT approved, NOT built)

Status 2026-09-26: **design only.** No provider, no API key, no billing, no external call, and no location leaves the device
for routing. Building any of it needs the owner's explicit approval of this design **and** its cost (see "Approval gate").

## Why

Miles are a weak stand-in for "how easy is this to reach". Two miles across a river can be slower than four miles along a
train line. Today the words-only layer (`src/constants/transportMode.js`) handles what we can say honestly:

| Person says | Today (words only, built) | With real travel time (this design) |
|---|---|---|
| "I'm walking" | closer results lift relative to the others (+2 .. 0) | same weights, on walking seconds |
| "on my bike" | gentler lift (+1 .. 0) | same, on cycling seconds |
| "I'm driving" / "an Uber" | the close-by bonus is removed | unchanged (distance matters less; time is shown only as a fact) |
| "taking the train" | **no effect** (we have no transit data) | lift (+1 .. 0) on transit seconds; "About 12 min by transit" |

A distance the person states ("5 minutes away") outranks the mode, and no mode ever widens the search.

## The one interface ranking reads

`src/services/travelTime.js` already exists as the plug-in point, with no provider:

- `getTravelTimes(candidates, mode, origin, { keyOf })` -> `Map(candidateKey -> seconds)` or `null`
- `travelTimeSeconds(result, travelTimes, keyOf)` -> seconds or `null` (the internal concept: travel time for this result in this mode)
- `applyTransportMode(candidates, mode, travelTimes)` ranks on seconds when at least two results have them, else on miles

Ranking never knows which provider produced the seconds. Swapping Google for another provider changes only the provider.

## Provider options (verify current prices before approval; figures are from memory, not quotes)

| Option | Modes | Transit | Rough cost | Notes |
|---|---|---|---|---|
| Google Routes API, Compute Route Matrix | walk, bike, drive, transit | yes | ~$5 per 1,000 elements (basic), ~$10 with live traffic; a monthly free allowance exists | best coverage; ToS limits caching results |
| Mapbox Matrix API | walk, bike, drive | **no** | per-element, free tier | cheaper, no transit (the case that needs it most) |
| TravelTime API | walk, bike, drive, transit | yes | subscription | built for "reachable within N min" |
| Self-hosted OSRM / Valhalla + OpenTripPlanner (GTFS) | all | yes, with GTFS feeds | infra + ops, no per-call fee | most private; real operational burden per metro |

Recommendation: Google Route Matrix for a limited pilot (it has transit), behind the interface above, so a later move to
self-hosting changes nothing in ranking.

## Cost per typed ask

One element = one origin x one destination. Routing the top 20 results = 20 elements, about **$0.10 per routed ask** at
$5/1,000. 1,000 routed asks/day is about $100/day; 10,000 is about $1,000/day. That is why routing must be gated:

1. **Route only when a mode was said.** Most asks say none, so most asks cost $0.
2. **Pilot: transit only.** Walking and biking already rank reasonably on miles; transit is where miles say nothing.
3. **Top 10 for the pilot** (`MAX_ROUTED_CANDIDATES` is 20 today as the hard ceiling), and only results already inside the bounded search.
4. **Per-person cap** (for example 10 routed asks/day) and a **global daily budget** that switches routing off (falls back to miles) when spent.
5. **Cache** (below).

## What leaves the device, and privacy

- The client sends the edge function a **coarsened origin** (3 decimals, about 110 m; `coarsenOrigin`), the mode, and
  **candidate keys** only. It never sends destination coordinates; the server looks those up from its own tables.
- The edge function sends Google the coarsened origin and the destinations' coordinates. Destinations are businesses and
  gathering areas (gatherings already store a fuzzed `area_lat/lng`), never a person's home.
- Nothing is stored about the person: no origin, no mode, no routed list in any table or log. Logs record counts and
  latency only. Mode is never sent to a business, never used for people discovery, never in Home/Discover feeds.
- Disclosure: Settings/privacy copy says that when you mention how you are getting there, an approximate starting point is
  sent to a mapping provider to estimate travel times, and is not kept by Nearby.
- Google's own retention is governed by its terms; that must be read and accepted by the owner (a real external account).

## Server-side architecture

```
typed ask -> resolveIntent (client) -> ranked, bounded candidates
          -> getTravelTimes: provider = edge function `travel-times` (auth required)
               - checks per-user and global budget (counter table, service-role only)
               - resolves candidate keys -> coordinates server-side (skips unknown/unauthorized keys)
               - cache lookup; one Route Matrix call for the misses (1.2 s timeout)
               - returns seconds per key (null for failures)
          -> applyTransportMode ranks on seconds, else miles
```

The API key lives only as an edge-function secret, restricted to the Routes API. The client never sees it.

## Caching

- Key: origin cell (about 110 m) x destination id x mode x time bucket (15 min for transit/driving, no bucket for walk/bike).
- TTL: walking/biking 24 h (geometry barely changes), driving 30 min, transit 15 min.
- Store only cell ids and seconds, never raw origins. Google's terms restrict caching route results; confirm the allowed
  TTL before relying on it. A self-hosted provider has no such limit.

## Rate limits and failure

- Google enforces per-minute element quotas; the edge function batches one matrix call per ask and never retries in a loop.
- Every failure mode falls back to today's miles ranking with no message: no provider, timeout (1.5 s client, 1.2 s server),
  quota or budget spent, bad response shape, or implausible values (negative, NaN, over 4 h). Already covered by tests.
- A result with no routed time keeps its place; seconds and miles are never compared with each other.

## Ranking integration

Already built and tested: `applyTransportMode` uses seconds only when at least two results have them, with the same relative
weights as miles (walking 2, bike 1, transit 1; driving/rideshare only drop the close-by bonus). No thresholds, no removal, no
widening: the search radius comes only from the person's distance words (`distanceWillingness.js`, clamped to 50 mi).

## UI wording

- Only from real routed seconds: "About 12 min by transit", "About 8 min on foot", "About 1 hr 10 min by car" (`travelTimeLabel`).
- Never "closer", "easier" or "faster to reach" without routed seconds; the words-only captions today say only what the
  person told us ("Keeping it close since you're walking").
- Shown as a fact beside the distance on intent results, never as a reason on its own.

## Approval gate (all required before any of this is built)

1. Owner approves this design and the pilot scope (transit only, top 10, caps).
2. Owner approves a monthly budget ceiling and creates the Google Cloud project, billing and key themselves.
3. Owner reads Google's terms on caching and data use.
4. Privacy copy reviewed.

Until then: `registerTravelTimeProvider` is called nowhere in app code (a test enforces it), and no Supabase function or
migration references routing.
