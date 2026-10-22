# Google Maps Platform: exact setup for Nearby (2026-10-22)

Who does this: the owner, in the Google Cloud Console of the project that owns the key in the EAS secret
`GOOGLE_MAPS_API_KEY` (`app.json` -> `ios.config.googleMapsApiKey`, `android.config.googleMaps.apiKey`, `extra.googleMapsApiKey`).
Nothing here can be done or checked from the codespace: the key is not readable here and there is no Cloud access.

**"Also nearby (not a Nearby partner)" stays OFF** (`places_search_budget.also_nearby_enabled = false`) until every box in
section 6 is ticked. It is the owner's switch; nobody else changes it.

## 1. APIs to enable (APIs & Services -> Library)

| API | Why Nearby needs it | Calls from |
|---|---|---|
| **Places API (New)** | Discover Places (tab, search, topic lists), Create's "Popular nearby", Places to go, the business sign-up lookup, Also nearby (when on) | `services/places.js` only |
| **Geocoding API** | Address search on the pin screen (Create + sign-up) and the business address editor | `services/places.js` `geocodeAddress` only |
| **Maps SDK for iOS** | NEW: the pin screen is a Google map on iPhone too (Google results may only be shown on a Google map) | `SelectGatheringLocationScreen.js` (`PROVIDER_GOOGLE`) |
| **Maps SDK for Android** | All maps on Android (already the default provider there) | every `MapView` on Android |

The legacy "Places API" is not needed (the app no longer calls it) and cannot be enabled on new projects anyway.
Until **Places API (New)** is enabled, every Places list is empty and shows "Google Maps results aren't available right now".

## 2. Key restrictions (APIs & Services -> Credentials)

- **Application restriction (today):** iOS apps, bundle `com.allenklein.nearby`. Every REST call sends `X-Ios-Bundle-Identifier`
  (`getGoogleMapsRequestHeaders`), so iPhone works.
- **API restriction (do now):** restrict the key to exactly the four APIs in section 1. Nothing else.
- **Android: open gap, NOT fixed.** The same key has no Android restriction. Restricting it to Android apps would also require
  the REST calls to send `X-Android-Package` + `X-Android-Cert` (SHA-1 of the signing certificate), which the app does not
  send yet. Recommended: a SECOND key for Android, restricted to package `com.allenklein.nearby` + the EAS/Play signing SHA-1,
  plus the headers in `services/places.js`. That is a build decision for the owner. Until then, with the key restricted to iOS
  apps only, Android's REST calls (shown as "unavailable") AND Android's map tiles are expected to be refused. Never checked:
  no Android device has run the app.
- **Business website (`docs/business/`):** cannot use an iOS-restricted key. Its address search on the location picker
  therefore always says "Address search isn't available right now" and the business uses its saved location or the
  browser's location. A web key (HTTP-referrer restricted to the site) would be needed to change that; not set up.

## 3. Billing alerts and quotas (Billing -> Budgets & alerts; APIs -> Quotas)

- **Budget alert:** a monthly budget on the billing account with email alerts at 50 %, 90 % and 100 %. Suggested start: $25/month
  (well above what 100 calls/day can cost on the tiers below; an alert means something is wrong). An alert does not stop billing.
- **Hard caps (the real backstop):** in each API's Quotas page set "requests per day" just above the app's own limit:
  Places API (New) ~150/day, Geocoding API ~100/day. Google refuses past these; the app then shows "unavailable".
- **Pricing tiers used** (check the live price list, it changes): Nearby Search / Text Search on the **Pro** field set
  (`PLACE_SEARCH_FIELDS`: id, displayName, address, location, types, googleMapsUri). A search made with Discover's **Open now**
  filter on adds `currentOpeningHours.openNow`, which bills THAT call at the **Enterprise** tier; no other call does.
  Geocoding is its own (Essentials) SKU. Map loads on iOS/Android SDKs are separate and currently free per Google's mobile
  dynamic-maps terms (verify).

**Status (owner, 2026-10-22):** all four APIs enabled; key restricted to iOS bundle `com.allenklein.nearby` + the four APIs;
"Pay as you go" plan kept (no subscription); budget = Alerts only (spend-cap enforcement does not cover Maps APIs). Per-API
quotas could NOT be lowered on the free trial (console refuses edits): set them right after upgrading to a paid account.
Until then the free trial itself cannot charge, and Nearby's 100/day budget caps calls.
**Key checked from the codespace (2026-10-22, 4 direct calls, outside the app budget):** the EAS `production` key (ends
`…YOdc`) returns real Places (New) Text Search results with the app's bundle header; a wrong bundle is refused
(`API_KEY_IOS_APP_BLOCKED`); Geocoding = OK; Time Zone API (not allowed) = REQUEST_DENIED. The key exists ONLY in the EAS
`production` environment: development/preview builds have no key (every Google list = "unavailable").

## 4. Nearby's own limit (database, service role)

- One app-wide budget for ALL Google web calls (Places + Geocoding), `places_search_budget.daily_limit` (default **100**),
  counted per Google billing day (America/Los_Angeles) in `places_search_usage` (`calls`, `refused`). Migrations 20270332 + 20270333.
- Change it: `update places_search_budget set daily_limit = <n> where id = 1;` (0 = no Google calls at all).
- Watch it: `select * from places_search_usage order by day desc limit 14;` Many `refused` = the limit is too tight for real use.
- Not a billing cap: Google bills what it serves; section 3's quotas are the cap.

## 5. What Nearby stores from Google (after 2026-10-22)

| Where | What is stored | Provenance column |
|---|---|---|
| `gatherings` | the host-confirmed pin (`precise_lat/lng`, private) + Google `place_id` (private) | `location_source`: device / host_pin / google_adjusted / google_confirmed / business_profile |
| `business_partner_requests` | name + address the business typed or confirmed; phone/website typed only; the confirmed pin; `place_id` | `details_source` + `details_confirmed_at`, `location_source` |
| `brand_partners` | copied on approval; a later address edit relabels the point | `location_source` (+ `address_geocoded`), `google_place_id` |
| device draft (Create) | coordinates (draft expires in 14 days); never a Google venue name | n/a |
| nothing else | search results live in memory only (10-minute session cache), never in the database | n/a |

Rows written before 2026-10-22 have `location_source = NULL` (not recorded): 26 gatherings, 1 sign-up (no coordinates), 1 partner (no coordinates).

## 6. Before turning "Also nearby" on (owner checklist)

- [ ] Section 1: Places API (New), Geocoding API, Maps SDK for iOS, Maps SDK for Android enabled.
- [ ] Section 2: key restricted to those four APIs (DONE + checked 2026-10-22); Android key decision made.
- [ ] Section 3: budget alert set (done 2026-10-22); per-API daily quotas set (blocked on the free trial; do after upgrading).
- [ ] Terms review (counsel / Google), recorded with the date and the terms version read:
  - [ ] Showing live Places results with the "Google Maps" text attribution (no logo image) beside each list is acceptable.
  - [ ] Whether a pin the person confirmed WITHOUT moving it (`location_source = 'google_confirmed'`) may be kept beyond
        Google's 30-day limit on coordinates. Confirmation records provenance; it does not by itself make the value
        independent data. If not: decide what happens to those rows (find them with
        `select id from gatherings where location_source = 'google_confirmed'`).
  - [ ] Whether a name/address the business confirmed (`details_source = 'business_confirmed_google'`) may be kept. If not:
        switch the sign-up to "Google as reference only" (the business types every field).
  - [ ] Business address edits geocoded by Google (`brand_partners.location_source = 'address_geocoded'`): the same 30-day
        question applies; the fix would be the same confirm-a-pin step in the business profile editor (not built).
- [ ] Check C23 + C24 of `FIRST_DEVICE_SESSION_CHECKLIST_2026-09-19.md` passed on a real phone.
- [ ] Native-speaker review of the `ui.placesToGo.*` and `ui.selectLocation.confirmPlaceHint` strings.

Then, and only then: `update places_search_budget set also_nearby_enabled = true where id = 1;`

Sources read 2026-10-22 (verify against the live pages before relying on them): Places API policies
(https://developers.google.com/maps/documentation/places/web-service/policies: place IDs exempt from caching limits; no other
caching; Google logo or "Google Maps" text when shown without a Google map), Maps Platform Service Specific Terms, archived
versions (https://cloud.google.com/archive/maps-platform/terms/maps-service-terms-20250501: latitude/longitude cacheable up to
30 consecutive calendar days for Places and Geocoding).
