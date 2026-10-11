# Item 36 - weather as a contextual layer: device checklist (2026-10-11)

Status: APPROVED by the owner (2026-10-11), READY FOR DEVICE VERIFICATION, not device-verified. Wording (item 192) and
card-only scope are locked. If the card feels too subtle on the device, note it here; do not widen the effect without the owner.

Item 36 stays OPEN until every check below is recorded as passed on a real device (device, OS, appearance mode, result).
Tests and parse checks are not visual sign-off. Built: `constants/weatherAtmosphere.js`, `motion/WeatherShift.js`,
`utils/weatherShiftSeen.js`, theme tokens `weatherSunWash` / `weatherWetWash` / `weatherColdWash`, Home weather card.

How to force a condition: the card appears only when the forecast at a real, upcoming, classified gathering's start time is
relevant (rain/storm/snow/heat/cold -> indoor picks; an exceptional dry 65-82F daylight window -> outdoor picks, once a day).
Clearing the app's storage (key `home_weather_shift_seen`) makes the next card play its shift again.

| # | Check | Light | Dark |
|---|---|---|---|
| 1 | Rain card: cool wash, rain icon; reads as the same card, slightly cooler, not a coloured block | | |
| 2 | Perfect-evening card: warm wash, sun icon; equally subtle | | |
| 3 | Snow/cold card: pale cold wash, snow icon | | |
| 4 | First time a condition is seen today: the wash fades in once (~0.8 s), slow and quiet; the words, icon and rows are readable from the first frame and do not move | | |
| 5 | Back, tab switch, pull to refresh, app restart the same day: no replay, the wash is simply there | | |
| 6 | Condition changes (rain card, later a different condition): the new wash fades in once | | |
| 7 | Reduce Motion on: the wash is there at once, never animates | | |
| 8 | Nothing else on Home or any other screen changes colour or moves with the weather | | |
| 9 | Tapping a row or "More things to do" during the fade acts at once | | |
| 10 | Text contrast is comfortable on every wash (tested AA in code; confirm by eye) | | |

Device: ____  OS: ____  Date: ____  Result: ____
