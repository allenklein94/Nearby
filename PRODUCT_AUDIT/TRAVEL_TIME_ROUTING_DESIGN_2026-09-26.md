# Real travel time for typed asks: design (revision 3, gates reviewed, routing OFF)

Status 2026-09-26, revision 3: the words-only transportation layer (owner item 70) is built and stays as is. Real travel-time
routing is **OFF** and stays off. Two of the three gates cannot be closed from Google's documentation alone and are marked
**requires legal review**; the third (budget) now has an enforced ledger that ships with every ceiling at 0. No provider, API
key, billing, external call or production routing until the owner explicitly approves the final legal, privacy and cost review.

## Locked product rules (owner, 2026-09-26)

- A transportation mode never widens the search; the 50-mile maximum is absolute.
- A distance/time the person states stays authoritative; real travel time only ranks within it.
- No hard filtering on travel time. Ranking only.
- No transportation signal is stored, reaches a business, ranks Home or Discover feeds, or touches people discovery.
- No travel-time claim without an actual routing result; any routing failure falls back to miles silently.
- Transit has no ranking effect until real transit routing data exists (today: none).
- Driving and rideshare are ONE mode ("by car"); never separate product concepts. (Code now returns `driving` for Uber/Lyft/taxi.)
- The `src/services/travelTime.js` provider abstraction stays so a provider can be added without rewriting ranking.

## Gate 1: Apple Maps vs Google routing -> REQUIRES LEGAL REVIEW (routing stays off)

**What the app uses:** `react-native-maps` with no provider set, i.e. **Apple Maps on iOS**. Discover has a list/map toggle on
the same screen that shows intent-search results (`GatheringsMapView`).

**Relevant Google terms (read 2026-09-26):**
- Maps Platform Terms 3.2.3(e) *No Use With Non-Google Maps*: "To avoid quality issues and/or brand confusion, Customer will not
  use the Google Maps Core Services with or near a non-Google Map in a Customer Application. For example, Customer will not
  (i) display or use Places content on a non-Google Map, (ii) display Street View imagery and non-Google Maps on the same
  screen, or (iii) link a Google Map to non-Google Maps Content or a non-Google Map."
- The Routes API is listed as a Google Maps Core Service (Core Services summary, last modified 2026-04-22).
- Service Specific Terms 19.1: Routes content may be used "without a corresponding Google Map." 19.2: "Customer must not use
  Google Maps Content from the Routes API in conjunction with a non-Google map."
- "Google Maps Content" = "any content provided through the Services ... including map and terrain data, imagery, traffic
  data, and places data". Travel durations returned by the Routes API are content provided through the Services.
- 3.2.3(g): "Customer will not modify any of the Google Maps Core Services' search results."

**Answers, as far as the text goes:**
| Question | What the terms say | Confidence |
|---|---|---|
| Can Routes results be displayed when Apple Maps is the map provider? | Allowed without a map (19.1), forbidden "in conjunction with" / "with or near" a non-Google map (19.2, 3.2.3(e)). Neither phrase is defined. | Unclear: a list on the same screen as an Apple map toggle may be "near". |
| Can they be used only as an internal ranking signal? | 3.2.3(e) forbids to "**use**" Core Services with or near a non-Google map, not only to display; its example says "display **or use**". Nothing exempts internal use. | Unclear, leans restrictive. |
| Does "About 12 min by transit" add restrictions? | Yes: it is displayed Google Maps Content, so attribution applies (3.2.2(b); the Google Maps logo or the text "Google Maps") and the non-Google-map rule applies to that screen. | Clear that attribution is required. |
| Does re-ranking our own results by Google times "modify search results" (3.2.3(g))? | Our results are not Google search results; Route Matrix is not a search. | Probably fine; include in the legal question. |

**Decision:** cannot be established confidently. **Requires legal review; routing disabled.** Options for counsel to weigh:
(a) use Routes only on screens with no map and hide the Discover map toggle while travel times show; (b) switch the app's
map to Google Maps (`PROVIDER_GOOGLE`) on iOS; (c) use a non-Google routing provider (no such restriction).

**Pre-existing finding (not caused by this work, not changed):** the app already sends Google Geocoding results to an Apple
`MapView` (`SelectGatheringLocationScreen`) and uses Google Places from the client (`services/places.js`). Under 3.2.3(e)
example (i) ("display or use Places content on a non-Google Map") that may already be a conflict. Worth including in the
same legal review.

## Gate 2: Google location/data use and retention -> REQUIRES LEGAL REVIEW (no location sent)

| Question | What Google's current documents say | Source |
|---|---|---|
| What Google receives | "Google collects and receives data from Customer and End Users ..., including search terms, IP addresses, and latitude/longitude coordinates." All requests are logged (account identifier, response status). | Terms 4.4(a); security and compliance overview |
| Use of that data | "Google and its Affiliates may use and retain this data to **provide and improve Google products and services**, subject to the Google Privacy Policy." Not limited to providing the routing service. | Terms 4.4(a) |
| Retention period | **None stated.** Governed by the Google Privacy Policy and the Controller-Controller Data Protection Terms (Google acts as an independent controller). | Terms 4.4(a), 4.4(b) |
| Can route results be cached? | No. "Customer will not cache Google Maps Content except as expressly permitted"; Routes permits only lat/lng (up to 30 days) and place IDs; "Most Routes API content cannot be cached." | Terms 3.2.3(b); Service Terms 19.3; Routes policies |
| Permitted cache duration for travel times | None (not cacheable). | same |
| Does the rounded origin change anything? | Not in the text. A rounded coordinate is still an end-user location: advance notice and "express, prior, revocable consent" are still required (4.4(c)(iii)). Server-side calls mean Google sees our server's IP, not the user's. | Terms 4.4(c)(iii) |
| Personal data limits | "Customer will not provide to Google (1) any End User's personally identifiable information; or (2) any European End User's Personal Data (EEA, Switzerland, UK)." Whether a rounded origin is Personal Data for a European user is a legal question; if it is, routing must be off for European users. | Terms 4.4(c)(ii) |
| App-side obligations | Terms of service must say the app includes Google Maps features and that their use is subject to the Google Maps End User Additional Terms and the Google Privacy Policy. | Terms 3.2.2(a) |

**Decision:** the terms do not give a retention period and allow Google to use the data to improve its products. That is not
what "only to provide the routing service" requires. **Requires legal review; no location is sent externally.**

## Gate 3: hard spending ceiling -> BUILT, shipped at 0 (routing impossible until the owner sets a budget)

**SKU:** Routes: Compute Route Matrix **Essentials**, SKU **9392-1087-2045** (walking, bicycling, transit, driving without
traffic awareness). Price per 1,000 elements per month: first 10,000 free; 10,001-100,000 $5.00; 100,001-500,000 $4.00;
500,001-1M $3.00; 1M-5M $1.50; over 5M $0.38 (Google pricing page, updated 2026-09-24). Pro (traffic-aware driving) is
SKU 2E25-887A-DAD4 at $10.00 and is NOT used. Element = one origin x one result.

**Cost model** (30-day month, one origin per ask, uncapped, Essentials):

| Routed asks per day | Elements/month (top 10) | $/month (top 10) | Elements/month (top 20) | $/month (top 20) |
|---|---|---|---|---|
| 1,000 | 300,000 | ~$1,250 | 600,000 | ~$2,350 |
| 5,000 | 1,500,000 | ~$4,300 | 3,000,000 | ~$6,550 |
| 10,000 | 3,000,000 | ~$6,550 | 6,000,000 | ~$9,930 |
| 25,000 | 7,500,000 | ~$10,500 | 15,000,000 | ~$13,350 |

No cache discount is possible (results cannot be cached). Rate limit 3,000 elements/minute per project (25,000 asks/day at top
10 averages ~174 elements/minute; peaks above 300 asks/minute would get quota errors, which fall back to miles).

**What a hard monthly ceiling buys** (Essentials, top 10): 30,000 elements = ~$100/month = ~3,000 routed asks;
110,000 = ~$490 = ~11,000 asks; 210,000 = ~$890 = ~21,000 asks. The monthly ceiling, not usage, sets the worst case.

**Enforcement (migration `20270210`, live, verified rolled-back by `scripts/live-verify/routing-budget-ceilings.sql`):**
- `routing_budget_settings`: `monthly_element_ceiling`, `daily_element_ceiling`, `per_user_daily_asks`, **all 0**.
- `routing_claim_budget(user, elements)` (service_role only; no client can call it or read any table) must be called before
  any paid request. It locks the settings row, checks the month, the day and the person, and records usage only on success.
  Any ceiling at 0, or any ceiling reached, returns false and the caller ranks on miles.
- Stored: per-day element/ask totals (kept ~13 months for the monthly figure and billing reconciliation) and per-person ask
  counts for today only (deleted the next day). No mode, location, origin or results.
- Setting a budget is a deliberate owner SQL update after approval; no code writes the ceilings.

## Ranking design (built, provider-agnostic, unchanged)

Routed seconds become an absolute proximity `halfLife / (halfLife + minutes)` (walk 10, bike 12, car 15, transit 20 min;
product defaults), replacing the straight-line close-by bonus for routed results; unrouted results keep their place; a stated
distance stays primary and the mode only refines (max 0.5). Code: `src/constants/transportMode.js`, `src/services/travelTime.js`.

## Approval gate (all open)

- [ ] Gate 1: legal opinion on Routes content with the iOS Apple map (and the pre-existing Places/Geocoding use)
- [ ] Gate 2: legal/privacy opinion on Google's use and retention of request data, the European personal-data restriction,
      Terms/Privacy Policy updates and the in-app consent notice
- [ ] Gate 3: owner approves the SKU, the monthly/daily ceilings and the per-person limit, then sets them and creates billing
- [ ] Provider connection, `travel-times` function and attribution UI, only after the three gates

## Sources (read 2026-09-26)

- [Google Maps Platform Terms of Service](https://cloud.google.com/maps-platform/terms) (3.2.2, 3.2.3, 4.4)
- [Maps Platform Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) (section 19)
- [Google Maps Core Services summary](https://cloud.google.com/maps-platform/terms/maps-services) (last modified 2026-04-22)
- [Routes API policies](https://developers.google.com/maps/documentation/routes/policies) (updated 2026-09-24)
- [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing) (updated 2026-09-24)
- [SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details)
- [Routes API usage and billing](https://developers.google.com/maps/documentation/routes/usage-and-billing)
- [Security and compliance overview](https://developers.google.com/maps/security/compliance/security-compliance)
