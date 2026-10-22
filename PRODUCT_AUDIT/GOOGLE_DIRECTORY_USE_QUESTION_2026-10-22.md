# Google Maps Platform: written compliance question (2026-10-22)

**Status: OPEN. Nothing here is a legal conclusion.** No answer from Google Maps Platform or qualified counsel has been
received. Until there is a written answer, the five Google-backed discovery surfaces below stay built but switched off
(`places_search_budget.discovery_enabled = false`, migration 20270337, LIVE). Nearby must not claim Google has approved
this use.

Background: `PRODUCT_AUDIT/GOOGLE_MAPS_COMPLIANCE_AUDIT_2026-10-22.md` (terms read and quoted, attribution, storage).

---

## The question, ready to send

> **To:** Google Maps Platform support / sales (or Nearby's counsel)
> **Subject:** Does this use of Places API (New) count as a "listings or directory service" (ToS 3.2.3(d)(iii))?
>
> We build Nearby, a mobile app (iOS/Android, React Native) that helps people find something to do nearby: they type
> what they want ("coffee tonight", "a hike this weekend") and Nearby shows gatherings other users host, offers from
> local businesses that have signed up as Nearby partners, and people they know. Partner businesses answer requests
> and make offers. Nearby is not a directory of businesses and has no reviews, ratings or ads.
>
> We use Places API (New) (Nearby Search and Text Search; Pro-tier fields only: place ID, display name, short and full
> address, location, types, Google Maps URI; open-now only on a search the user filters by "Open now") in the
> surfaces listed below. Results are shown **without a Google map**, as a list carrying the Google Maps logo, in their
> own section labelled as not Nearby partners. Nothing from Google is stored except the place ID (as a reference beside
> a location the user placed themselves). Results are never drawn on a non-Google map, never ranked or mixed with
> partner results, and never used for ads, ranking or analytics. Every call goes through an app-wide daily budget.
>
> Maps Service Specific Terms 14.1 allows Places content without a Google Map. Our question is about Google Maps
> Platform ToS 3.2.3(d)(iii): "Customer will not ... use the Google Maps Core Services in a listings or directory
> service or to create or augment an advertising product."
>
> **For each surface below, is it a "listings or directory service", or does it augment an advertising product?**
>
> 1. **Discover > Places tab.** A tab in the app's browse screen. The user picks one of 19 category chips (for
>    example Food & Drink, Sports & Fitness, Outdoors & Nature) or types a search, optionally filters "Open now", and
>    sees up to 20 Google places near them. Each row: name, distance or address; tapping opens the place in Google
>    Maps. The same results, capped at a few rows, also appear as a "Places" preview in the app's general browse and
>    search results. (A "sponsored spotlight" slot for Nearby partners exists above this list in code; it is inert:
>    no sponsor is allowed and nothing is served. We are asking about it explicitly: see question 6.)
> 2. **Discover topic places.** When the user opens an activity ("Yoga"), Nearby shows gatherings, groups and offers
>    for it, then a "Places" list: up to a few Google places from a Text Search for that activity word. Same row
>    format, labelled "Not Nearby partners".
> 3. **"Places to go".** Only after a user submits an ask that names one of ten public-place activities (walking,
>    hiking, running, trails, parks, beaches, picnics, scenic views, gardens, playgrounds), up to 3 Google places for that
>    activity, below Nearby's own results. Name, distance and "Get directions" (opens Google Maps).
> 4. **Create > "Popular nearby".** While creating a gathering and choosing where to meet, up to 8 Google places for the
>    gathering's category. Tapping one only centres a Google map; the host then taps the exact spot themselves, and only
>    that tap is stored (with the place ID as a reference).
> 5. **"Also nearby (not a Nearby partner)".** Only when a user's ask resolves to a business category and Nearby found
>    fewer than 3 partner businesses: up to 3 Google places for the **category name** (never the user's own words),
>    below everything Nearby found, partners removed, one action (Directions, opens Google Maps).
> 6. **Separation from partners.** Partner businesses and Google places are never in the same list, never ranked together,
>    and Google places are labelled "Not Nearby partners". Partners can (in future) pay Nearby for features. Does showing
>    Google places on the same screen as partner results or offers, or below an inert sponsored slot, make the Google
>    results part of "an advertising product"? Would it if the sponsored slot were turned on?
> 7. **Removing partners from Google results.** To avoid showing a partner twice, the app compares Google results to
>    Nearby partners by name and straight-line distance, on the phone, and discards the comparison immediately. Is
>    that a use of Places coordinates restricted by 3.2.3(c) (no creating content from Google Maps content)?
> 8. **A non-Google map on the same screen.** Discover has a list/map toggle. The map (`react-native-maps`) is Apple
>    Maps on iPhone and Google Maps on Android. It shows only Nearby gatherings, never Google places, and the list and
>    map are shown alternately, never together. Is a Places list on a screen that can switch to an Apple map "with or
>    near a non-Google Map" (3.2.3(e) / Service Specific Terms 14.2)? If yes, which fix is acceptable: (a) always use the
>    Google map provider on that screen, or (b) keep Places results off any screen that has a non-Google map?
>
> Also, not discovery, for completeness: (9) the **business sign-up** "find your business" Text Search (a business
> owner looks up their own business; the results are shown as a reference card; the owner types every detail
> themselves and places their own pin; nothing from Google is stored except the place ID), and (10) **address search**
> (Geocoding) on our Google-map pin screen. We believe neither is a listing or directory. Please tell us if you disagree.
>
> If any surface is not permitted as described, what change would make it permitted?

---

## What the app does while the answer is pending (engineering record)

| Surface | Code | While held (switch off) |
|---|---|---|
| Discover Places tab + Places preview/search section | `DiscoverHubScreen.js` (`usePlacesDiscovery`, `discoverTypeFilter`) | No Places tab (a requested Places tab shows All), no Places section, no Google call; Nearby partner businesses still show under "Businesses" in search |
| Discover topic places | `DiscoverHubScreen.js` | No "Places" list in the topic view, no Google call |
| Places to go (Home + Discover) | `hooks/usePlacesToGo.js` | Renders nothing, no Google call |
| Create "Popular nearby" | `CreateGatheringScreen.js` | No heading or list, no Google call; "Pick on map" and the host's own business place unchanged |
| Also nearby | `hooks/useAlsoNearby.js` + `places_also_nearby_enabled()` | Needs its own switch AND the discovery switch (server checks both) |
| Business sign-up lookup, pin-screen address search | unchanged | Still work (not discovery) |

One rule: `utils/googleDiscovery.js` (`GOOGLE_DISCOVERY_SURFACES`); guard `utils/googleDiscovery.test.js` (fails if a new
screen calls a Google discovery search); journey `placesSearchBudget` 12/12 on production (switch off by default, a client
cannot flip it, Also nearby needs both). Code and tests for every surface are kept.

**Same-screen Apple map (question 8):** while held, no Google results can appear on Discover at all, so the question does not
arise. Before turning the switch on, the answer to question 8 decides whether Discover's map must use the Google provider or
Places must stay off that screen. Google content stays off non-Google maps either way (it is never drawn on any map today).

**To lift the hold (owner only, after a written answer that covers the surface):**
`update places_search_budget set discovery_enabled = true, updated_at = now() where id = 1;`
If the answer covers only some surfaces, the switch is not enough: those not covered must be removed or changed first.
Record the answer (who, date, exact wording) at the top of this file before running it.
