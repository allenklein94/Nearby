// Owner item 36 (2026-10-11): weather as a quiet CONTEXTUAL LAYER, never a weather app. The one place it shows is the Home
// weather card (constants/weatherRelevance.js decides IF it exists and its words, items 62/192; unchanged). This only gives
// that card its atmosphere: a soft wash behind it and an icon that names the condition. Three washes, nothing else on the
// screen changes colour, nothing loops, rains or shines.
//   sun  = a perfect outdoor window, or very warm
//   wet  = rain or storms
//   cold = snow or cold
export const WEATHER_ATMOSPHERE = Object.freeze({
  outdoor_window: { wash: 'weatherSunWash', icon: 'sunny-outline', tone: 'warning' },
  heat: { wash: 'weatherSunWash', icon: 'thermometer-outline', tone: 'warning' },
  wet: { wash: 'weatherWetWash', icon: 'rainy-outline', tone: 'info' },
  storm: { wash: 'weatherWetWash', icon: 'thunderstorm-outline', tone: 'info' },
  snow: { wash: 'weatherColdWash', icon: 'snow-outline', tone: 'info' },
  cold: { wash: 'weatherColdWash', icon: 'snow-outline', tone: 'info' },
});

// -> { wash, icon, tone } (theme token names + an Ionicons name), or null for an unknown condition (the card then stays plain).
export function weatherAtmosphere(kind) {
  return WEATHER_ATMOSPHERE[kind] ?? null;
}
