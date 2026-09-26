# Real travel time for typed asks: design (revised after owner review, NOT approved, NOT built)

Status 2026-09-26, revision 2: the owner approved the **architecture direction** with the revisions below. Paid routing is
still **not approved**: no API key, billing, provider connection, `travel-times` deploy, or any location sent externally
until the owner explicitly approves the final provider, cost and privacy design.

## Owner decisions (review, 2026-09-26)

1. The pilot covers **every explicitly stated mode**: walking, biking, driving, rideshare/car, transit (not transit-only).
2. Privacy architecture kept: ~110 m rounded origin, routing only from the server, API key server-side, result IDs (never
   candidate coordinates) between app and server, no stored origin, no business-facing transport signal, no people
   discovery, no Home/Discover feed use, mode never stored as a profile attribute.
3. An explicit distance the person states stays **primary**; the mode only refines within it and never contradicts it.
4. The 50-mile ceiling is absolute. A mode never widens the search; only "willing to travel" does, by the approved rules.
5. Seconds are not treated as miles: routed time is a **normalized proximity** signal. Ranking only, no cutoffs.
   "Transportation changes how proximity is understood, not what gets recommended."
6. Every failure falls back to miles; a travel-time label appears only from a successful routed result.
7. No cache retention beyond what the provider's terms allow (checked below: durations may NOT be cached).
8. Cost figures must be verified (done below from Google's page) and are not by themselves approval to spend.
9. Travel time is a factual secondary detail beside distance ("About 12 min by transit"), never persuasion
   ("Best because it's faster", "Easier to get to", "You should go here").

## Behavior by mode

| Person says | Today (words only, built) | With routed time (designed, not built) |
|---|---|---|
| "I'm walking" | closer results lift relative to the others (+2 .. 0) | proximity lift, weight 2, half-life 10 min |
| "on my bike" | smaller lift (+1 .. 0) | weight 1.5, half-life 12 min |
| "I'm driving" / "an Uber" | the under-2-mile close-by bonus is removed | weight 1, half-life 15 min |
| "taking the train" | no effect (no transit data) | weight 1.5, half-life 20 min |

With a stated distance ("within 10 minutes", "30 minutes away and I'm walking"), the stated distance ranks exactly as before
and the mode adds at most `REFINE_WEIGHT` = 0.5 (below the smallest stated-distance lift of 1), in the same direction; driving
never removes the close-by bonus when the person asked for something close. Built and tested now.

## Ranking on routed time (built, provider-agnostic)

- Proximity = `halfLife / (halfLife + minutes)`: 1 at 0 min, 0.5 at the mode's half-life, smoothly toward 0, never 0.
  So 10 vs 20 minutes matters more than 50 vs 60, and a list that is all far away gets little lift. Absolute, not relative
  to the other results. Half-lives are product defaults, not measured norms.
- For a routed result, time proximity **replaces** the straight-line close-by bonus (no double counting). A result with no
  routed time keeps its place; seconds and miles are never compared with each other. Used only when >= 2 results are routed.
- Nothing removed, no thresholds, no widening. Code: `applyTransportMode`, `travelProximity` in `src/constants/transportMode.js`.

## The one interface

`src/services/travelTime.js` (exists, **no provider**): `getTravelTimes(candidates, mode, origin)` -> seconds per result or
null; `travelTimeSeconds(...)`; `travelTimeLabel(seconds, mode)`. The provider sits entirely behind it.

## Google Routes API: verified pricing (Google's pricing page, updated 2026-09-24)

Compute Route Matrix bills per **element** (origins x destinations); one SKU per request.

| SKU | Triggered by | Free / month | 10k-100k | 100k-500k | 500k-1M | 1M-5M | 5M+ |
|---|---|---|---|---|---|---|---|
| Essentials | walk, bike, drive without traffic, transit | 10,000 elements | $5.00 | $4.00 | $3.00 | $1.50 | $0.38 |
| Pro | `TRAFFIC_AWARE` / `TRAFFIC_AWARE_OPTIMAL`, side-of-road, heading | 5,000 | $10.00 | $8.00 | $6.00 | $3.00 | $0.75 |
| Enterprise | two-wheeler routing, tolls | 1,000 | $15.00 (lowest tier) | | | | |

Prices are per 1,000 elements per month. Recommendation: **Essentials only** (no traffic-aware driving, no two-wheeler, no
tolls), so every mode bills at the lowest SKU. Driving times then ignore live traffic; label them honestly as estimates.

Limits: at most 50 origins+destinations per request; at most **100 elements with TRANSIT**, 625 otherwise; **3,000 elements per
minute** per project. At 10 results per ask that is ~300 routed asks per minute before quota errors (which fall back to miles).

### Cost model (Essentials, 30-day month, one origin per ask)

| Routed asks per day | Top 10 routed | Top 20 routed |
|---|---|---|
| 1,000 | ~$1,250 / month | ~$2,350 / month |
| 10,000 | ~$6,550 / month | ~$9,930 / month |
| 100,000 | ~$19,050 / month | ~$30,450 / month |

(Pro would roughly double each figure.) Because durations cannot be cached (below), every routed ask is billed; there is no
cache discount.

### Caps and their effect

- **Only asks that name a mode are routed**; most asks cost $0.
- **Top 10** results per ask (code ceiling 20), only from the already-bounded search.
- **Per-person cap**, e.g. 10 routed asks/day: bounds any one account at ~100 elements/day.
- **Global daily budget** that switches routing off (falls back to miles) when spent. Example: $20/day buys ~4,000 elements
  = ~400 routed asks/day at the $5 tier, and caps spend at ~$600/month however usage grows. Worst-case monthly spend =
  30 x the daily budget, independent of traffic.

## Caching: verified against Google's terms (NOT permitted for durations)

- Maps Platform Terms 3.2.3(b): "Customer will not cache Google Maps Content except as expressly permitted under the Maps
  Service Specific Terms."
- Service Specific Terms 19.3 (Routes API): only lat/lng values may be cached, for up to 30 days; place IDs are exempt.
  Routes policies page (updated 2026-09-24): "Most Routes API content cannot be cached."
- **Therefore: no cache of routed seconds across requests.** Times are used for the one response and discarded. The
  15 min / 30 min / 24 h cache in revision 1 is withdrawn. A self-hosted provider would have no such limit.

## Other Google terms that affect the design (need owner/counsel review)

- **No non-Google map (19.2):** Routes content must not be used "in conjunction with a non-Google map". The app uses
  `react-native-maps` with no provider set, which is **Apple Maps on iOS**. Travel-time labels must stay on list results and
  never appear on or with a map view; whether a list screen that also shows an Apple map counts as "in conjunction" is a
  legal question.
- **Attribution:** content shown without a map must carry Google Maps attribution (the logo, or the text "Google Maps"
  where space is limited).
- **End-user terms:** the app must have public Terms of Use and a Privacy Policy that reference Google's Terms of Service
  and Privacy Policy.
- **Location consent:** the terms require notifying users in advance of the data collected and not obtaining an end
  user's location without express, prior, revocable consent. Sending an approximate origin to Google needs that notice.
- **Google's own handling of request data:** Google says Maps Platform requests are logged (account identifier, status)
  and that collection/use/retention is governed by the Maps Platform Terms and the Google Privacy Policy. **I found no
  stated retention period for request contents.** This is not resolved; it needs the owner (and ideally counsel) to read
  those documents and, if needed, use Google's Data Privacy Inquiry Form before approval.

## Privacy architecture (unchanged, owner-approved)

- App -> server: rounded origin (3 decimals, ~110 m), mode, result IDs. Never result coordinates, never the precise fix.
- Server -> Google: rounded origin + the results' locations (businesses and gathering areas, already approximate).
- Nothing stored: no origin, mode or routed list in any table or log; logs keep counts and latency only.
- Mode never stored on a profile, never sent to a business, never used for people discovery or Home/Discover feeds.

## Server-side architecture

```
typed ask -> resolveIntent (app): ranked, bounded candidates
          -> getTravelTimes -> edge function `travel-times` (auth required)
               - per-user + global daily budget check (service-role counter, no identities in logs)
               - result IDs -> coordinates, server-side
               - ONE Route Matrix call (Essentials fields only), 1.2 s timeout, no retry loop, no cache
               - seconds per ID (null where Google returned none)
          -> applyTransportMode: normalized time proximity, else miles
```

## Failure (built, tested)

Routing unavailable, timeout, budget or quota spent, malformed response, missing or implausible time (negative, NaN,
over 4 h) -> miles ranking, no message, no label.

## Approval gate (still closed)

- [ ] Owner approves the final provider (Google Essentials, or another) and the pilot scope (all five modes, top 10, caps)
- [ ] Owner sets the per-person cap and the global daily budget, then creates the Google Cloud project, billing and key
- [ ] Owner (and counsel) review Google's Terms, Service Specific Terms, Privacy Policy and data handling, incl. the
      non-Google-map rule versus the iOS Apple map
- [ ] Privacy Policy / Terms of Use updated to reference Google; in-app notice before an origin is sent
- [ ] Attribution design ("Google Maps") on list results

Until then `registerTravelTimeProvider` is called nowhere in app code and no Supabase function or migration references
routing (tests enforce both).

## Sources (read 2026-09-26)

- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing) (updated 2026-09-24)
- [SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details)
- [Routes API usage and billing](https://developers.google.com/maps/documentation/routes/usage-and-billing)
- [Routes API policies](https://developers.google.com/maps/documentation/routes/policies) (updated 2026-09-24)
- [Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) (section 19)
- [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms) (3.2.3(b))
- [Security and compliance overview](https://developers.google.com/maps/security/compliance/security-compliance)
