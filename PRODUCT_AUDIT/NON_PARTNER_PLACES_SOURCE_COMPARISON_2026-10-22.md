# Non-partner places: source and cost comparison (2026-10-22)

Owner direction (2026-10-22): **make Nearby useful first**, even with few partner businesses. **Owner then approved Google
(same day): steps 1-3 are BUILT** (see CLAUDE_HISTORY.md, "Google Places (New), attribution, daily budget"); ratings,
price, open-now and photos removed; app-wide limit 100 calls/day; the "Also nearby" row switched OFF until the owner
confirms terms + billing. Overture stays a possible future alternative, not a fallback.

## What already exists (found in code, 2026-10-22)

The 2026-10-20 decision treated Google Places as a new integration. It is not. Nearby already shows non-partner Google
places in three places, through the **legacy** Places API (`maps/api/place/nearbysearch`, `src/services/places.js`):

1. Discover's **Places** type filter and literal keyword searches (`DiscoverHubScreen.js` ~line 1017), with Google's
   star rating and review count on each row (`⭐ 4.5 (123)`, ~line 2146) and Google photos (`getPlacePhotoUrl`).
2. Discover's topic places (~line 1410).
3. Item 189's **"Places to go"** under a typed ask that names a public-place activity (`hooks/usePlacesToGo.js`,
   `utils/placesToGo.js`: allowlist of 10 outdoor activities, max 3, never ranked against Nearby results, never stored).

Also used: Geocoding in `brandOffers.js` and `SelectGatheringLocationScreen.js`; text search + details in `BusinessPartnerApplyScreen.js`.

**Compliance gap, independent of any new row:** no Google logo or attribution appears anywhere next to Places content
(`grep -i "powered by"` finds only GIPHY). Google's Places policies require the Google logo whenever Places data is shown
without a Google map, plus attributions for photos/reviews. That should be fixed whatever is decided about the new row.

## The new row being considered

"Also nearby (not a Nearby partner)": under a business-type ask (coffee, dinner, a massage) where Nearby has too few
relevant partners. It differs from item 189, which is limited to public places (parks, beaches, trails).

## Sources compared

| Source | Cost (published rates; verify before committing) | Terms that matter for Nearby | Data quality / fit |
|---|---|---|---|
| **Google Places API (New)** | Nearby Search Pro: 5,000 free calls/month, then $32 per 1,000 (dropping to $25.60 above 100K). Asking for rating/reviews moves a call to Enterprise ($35, 1,000 free) or Enterprise + Atmosphere ($40). The legacy API can't be enabled on new projects. | Google logo required next to results, even without a map; photo/review attributions; only `place_id` may be stored indefinitely, other content can't be cached beyond the allowed exceptions. Showing live results in an app with attribution is permitted. What's restricted is building your own stored listing/database from Places content. | Best coverage, hours and open-now. Already integrated. |
| **Foursquare Places API** | 500 free calls/month, then $15 per 1,000 (to $12 at 100K, $9 at 500K). | Attribution and storage terms not confirmed in this pass; read the API terms before choosing it. | Good US POI coverage, weaker on hours. Would need a new integration. |
| **Overture Maps (Places theme)** | Free data under CDLA-Permissive-2.0. You pay only for hosting and import (a South Palm Beach subset fits in the existing Supabase Postgres). | Permissive: storing and showing it is allowed. Records from OSM may carry ODbL obligations; check attribution guidance. | No live hours or open-now, monthly release cadence, uneven quality on small businesses. Needs an import job plus our own nearby query. |
| **Yelp Fusion** | Paid only after a trial. Sources conflict ($7.99–14.99 per 1,000 in 2024 vs. "from $229/month" in a July 2026 report); unverified. | Review-centric, with strict display rules. | Its core value is reviews and ratings, which Nearby avoids (no public star ratings, idea "228"). Not recommended. |

### Rough cost at realistic volumes (Google, Nearby Search Pro, no rating fields)

Today: 8 accounts, 0 typed asks ever, which is well inside the free 5,000 calls. Assuming 5 Places-triggering searches per
monthly user, and the existing 10-minute per-session cache:

- 1,000 monthly users ≈ 5,000 calls: **$0**
- 5,000 ≈ 25,000 calls: ≈ **$640/month**
- 10,000 ≈ 50,000 calls: ≈ **$1,440/month** (Foursquare at the same volume ≈ $740)

Adding ratings (Enterprise) raises each rate and cuts the free allowance to 1,000 calls.

## Recommendation: the smallest compliant implementation

1. **Fix what's live first (Google, no new feature):** add Google attribution beside every Places result (Discover
   Places, topic places, item 189's Places to go). Decide whether to keep Google star ratings on Discover. Dropping them
   fits "no public star ratings" (idea "228") and keeps calls on the cheaper Pro tier.
2. **Move `searchNearbyPlaces` to Places API (New)** with a field mask limited to Pro fields (name, address, location,
   open-now, types, photo). Set a hard daily quota in Google Cloud Console (the owner picks the number) so cost can't run away.
3. **Then the row:** reuse `searchNearbyPlaces` + `contextItem('place')` (already reasonless and actionless: directions
   only). Show it under a business-type typed ask only when fewer than N relevant partners qualify (N decided at build).
   Label it plainly "Also nearby (not a Nearby partner)", put it below Nearby's own results, never rank it against them,
   never show "Ask"/offer/booking on it, store nothing beyond `place_id`, and add the Google logo.
4. **Hedge later:** if Google cost grows, Overture can cover the same row at hosting cost only, with the open-now claim
   dropped (it has no live hours). Foursquare is the middle option. Neither is worth a second integration before real usage.

Why Google over the alternatives now: it's already integrated and its keys are configured, it's free at today's volume,
and its terms permit this use with attribution. The 2026-10-20 concern ("terms restrict directory use") is about storing
Places content to build our own listing, which this design never does.

## Owner decisions needed

1. Approve step 1 (attribution on today's Places results), and decide whether Discover keeps Google star ratings.
2. Approve steps 2–3 with Google as the source, and set the daily call cap (e.g. 300/day ≈ inside the free 5,000/month).
3. Or choose Foursquare / Overture instead, accepting a new integration.

## Not verified

- Every price and term above comes from public pages and third-party summaries as of 2026-10-22, not from a signed
  agreement. Check the live Google Maps Platform pricing and Places policy pages before enabling billing.
- Whether the production Google key's project is billed, and its current usage. That needs Google Cloud Console access,
  which this environment doesn't have.

Sources: Google pricing (developers.google.com/maps/billing-and-pricing/pricing), Google Places policies
(developers.google.com/maps/documentation/places/web-service/policies), Foursquare pricing (foursquare.com/pricing),
Overture docs (docs.overturemaps.org), Yelp (appdevelopermagazine.com 2024; supergood.ai/api-report-card/yelp 2026).
