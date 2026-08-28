// Universal Signal Remediation Pass, P2 item 7 (CLAUDE.md, Aug 28 2026) --
// one real, shared definition of "is the weather bad enough right now to
// bias toward indoor" / "good enough to bias toward outdoor," replacing
// three independent re-implementations the audit found
// (homeRecommendations.js's weatherAdjustment(), HomeScreen.js's own
// showIndoor/showOutdoor for the weather card's gathering suggestions,
// and DiscoverHubScreen.js's weatherIndoorBias/weatherOutdoorBias) --
// each combining the two real, independent weather signals differently.
//
// get_weather_result() (the one RPC every caller here already calls, via
// getSocialForecast()) returns two genuinely distinct real signals, not
// one: `forecast_label` ('Quiet'/'Excellent', 'Good' is already filtered
// out at the source -- see getSocialForecast()'s own comment) is a
// CURRENT-CONDITIONS bucket (weather code + temp right now);
// `rain_risk`/`heat_risk`/`cold_risk`/`outdoor_favorable` are FORECAST-
// derived (a real lookahead window, added later in the weather signals
// engine V1 pass). Both are real and meaningful, and neither subsumes
// the other -- it can be clear right now with rain coming later, or
// raining right now with a clear forecast for the rest of the day.
//
// Indoor bias: HomeScreen.js's own existing definition was the most
// complete of the three (a genuine union of both real signals -- bad
// *right now* per forecast_label, OR a bad *forecast* for later today
// per the risk fields) -- adopted here as canonical rather than either
// narrower single-signal version homeRecommendations.js/
// DiscoverHubScreen.js used on their own.
//
// Outdoor bias: a symmetric extension of the same union principle to the
// positive case. Neither prior single-signal version
// (forecast_label==='Excellent' alone in DiscoverHubScreen.js,
// outdoor_favorable alone in homeRecommendations.js) was any more
// "correct" than the other -- both are real, independent positive
// signals, so a genuinely good day by either measure counts. Indoor
// bias always wins over outdoor when both would technically apply
// (matches HomeScreen's own existing precedence exactly) -- a mixed
// signal (bad right now but a good forecast, or vice versa) shouldn't
// push an outdoor suggestion while there's also a real reason to avoid
// one.
//
// A real, disclosed behavior widening for the two callers that
// previously only checked one of the two signals
// (homeRecommendations.js: forecast fields only; DiscoverHubScreen.js:
// forecast_label only) -- both already had the full real weather object
// in scope (the same getSocialForecast() shape everywhere), so this
// closes a real coverage gap rather than introducing new data.
export function isWeatherIndoorBiased(weather) {
  if (!weather) return false;
  return (
    weather.forecast_label === 'Quiet' ||
    weather.rain_risk === 'high' ||
    weather.heat_risk === true ||
    weather.cold_risk === true
  );
}

export function isWeatherOutdoorBiased(weather) {
  if (!weather) return false;
  if (isWeatherIndoorBiased(weather)) return false;
  return weather.forecast_label === 'Excellent' || weather.outdoor_favorable === true;
}
