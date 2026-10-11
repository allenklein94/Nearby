// Owner item 36: the environmental shift plays only when the weather CHANGES for this person: the first time they see a
// condition (rain, sun, cold...) on a given day. The same condition later that day, after Back, a tab switch or an app
// restart, is already settled. One stored record { day, kind } (AsyncStorage), read once at start-up; until it has been read
// nothing plays (never a flash), so the worst case is a missed shift, never a repeated one.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const WEATHER_SHIFT_KEY = 'home_weather_shift_seen';
let cache; // undefined = not read yet; null = nothing stored

// The rule, pure: play only once the record is known and it differs (another day or another condition).
export function weatherShiftShouldPlay({ stored, kind, todayKey }) {
  if (stored === undefined || !kind) return false;
  return !stored || stored.day !== todayKey || stored.kind !== kind;
}

export function loadWeatherShiftSeen(storage = AsyncStorage) {
  return Promise.resolve()
    .then(() => storage.getItem(WEATHER_SHIFT_KEY))
    .then((raw) => { const v = raw ? JSON.parse(raw) : null; cache = v && typeof v === 'object' ? v : null; })
    .catch(() => { cache = null; });
}

export function peekWeatherShiftSeen() {
  return cache;
}

export function rememberWeatherShift(kind, todayKey, storage = AsyncStorage) {
  cache = { day: todayKey, kind };
  Promise.resolve().then(() => storage.setItem(WEATHER_SHIFT_KEY, JSON.stringify(cache))).catch(() => {});
}

export function resetWeatherShiftSeen(value) { cache = value; }
