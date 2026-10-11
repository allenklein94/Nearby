# Item 32 device checklist (offer merges into Your Plan + confirmed-plan look), 2026-10-11

**Status: OPEN.** Item 32 is signed off only when every check below is recorded as passed on a real device. Automated tests
and parse checks do not count as visual verification (owner, 2026-10-11). Keep the existing automated coverage intact:
`src/utils/offerToPlanMerge.test.js` (the 14 confirmed-plan-look tests and the item 32 tests), the logo guards in
`src/services/businessLogos.test.js`, and both item 32 tests in `src/journeys/offerJourney.journey.js`.

Also still open for item 32: native-speaker review of `ui.requestDetail.plan.titleAtBusiness` (11 languages).

## Setup

- A request whose own screen shows the Your Plan card (the first request, not an add-on), with at least one business offer.
  Ideally two offers from different businesses, one with a screened logo and one without.
- To test a logo that fails to load: a screened logo URL that is unreachable (e.g. device offline after the list loads).
- Run each section in light AND dark appearance. Run section 3 once with Reduce Motion on.

## Record (one row per run)

| Date | Device | OS + version | Appearance | Reduce Motion | Build | Tester |
|------|--------|--------------|------------|---------------|-------|--------|
|      |        |              |            |               |       |        |

## 1. Connecting line

| # | Check | Light | Dark | Notes |
|---|-------|-------|------|-------|
| 1.1 | Before booking (offers waiting, or one offer pending), the line on the plan card's left is faint and broken (dashes). | | | |
| 1.2 | After accepting ("You're booked"), the line becomes solid success green. | | | |
| 1.3 | During the moment, the line draws smoothly from top to bottom, with no jumps or flicker. | | | |
| 1.4 | The four plan lines appear in this order: activity (title), time, place, people (who, party size). | | | |
| 1.5 | Leave the screen, come back, and fully reload the app: the confirmed plan still shows the solid green line, with no replay. | | | |
| 1.6 | The line is clearly visible and has enough contrast in both modes; the faint dashes are visible but read as "not yet". | | | |
| 1.7 | A cancelled plan shows no line. | | | |

## 2. Business logo

| # | Check | Light | Dark | Notes |
|---|-------|-------|------|-------|
| 2.1 | Before accepting, no logo appears on the plan card; each offer card shows only its own logo, the same way for every business (no bias when comparing). | | | |
| 2.2 | After booking, the booked business's screened logo replaces the 📍 pin in the place line. | | | |
| 2.3 | The logo is clear and recognizable at 18 px (a wide wordmark is shown whole, not cropped). | | | |
| 2.4 | After the visit (completed plan), reopening it still shows the logo. | | | |
| 2.5 | Only screened logos ever appear (a business whose logo was not approved shows the pin, never its raw image). | | | |
| 2.6 | A booked business with no logo shows the 📍 pin. A logo that fails to load also falls back to the pin (never a place line with neither). | | | |

## 3. Assembly and rendering (accept an offer; plan card visible or scrolled to)

| # | Check | Pass | Notes |
|---|-------|------|-------|
| 3.1 | While the "✓ Business" chip travels up, the plan card waits in its starting state. | | |
| 3.2 | The logo and the connecting line appear only after the chip lands, not before. | | |
| 3.3 | All plan text stays readable throughout (it never fades out or disappears). | | |
| 3.4 | No flicker, layout shift, or flash of the finished card between "You're booked", the chip landing and the assembly. | | |
| 3.5 | MEASURE the rendered duration on the phone, from the booked card to the end of the glow, with a screen recording (count frames; record the fps and the measured ms). It must be under 0.9 s. The 845 ms code timing is not proof. | | |
| 3.6 | One glow only; no second celebration and no extra vibration (the accept's own success vibration only). | | |
| 3.7 | Touching the screen during the moment stops the scroll; the assembly still completes. | | |
| 3.8 | Reduce Motion on: the finished card appears at once (solid line, logo in, no chip, no glow). | | |

## Results

A documented check is not a passed check: only a recorded result closes it.

(Record failures here with a screenshot or recording, the device row, and the fix commit.)
