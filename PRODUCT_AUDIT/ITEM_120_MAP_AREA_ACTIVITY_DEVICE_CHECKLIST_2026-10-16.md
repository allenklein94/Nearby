# Item 120 device checklist: "N happening now" on the Discover map (2026-10-16)

Record: device, OS, appearance mode, date, result per check. Needs 2+ public gatherings near each other inside Happening Now
(started up to 30 min ago or starting within 2 h), with pins (coordinates).

1. Discover > All > 🗺️: two Happening Now gatherings within ~400 m show ONE pill "2 happening now" between their pins; no pill for a lone one.
2. No qualifying gatherings: no pill anywhere (never "0", never a pill for one).
3. The pill is static: no pulse, glow, fade-in or movement on its own; readable in light and dark mode; does not hide the pins under it.
4. Red "Live now" pins look and behave exactly as before (a gathering starting in 25 min is red; one starting in 90 min is not, yet counts in the pill).
5. Tap the pill: the list opens on Happening Now with "Happening now in this area" and exactly the pill's number of gatherings.
6. "Show all happening now" widens to all of Happening Now (still in the list).
7. Back arrow, the active ⚡ chip ✕ and Android back each return to the MAP, at the same position and zoom as before the tap.
8. Switching to the Today or This Weekend chip from the area list shows the whole window (the area does not carry over).
9. Gatherings / Perks tabs, a search, or a category view: no pills.
10. Leaving the screen open past a gathering's window edge: the pill's count updates on the next redraw (known: like the Happening Now section, the clock only wakes from 60 min before a start). Owner (2026-10-16): ACCEPTED for the first release, documented, not a failure: a gathering entering the 2 h window appears only on the next redraw.
10b. Pill -> list count drift (owner, 2026-10-16, accepted live-data edge case): if a gathering leaves the window between seeing the pill and tapping it, the list may show one fewer than the pill said. Record PASS only if the list then shows the current set and NEVER a gathering outside the window; any ineligible row = FAIL.
11. Screen reader: the pill reads "N gatherings happening now in this area. Show them" and acts as a button.
11b. Screen reader on a red pin (owner, 2026-10-16): reads "{title}, hosted by {name}, approximate location, starting soon or under way" (never "happening now", which is the pill's window); the pin's colour, callout "🔴 LIVE NOW" and timing are unchanged.
12. Non-English (at least one language): pill, heading and "Show all" read naturally (native review of the 4 `ui.mapView.area*` strings AND the reworded `ui.mapView.gatheringLiveA11y`, 10 languages).
