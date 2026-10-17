# Item 148 device checklist (story & sighting location privacy, 2026-10-17)

Database side verified (journey `storySightingLocation` 14/14 on prod and on a from-scratch rebuild, real roles). This
checklist covers what only a phone / real browser can show. Record: device, OS, app build, date, result per check.
Item 148 stays NOT DEVICE-VERIFIED until checks 1-9 are recorded; check 10 decides the deferred metadata work.

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 1 | Post a PUBLIC story (phone A), open the Discover map (phone B, signed in) | Story pin appears, within ~1 km of where it was posted (anywhere in its cell); never on the exact spot | |
| 2 | Reload / reopen the map | Pin does not move | |
| 3 | Post 2 more public stories from the same spot | All on the same pin (stacked), not scattered around the spot | |
| 4 | Post a public story with location permission denied | Story posts; no pin; no error | |
| 5 | Post a friends-only story | No location prompt; posts; never on the map; friends see it in the story rings | |
| 6 | Business moment from the phone AND from the business website (real browser) | No location prompt; posts; shows in the business moments row; never on the map | |
| 7 | Add a gathering memory (completed gathering) | No location prompt; memory shows on the gathering | |
| 8 | Discover -> Crossed Paths, and Friends crossed paths | Lists load as before; no sighting map button / overview pins (none since 2026-07-28; unchanged) | |
| 9 | Story rings, a story viewer, Discover candidate story dot | Load and play as before (no permission error) | |
| 10 | DEFERRED item, metadata: take a story photo with the in-app camera (iPhone + Android), and pick a library photo for a memory; download each stored file from the `stories` bucket and inspect it (e.g. `exiftool`) | Record whether ANY GPS / location metadata is present. If yes: a follow-up re-encodes media before upload (not built). Videos: check container location atoms too | |
