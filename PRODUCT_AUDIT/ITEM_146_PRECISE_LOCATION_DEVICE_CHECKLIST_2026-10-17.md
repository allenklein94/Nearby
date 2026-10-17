# Item 146 device checklist (precise gathering location security, 2026-10-17)

Database side verified (journey `preciseLocation` 17/17 on prod, real roles; REST probes as a signed-out visitor). This
checklist covers what only a phone can show. Record: device, OS, app build, date, result per check.

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 1 | Discover map, a known public gathering | Pin shows, at most ~1 km from the real spot (Option A, 20270324: moved again; host + ~780 m cell) | |
| 2 | Same gathering's card/detail distance line | A plausible "x mi away"; may differ from the real spot by up to ~0.5 mi (Option A) | |
| 3 | Discover nearby list at the edge of your radius | Loads, no error; edge gatherings may enter/leave | |
| 4 | Create -> publish a gathering | Publishes; the "Your gathering is live!" panel appears (createGathering returns named columns) | |
| 5 | Edit that gathering (title, details) | Saves | |
| 6 | Host: Get directions on your own gathering | Maps opens at the exact meet-up point | |
| 7 | Approved attendee (second phone): Get directions | Maps opens at the exact meet-up point | |
| 8 | Pending request / waitlisted (second phone) | No Get directions link | |
| 9 | Places list with a venue that hosts a public gathering | "N gatherings hosted here" counts it; a private gathering there is not counted | |
| 10 | Home weather card from a gathering's location | Still loads (uses the pin) | |
| 11 | Business website (real browser): any screen showing gatherings | Loads, no permission error | |
| 12 | Option A (20270324): one host, two+ upcoming gatherings at the same spot | Map shows them as one tight cluster (~20 m ring) around one pin; each marker opens its own callout and detail; the cluster does not move on refresh; zoomed out it reads as one spot | |
