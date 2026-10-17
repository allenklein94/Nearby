# Item 145: "Get directions" on a gathering's meet-up point, device checklist (2026-10-17)

Owner (2026-10-17): build "Get directions" beside "Get an Uber there"; record the ready-state proposal as met as built (live time
labels stay plain text, item 108; no urgency styling, motion or time-based reordering; day-of actions are not moved in the last hour).

Built: `GatheringAttendingSection` (host + approved attendees only, `showsAttendingSection`) shows "🧭 Get Directions" (existing
`ui.requestDetail.getDirections` / `getDirectionsA11y`, 11 languages) under the meet-up map, beside "Get an Uber there". It opens
`buildDirectionsUrl` (the booked plan's builder: Google Maps turn-by-turn to the exact point; the maps app picks walking/driving)
for the point from `get_gathering_meetup_point` (host/attendee-only RPC, unchanged). Invalid or missing coordinates = no point at
all (`getGatheringMeetupPoint` + `isValidCoordinate`): no map, no Uber, no directions. A failed open = "Couldn't open Maps."
No migration, no new strings, no motion. Tests `src/utils/gatheringDirections.test.js`; journey `gatheringDirections` 5/5 (host +
approved get the exact link; requested, waitlisted, stranger get nothing; anon can't call the lookup).

Record for each run: device, OS, Google Maps installed or not, appearance, account role, result, notes.

| # | Check | Result |
|---|-------|--------|
| 1 | Approved attendee: the meet-up point shows the map, then "🧭 Get Directions", then "🚗 Get an Uber there". | |
| 2 | Tap Get Directions (Google Maps installed): it opens with directions to the exact pin on the map; switch walking/driving there. | |
| 3 | Same without Google Maps (iPhone): the link opens in the browser's Google Maps with the same destination; note whether iOS offers Apple Maps. | |
| 4 | Host: same as 1-2 on their own gathering. | |
| 5 | Requested, waitlisted, Interested-only, a stranger: no meet-up point and no directions anywhere. | |
| 6 | A gathering whose point can't be read (offline at load): no map, no Uber, no directions, nothing broken; it appears after a reload online. | |
| 7 | Airplane mode at tap time: maps opens or "Couldn't open Maps." shows; the app stays usable. | |
| 8 | Back from maps returns to the same gathering at the same scroll. | |
| 9 | Screen reader: "Get directions, button". | |
| 10 | Within the last hour before start: nothing moves, reorders or changes colour; "On my way" and chat behave as before. | |
| 11 | Light and dark; long translated labels (de, tl, ru) fit on one or two lines. | |
