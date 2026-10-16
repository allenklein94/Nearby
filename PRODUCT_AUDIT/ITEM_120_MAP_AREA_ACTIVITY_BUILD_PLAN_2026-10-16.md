# Item 120: "N happening now" on the Discover map (owner, 2026-10-16) - APPROVED (owner, 2026-10-16), BUILT, NOT DEVICE-VERIFIED

Owner direction: build the minimal, static, public-activity version now; defer the animated pulse, people-activity density,
heatmaps/trending areas and any new pipeline. Zero qualifying activity = no label; never manufacture activity.

## Found while reading (must be settled first)

The map's red "Live now" pins use their own window, `isHappeningNow` in `components/GatheringsMapView.js`:
**starts within 30 min OR started up to 2 h ago**. Happening Now (Discover's section, its date view, Home's Right Now, the
"RIGHT NOW" time label) uses the one canonical rule `isWithinRightNowWindow` (`utils/rightNowWindow.js`): **started up to
30 min ago OR starts within 2 h**. They are different sets. A "3 happening now" label over pins that are red/not red by
another rule, opening a list of a different set, would break "same set, same count" (master principle 2).

Recommendation A: the label counts exactly the canonical Happening Now set. The map's red pin + "Live now" keep their own
meaning ("has started or is about to") but the window moves into `rightNowWindow.js` as a named second rule, so the map has no
private copy. Alternative B: make red pins = the Happening Now set too (changes what a red pin means: a gathering 1 h 50 min
away would turn red, and one that started 40 min ago would stop being red).

## Scope (proposed)

- **What is counted:** only gatherings already pinned for this viewer on the map (the same `filteredGatherings` Discover shows:
  visibility, blocks, filters already applied), inside the canonical Happening Now window. Nothing new is revealed: every
  counted gathering is already a pin the viewer can tap. No people, asks, Interested, perks, businesses or offers.
- **What an area is:** a group of those gatherings whose pins lie within ~400 m (0.25 mi) of another one in the group
  (one pure helper, `utils/mapAreaActivity.js`, zoom-independent). Label at the group's centre.
- **Threshold:** a label only for 2 or more (one gathering is already its own pin). None = nothing.
- **Look:** a small static pill "3 happening now" (theme tokens, no coral, no glow, never animates, no pulse). Pins stay as they are.
- **Tap:** switches to the list in Discover's existing Happening Now date view, limited to exactly that group's gatherings
  (same set, same count), with a heading line and the existing "Show everything" to widen. Back restores the map.
- **Vocabulary:** registered in `constants/surfaceVocabulary.js` before use (same meaning as Happening Now).
- **New strings (~3, 11 languages, native review):** "{count} happening now", its accessibility label, the area heading in the date view.
- **Not built:** pulse/glow, people density, heatmaps, trending areas, a server query, a migration, a push, any web map (the
  map is native only).

## Verification

Unit tests for the grouping/threshold/count = list rule (frozen "now"); guard that the map imports the window from
`rightNowWindow.js`; Jest + parse checks; business export not affected. Journeys: no server step changes, so no journey covers it
(disclosed; the data source is the existing Discover gathering read). Device checklist: label placement, overlap with pins,
tap -> list with the same count, Back -> map, zero/one gathering = no label, dark mode.

## Owner approval (2026-10-16)

Option A: the label counts exactly the Happening Now set (same window AND same eligibility: the list the map pins, which is the
list Happening Now's view reads); red "Live now" pins keep their meaning, their window moved into `rightNowWindow.js`
(`isMapLiveNow`); zero qualifying = no label; count and tap target are the same filtered set and the count follows the pins.
Plan approved as written.

## As built

- `utils/rightNowWindow.js`: `isMapLiveNow` (+ `MAP_LIVE_*_MS`), the map's old private `isHappeningNow`, behaviour unchanged.
- `utils/mapAreaActivity.js`: `happeningNowAreas(gatherings, now)` (pinned + `isWithinRightNowWindow`, single-link 400 m, 2+).
- `utils/discoverSections.js`: `buildDiscoverDateView({ areaIds })` limits Happening Now to an area (only for 'now'), `area` flag.
- `components/GatheringsMapView.js`: static pill markers (`areas`, `onSelectArea`), `restoreRegion` / `onRegionChangeComplete`.
- `screens/DiscoverHubScreen.js`: areas only when the map is on the plain All view (`mapAreasShown`), from `filteredGatherings`
  (the list the map pins) every render; tap = list + Happening Now limited to the area, heading + "Show all happening now";
  closing the view (back, active chip, Android back) returns to the map at the saved region; another chip drops the area.
- `constants/surfaceVocabulary.js`: `mapAreaHappeningNow` registered.
- Strings (4, 11 languages, machine-authored outside English, native review pending): `ui.mapView.areaCount` (plural),
  `areaCountA11y` (plural), `areaHeading`, `areaShowAll`.
- No server change, no migration, no motion, no push.

## Verified

Jest 450 suites, 6030 passed (new `mapAreaActivity.test.js` 14: grouping, threshold, window edges, no-pin, count follows pins
and clock, label = list set and count, red-pin rule unchanged, no private window, no animation, wiring guards;
`discoverDateView.test.js` close guard extended for the return to the map). Babel parse of the changed files; web build OK.
Journeys: none changed (no server step; the data is Discover's existing gathering read), so no journey covers this flow.
NOT verified: any device (checklist `ITEM_120_MAP_AREA_ACTIVITY_DEVICE_CHECKLIST_2026-10-16.md`), native review.

Residuals (disclosed, not changed): the minute clock wakes from 60 min before a start, so a gathering entering Happening Now at
2 h out joins the count (and the Happening Now section) on the next redraw, not exactly at the edge; if a window edge passes
between seeing the pill and tapping it, the list shows the truth at tap time (one fewer). The red pin's accessibility label
says "happening now" under its own window (owner kept red pins unchanged).
