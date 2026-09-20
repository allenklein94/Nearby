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

// Outdoor bias needs a KNOWN, precipitation-free forecast: outdoor_favorable is
// NULL while the forecast is unresolved (unknown, never favorable) and false
// when rain/drizzle (pop >= 0.3), heat or cold is forecast. A clear current
// label alone (Excellent) no longer suffices without a known forecast.
export function isWeatherOutdoorBiased(weather) {
  if (!weather) return false;
  if (isWeatherIndoorBiased(weather)) return false;
  return weather.outdoor_favorable === true;
}

// Item 63: a business's own weather_setting ('indoor' | 'outdoor' | 'weather_dependent' | null) against today's weather.
// A RANKING nudge only -- an offer is never hidden. Points are the caller's `weight` (a positive number); the return is
// signed. Rules: outdoor = down in indoor-worthy weather, up in a known dry outdoor window; weather_dependent = down in
// indoor-worthy weather, never promoted; indoor = up in indoor-worthy weather, never penalized; null/unknown weather = 0.
export const BUSINESS_WEATHER_SETTINGS = ['indoor', 'outdoor', 'weather_dependent'];

export function businessWeatherAdjustment(setting, weather, weight) {
  if (!BUSINESS_WEATHER_SETTINGS.includes(setting) || !weather || !(weight > 0)) return 0;
  const indoorWorthy = isWeatherIndoorBiased(weather);
  const outdoorWindow = isWeatherOutdoorBiased(weather);
  if (setting === 'indoor') return indoorWorthy ? weight : 0;
  if (setting === 'weather_dependent') return indoorWorthy ? -weight : 0;
  if (indoorWorthy) return -weight;
  return outdoorWindow ? weight : 0;
}

// Stable re-rank of offers (each carrying brand_partners.weather_setting) by the business weather nudge. Same order when the
// weather is unknown or no business declared anything; nothing is removed.
export function rankOffersByBusinessWeather(offers, weather, weight = 1) {
  if (!Array.isArray(offers) || !weather) return offers;
  const scored = offers.map((o, i) => ({ o, i, a: businessWeatherAdjustment(o?.brand_partners?.weather_setting, weather, weight) }));
  if (scored.every((x) => x.a === 0)) return offers;
  return scored.sort((x, y) => y.a - x.a || x.i - y.i).map((x) => x.o);
}

// Adds the business weather nudge to resolver candidates that belong to a business (partnerId), given a map of
// partnerId -> weather_setting. Returns new objects; candidates without a partner or a setting are untouched.
export function applyBusinessWeatherToCandidates(candidates, settingByPartnerId, weather, weight) {
  if (!weather || !settingByPartnerId) return candidates;
  return candidates.map((c) => {
    const adj = c?.partnerId ? businessWeatherAdjustment(settingByPartnerId.get(c.partnerId), weather, weight) : 0;
    return adj === 0 ? c : { ...c, score: (c.score ?? 0) + adj };
  });
}
