# Google Maps Platform compliance audit (2026-10-22)

Owner request (2026-10-22): record the two confirmed findings with links, verify attribution on every Places surface, add the
Terms of Service disclosure, confirm nothing Google-derived is stored outside the exceptions, and document "Also nearby" for a
final permitted-use review. No architecture change unless this review finds a specific problem.

This is an engineering reading of Google's published terms, not legal clearance. Google's own FAQ says the customer's counsel
decides compliance.

## Follow-up, same day (owner decisions 2026-10-22)

| Decision | Status |
|---|---|
| Directory restriction: ask Google / counsel in writing, all discovery surfaces | Question written, NOT SENT: `GOOGLE_DIRECTORY_USE_QUESTION_2026-10-22.md` (owner sends it) |
| Keep Google discovery built but not public until answered | DONE: one switch `discovery_enabled` (default off, migration 20270337 LIVE); Places tab, Places sections, topic places, Places to go, Create "Popular nearby" hidden with no Google call; Also nearby needs both switches. Guard `googleDiscovery.test.js`, journey `placesSearchBudget` 12/12 on prod |
| Official Google Maps logo instead of text | DONE in code (gaps A + B below): Google's own files, unmodified; text = fallback if the image fails. NOT DEVICE-VERIFIED (check C23) |
| Clear unverified coordinates on the 26 legacy gatherings | DONE 2026-10-23 (owner revised: NO coordinate backup): migration 20270338 LIVE, see section 4 |
| Keep Google results off non-Google maps; document the Apple Maps question | Documented (question 8 of the question file); moot while held |
| Privacy Policy: location + search words sent to Google | DONE (`docs/privacy.html` section 4, Last updated October 22, 2026) |
| Terms/Privacy change notice per Terms section 12 | Notice text drafted (below); NOT SENT (outward; the app has no in-app notice mechanism) |

**Change notice (draft, for the owner to send by email to each account holder; Terms 12 / Privacy 9 say "through the App or by email"):**

> Subject: Updates to Nearby's Terms of Service and Privacy Policy
>
> We've updated Nearby's Terms of Service and Privacy Policy (October 22, 2026). The Terms now say that Nearby includes
> Google Maps features and content, and that using them is subject to Google's terms and privacy policy. The Privacy
> Policy now explains what Nearby sends to Google when you use those features: your device's location for a place search
> and the words of that search, and any address you type on a map. Read them at
> https://allenklein94.github.io/Nearby/terms.html and https://allenklein94.github.io/Nearby/privacy.html .

Production has 8 accounts, all test accounts (per the earlier read); whether each belongs to the owner is the owner's call.
Record here when and how the notice went out.

## Sources read (fetched 2026-10-22)

| Document | URL | Version seen |
|---|---|---|
| Google Maps Platform Terms of Service | https://cloud.google.com/maps-platform/terms | Last modified August 26, 2026 |
| Maps Service Specific Terms | https://cloud.google.com/maps-platform/terms/maps-service-terms | Last modified October 15, 2026 |
| Places API policies (attribution, place IDs) | https://developers.google.com/maps/documentation/places/web-service/policies | Last updated 2026-10-21 |
| Place IDs | https://developers.google.com/maps/documentation/places/web-service/place-id | (exemption is restated in the policies page above) |
| Google Maps/Google Earth Additional Terms of Service | https://maps.google.com/help/terms_maps/ | linked from our ToS |
| Google Privacy Policy | https://policies.google.com/privacy | linked from our ToS |

## 1. Findings (quoted)

**Confirmed permitted**
- **Place IDs may be stored indefinitely.** Places policies: "You can therefore store place ID values indefinitely" (place IDs are
  exempt from the caching restrictions). Nearby keeps `google_place_id` on gatherings, sign-ups and partners, as a reference only.
- **Places results may be shown without a Google map.** Service Specific Terms 14.1: "Customer may use Google Maps Content from the
  Places API in Customer Applications without a corresponding Google Map." (Same for Geocoding, 6.1.)

**Requirements that apply**
- **14.2 / ToS 3.2.3(e): no use with a non-Google map.** "Customer will not use the Google Maps Core Services with or near a
  non-Google Map ... (i) display or use Places content on a non-Google Map." See section 2.3.
- **14.3: Places latitude/longitude may be cached at most 30 days.** Geocoding 6.3.2 allows indefinite caching only "logically
  isolated to the specific End User ... not used across multiple End Users", so a business point geocoded once and shown to every
  customer does not qualify. Option B (the person's own pin) stands.
- **ToS 3.2.2(a): our Terms of Service must** "(A) notify users that the Customer Application includes Google Maps features and
  content; and (B) state that use of Google Maps features and content is subject to the then-current versions of the: (1) Google
  Maps End User Additional Terms of Service at https://maps.google.com/help/terms_maps/ ; and (2) Google Privacy Policy at
  https://policies.google.com/privacy." DONE, see section 3.
- **ToS 3.2.2(b): attribution.** Display all attribution Google provides; never modify, obscure or delete it. See section 2.
- **ToS 3.2.3(b) No Caching, (c) No Creating Content From Google Maps Content** (incl. "(iv) use latitude/longitude values from
  the Places API as an input for point-in-polygon analysis").

**Needs counsel / Google (not settled by the above)**
- **ToS 3.2.3(d)(iii):** Customer will not "use the Google Maps Core Services in a listings or directory service or to create or
  augment an advertising product." 14.1 allows the mapless FORMAT; it does not answer whether a given use is a "listings or
  directory service". See section 5: this question covers more than "Also nearby".

## 2. Attribution, every surface that shows Google results

One component, `src/components/GoogleMapsAttribution.js`: the text "Google Maps" (never localized, one line, 12 pt, weight 400,
#5E5E5E light / white dark), in the same container as the list, always visible. Guard: `locationProvenance.test.js` ("attribution:
every screen that lists Google results renders...").

| Surface | Where | Attribution | Separated from Nearby's own results |
|---|---|---|---|
| Discover > Places (tab, search, Top Results preview) | `DiscoverHubScreen.js` ~3482 | Yes, under the list | Own "Places" block, footed "Not Nearby partners · Google Maps"; partners removed (`withoutPartnerPlaces`) |
| Discover context places (topic view) | `DiscoverHubScreen.js` ~2808 | Yes | Same "Not Nearby partners" label |
| Home + Discover "Places to go" (item 189) | `PlacesToGoSection.js` | Yes | Own section below Nearby's results |
| "Also nearby (not a Nearby partner)" (OFF) | `PlacesToGoSection.js` with heading | Yes | Heading says it; below everything Nearby found |
| Create "Popular nearby" venues | `CreateGatheringScreen.js` ~894 | Yes, when the list shows | Only Google rows in that list |
| Create review step (searched venue's name) | `CreateGatheringScreen.js` ~1430 | Yes | n/a |
| Business sign-up search results + reference card | `BusinessPartnerApplyScreen.js` 383, 413 | Yes, both | Reference card says "For reference" |
| Pin screen (native) | `SelectGatheringLocationScreen.js` | Google map's own logo (`PROVIDER_GOOGLE`) | n/a |
| Directions from a Google place | `buildDirectionsUrl` | Opens Google Maps (`google.com/maps/dir`) | n/a |

**Gaps against the policy page (A + B FIXED 2026-10-22, owner decision; C unchanged):** the component now shows Google's
official logo (`assets/google/`, from Google's "Google Maps attribution assets" zip linked on the policies page, unmodified:
non-outlined gray on light, white on dark, 98 x 18 dp, clear space 10/10/10/5 dp, label "Google Maps"), with the text form
only if the image fails to load. Not device-verified (check C23).
- A. **Logo vs text.** Policy: "Attribution should take the form of the Google Maps logo whenever possible. In cases where space is
  limited, the text Google Maps is acceptable." Nearby uses the text everywhere. Most of these surfaces have room for the logo.
  Recommended: use Google's official logo asset (from Google's brand resources, unmodified, light/dark variants) in the same component,
  text kept as the fallback. One component change, every surface inherits it.
- B. **Font on iPhone.** Policy specifies Roboto. The component uses Roboto on Android and the system font on iOS. Fixed automatically
  by A (the logo is an image); otherwise bundle Roboto for this one text.
- C. **Third-party attributions.** Policy: when Google returns third-party attribution, "Google Maps" alone is not enough. Nearby's
  field mask (`PLACE_SEARCH_FIELDS`) requests no photos, reviews or attributions, so none is returned today; requesting photos or
  reviews later would require author attribution.
- Colour, size, single line, not localized, same container, always visible: as specified.

## 3. Terms of Service disclosure (ToS 3.2.2(a)): DONE

`docs/terms.html` had no Google mention. Added section "14. Google Maps" (Contact Us is now 15), Last updated October 22, 2026:
the App includes Google Maps features and content (place search results, maps for choosing a location, directions), subject to the
then-current Google Maps/Google Earth Additional Terms of Service and Google Privacy Policy, both linked. The app (`LegalScreen`,
`CompleteProfileScreen`) and the business site link to this one file. Owner to note: section 12 of our Terms promises notice of
material changes "through the App or by email"; decide whether this addition counts (no users yet: 8 accounts, all test).
Not changed: `docs/privacy.html` does not say that a search's location and category name are sent to Google. Not required by
3.2.2(a), but recommended for the privacy policy (owner/counsel wording).

## 4. Nothing Google-derived stored outside the exceptions

**Code (current):**
- Stored points are only the person's own tap/drag, the phone's location or the business's own saved spot
  (`utils/locationProvenance.js`; DB checks in migration 20270336 refuse every Google-derived label).
- Google venue names are never sent to `createGathering`, never kept in the device draft, never in the publish panel.
- Sign-up: no field filled from Google; `details_source` = 'business_entered' only. Business address edits never geocode.
- Places code writes nothing to the database except `claim_places_search` (counts per day: `places_search_usage` = day, calls,
  refused) and reads the "Also nearby" switch; no analytics event carries a Google result. Search results live in memory only.
- The only Google columns in the database: `google_place_id` on gatherings, sign-ups, partners (permitted).

**Production (read-only, 2026-10-22):** 26 gatherings, 1 sign-up, 1 partner, all `location_source` NULL, 0 place IDs.

**Legacy follow-up (2026-10-22, read-only, production):** the owner decided to clear the coordinates without deleting the
gatherings. Not done: writing that migration was refused by the session's permission rules. What it found and proposes:
- All 26 gatherings: `location_source` NULL, all with a point, 0 place IDs, 0 upcoming. The point is stored in THREE forms:
  `precise_lat/lng`, `area` (2-decimal "lat,lng", NOT NULL) and `wide_area` (1-decimal "lat,lng"). The pins are computed from
  the point, never stored.
- Copies elsewhere: `plans.location_lat/lng` on the 26 plans made from them (trigger `create_plan_from_gathering`); one
  business request made for gathering 9d19cb11 (expired) holds the point in `business_requests.latitude/longitude` (NOT NULL,
  so only deleting that request clears it) and its plan b7a1a5b3 holds another copy.
- Two traps: (1) the trigger `_gathering_location_provenance_on_move` (20270334) treats nulling the point as a move and labels
  it 'host_pin'; it needs "a cleared point has no source and no place ID" first. (2) `notify_gathering_updated` pushes
  "was updated" to approved attendees (5 rows) when `area` changes, with no date check, so it must be paused for that update.
- Null-safety checked in the live functions: a request for a gathering with no point is refused ("This gathering has no
  location set."), routing / reminders / threshold pushes / meet-up point / distances skip a null point; no client reads
  `area` or the plan location label.
- Proposed migration (20270338): fix the trigger; back up the three forms + the plan copies to a `private` table (no client
  access) dropped automatically after 14 days by a one-time cron job (so the uncertain points are not kept indefinitely);
  clear point -> null, area -> '', wide_area -> null on gatherings with no provenance created before 2026-10-22; clear the plan
  copies; leave the business request row (owner: delete that expired test request or keep it as a recorded risk).

**Applied 2026-10-23 (migration 20270338, owner decisions 2026-10-23):** verified first (read-only): all 26 hosted by the owner's phone
account (20) or the Apple-review test account (6), all past, none recurring, 5 approved attendees = the same two accounts, 0 Interested.
Production dry run (rolled back) then live, identical: 26 gatherings cleared (point, area, wide_area; source + place ID null), 26 plan copies
cleared, request 1dc27934 + plan b7a1a5b3 (+ 1 lifecycle row) deleted, 0 pushes, 0 relabelled; after: 0 gatherings with any point form, 0 plans
with a point, attendees 5 = 5. No coordinate backup: `private.legacy_location_cleanup` (54 rows, no app grant) holds non-location metadata only
(a request plan's title is the typed text, so it is left out too). Old values may persist in Supabase's WAL/infrastructure for a while (not
controllable from the database). Also permanent: a gathering's plan no longer copies its point. The Privacy Policy gathering paragraph was
corrected the same day (Last updated October 23, 2026).

**One legacy exposure:** before 2026-10-22, tapping a Google venue in Create stored Google's coordinates directly as the gathering
point (old `CreateGatheringScreen.js`: `setCustomLocation({ latitude: place.latitude, longitude: place.longitude })`). Which of
the 26 older gatherings came from that path was never recorded. All 26 are past (none upcoming; created 2026-07-26 to 2026-10-20,
test accounts only). Under 14.3 any such point should not be kept past 30 days. Options for the owner (not done; destructive):
(a) clear the stored point (and its derived pin) on gatherings created before 2026-10-22, (b) delete those test gatherings,
(c) leave them and record the risk. The sign-up and partner rows hold no coordinates.

## 5. "Also nearby" and the directory question (for counsel / Google)

**What exists, exactly** (switch `places_also_nearby_enabled` OFF; rule in `utils/alsoNearby.js`, data in `useAlsoNearby.js`):
- Trigger: a person types an ask ("pottery class tonight"); Nearby resolves it to one of its own categories. Only if that category
  is a business type (not a public-place ask, not a people ask, not a sensitive category) AND Nearby found fewer than 3 distinct
  partner businesses.
- Request: one Places API (New) Nearby/Text Search from the person's location with the CATEGORY NAME only (never the typed words),
  inside an app-wide 100-calls/day budget (`claim_places_search`). Fields (`PLACE_SEARCH_FIELDS`): place ID, name, short + full address, location, types,
  Google Maps link; no ratings, price, photos, reviews or attributions.
- Display: at most 3 rows, under the heading "Also nearby (not a Nearby partner)", BELOW all of Nearby's own results, never ranked
  or mixed with them; Google places that are Nearby partners are removed. Each row: name, approximate distance, and one action,
  Directions, which opens Google Maps. No Ask, offer, booking, reason, rating or sponsorship. "Google Maps" attribution under it.
- Nothing stored; not on any map; no business is charged or told; not used for ads, ranking or analytics.

**Questions to put to counsel / Google:**
1. Is a short, supplementary list of nearby Google places, shown only when the app's own partner results are too few, a "listings or
   directory service" under 3.2.3(d)(iii)?
2. The same question for the features ALREADY LIVE in code (not behind the switch): Discover's Places tab (browse Google places by
   category, search, Open now filter), Home/Discover "Places to go" (item 189, public places for an activity), and Create's "Popular
   nearby" venues. These use Google results in a browse format more than "Also nearby" does. No real users have seen them (no device
   build, 8 test accounts), but they ship with the app as is. If counsel's answer to (1) is "no", these need the same answer before launch.
3. Is the partner-removal step (comparing Google results to Nearby partners by name + distance, client-side, discarded after) a use
   of Places coordinates that 3.2.3(c) restricts? It is not point-in-polygon analysis and nothing is kept.
4. Discover has a map view (`GatheringsMapView`: Apple Maps on iPhone, Google on Android) on the same screen as the Places list,
   shown alternately (a list/map toggle), never together; Google places are never drawn on it. Is that "with or near a non-Google
   Map" under 3.2.3(e)? If yes: use the Google provider for that map too, or keep Places results off the screen that has the map.

## Status

- [x] Findings recorded with links (section 1)
- [x] Attribution verified in code on every surface (section 2); gaps A-C await an owner decision; phone check = C23
- [x] Terms of Service disclosure added (section 3)
- [x] Storage confirmed in code + production (section 4); legacy points cleared 2026-10-23 (migration 20270338 LIVE)
- [x] "Also nearby" documented for review (section 5); counsel/Google answer open, also covers the live Places surfaces
- [x] Discovery surfaces held behind one switch (off); question written (not sent); logo attribution; Privacy Policy updated;
      change notice drafted (not sent)
