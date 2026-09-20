# Weather in Home recommendations — audit and trigger rules (2026-09-20)

Question: why does weather sometimes produce Home recommendations and sometimes not?
Scope: audit + documented rules. **No code changed.** Not device-tested (no device tooling).

## 1. What exists today (verified in code)

One data source, three Home consumers:

| Piece | Where | Role |
|---|---|---|
| `get_weather_result` (SQL) | `supabase/migrations/20260822_weather_forecast_signals.sql` | Returns `forecast_label` (current conditions only), `rain_risk`, `heat_risk`, `cold_risk`, `outdoor_favorable` (next ~24h, 8 x 3h blocks) |
| `getSocialForecast` | `src/services/homeDashboard.js:178` | Fires an async pg_net request, **waits a fixed 2 s**, reads the result, drops `'Good'` |
| `isWeatherIndoorBiased/OutdoorBiased` | `src/utils/weatherBias.js` | The one shared predicate |
| "Right Now" weather card + "N indoor/outdoor gatherings today" | `HomeScreen.js` ~2262 | Renders when `socialForecast` is non-null |
| `weatherAdjustment` | `src/services/homeRecommendations.js:61` | +2 (`SCORE_HAPPENING_NOW`) on a gathering whose tag is classed indoor/outdoor |
| Indoor/outdoor map | `src/constants/gatheringIndoorOutdoor.js` | Sports, Music, Fitness, Travel, Photography, Concerts, Volunteering deliberately unclassified |

The rules themselves are already deterministic pure functions. The "sometimes it appears" behaviour comes from the layers around them.

## 2. Why it looks random — causes, ranked by how often the user would see it

1. **Fixed 2 s wait on an async HTTP call (real nondeterminism).** `getSocialForecast` sleeps 2000 ms, then `get_weather_result` returns *no row* if the `net._http_response` isn't there yet. Slow OpenWeather response -> `null` -> no card, no weather score, silently. Same user, same weather, same place: card on one open, absent on the next. Errors are only `console.error`.
2. **Forecast leg can be missing while the current leg is present.** Then `rain_risk='low'`, `outdoor_favorable=true` are *defaults*, not measurements. Harmless today only because `'Good'` is filtered first and `Quiet` wins the indoor precedence, but it is a fabricated-signal default that violates the no-invented-signals rule and would bite any change to the filter.
3. **The gate is the label bucket, not relevance.** `Good` (the ambiguous catch-all: anything not clear+60-85F, not rain, not <45/>95F) is dropped. So overcast 70F, drizzle-free cloudy, fog (id 7xx) are all "no card". Most days are `Good`, so the card appears on a minority of days, which reads as random.
4. **Hidden hard-coded thresholds, split across SQL and JS, no single doc:** `Quiet` = condition id < 700 (lumps drizzle with thunderstorm and snow) or temp <45 / >95; `Excellent` = `Clear` and 60-85F; rain risk `medium` >=0.3 / `high` >=0.6 pop (only `high` counts as indoor bias, so `medium` = nothing); heat/cold from forecast extremes; rain-time note only within first 3 blocks with pop >=0.4.
5. **Indoor/outdoor classification gaps.** The card's gathering rows and the +2 bonus only fire for classified tags. A rainy day with only Sports/Music gatherings nearby yields a "Quiet" card with no suggestions; an outdoor-favorable day likewise.
6. **No time-of-day / day-night handling.** `Excellent` is "clear + comfortable *right now*", so it fires at 3 a.m. and is labelled "Right Now" while suggesting gatherings "today" that may already be over (`isToday` only, no "still upcoming" check in `getHomeDashboard`'s indoor/outdoor lists — verify against `getNearbyGatherings` filtering before changing).
7. **Forecast window unrelated to the activity.** Risk fields cover the next ~24h, not the window of the gathering being suggested (a 9 p.m. hike vs a noon downpour).
8. **Competition with stronger intent.** The ranking weight of +2 equals "happening now", but an explicit interest match is +5 and a network signal higher, so weather cannot beat an explicit match in scoring. However the *card* is a separate surface with no priority relation to intent/recents, and it renders even when it has nothing to suggest (just a label + detail), so it can push content down on days it adds no value.
9. Not a cause but worth noting: Home's `getHomeInsight` intentionally has no weather branch, so the copy "Perfect night for something outside" does not exist anywhere yet.

## 3. Proposed deterministic trigger rules

Principle: compute **"is weather materially relevant to a specific suggestion right now?"** once, as a pure function of `(weather snapshot, local time, candidate activity window, candidate classification)`. Emit a message only when true; otherwise emit nothing (no filler card).

**Inputs (all structured, none AI):** current condition id + temp; forecast blocks covering the *activity window* (default: now -> +6h for Home; the gathering's own start for a gathering); pop; extremes; local sunrise/sunset (OpenWeather already returns them); candidate indoor/outdoor class; distance; upcoming-only.

**Materially relevant = one of (first match wins, ordered by severity):**
1. **Severe** — thunderstorm (2xx), heavy rain/snow, temp >=100F or <=20F in the window -> "Weather turning rough — good indoor options" (indoor only; never suggest outdoor).
2. **Wet window** — max pop in window >= 0.6 -> indoor bias (existing `high`).
3. **Temperature extreme** — window temp <45F or >95F (existing thresholds).
4. **Favorable outdoor** — window clear/partly cloudy, 60-85F, pop <0.3, and *daylight or within 1h of dusk* -> "Great weather for something outside" (day) / "Perfect night for something outside" (night, only if 60-85F and clear).
5. Anything else (incl. today's `Good`, medium rain risk, fog) -> **not relevant, no message.**

**Suppression / priority (never compete with stronger signals):**
- Weather only *annotates or nudges* a candidate that already qualifies on interest/distance/availability; it never creates a candidate by itself. (Keep weight <= +2; keep it CONTEXTUAL.)
- If the user has an active intent result, a pending invite/offer, or a happening-now item, the weather card is suppressed (or collapses to a one-line reason on the candidate).
- The card renders only if it has >=1 real, upcoming, classified gathering/business to point at ("no dead end", no label-only card).
- If the forecast leg is unavailable, **do not default to favorable**: treat as "unknown" and fall back to current-conditions rules only.

**Fetching (kills the coin flip):** replace the fixed 2 s sleep with a bounded poll (e.g. 250 ms steps, 6 s cap) or, better, a single server-side call/edge function that fetches and returns synchronously; cache per ~0.7 mi cell for 15 min so refocus is stable; log a real reason on failure rather than silently rendering nothing.

## 4. Suggested build order (needs owner OK — touches SQL + Home surface)

1. Bounded poll + cache in `getSocialForecast` (removes the randomness; small, no schema change).
2. Return `forecast_known boolean`; stop defaulting risks to favorable.
3. Move the rule table into one `src/constants/weatherRelevance.js` (thresholds, precedence) + Jest table test; make SQL only supply raw numbers.
4. Day/night + upcoming-only + activity-window handling.
5. Suppress label-only card; priority vs intent.
6. Classify more tags only where honestly indoor/outdoor (Concerts/Sports stay unclassified unless venue data exists).

## 5. Open questions for the owner
- Should the card copy be "Perfect night for something outside" style (needs the day/night rule) or stay label-based?
- OK to add a small edge function/RPC change so weather is fetched synchronously, or keep pg_net and only add polling?
- Drizzle (3xx) counts as "wet window" or not?
