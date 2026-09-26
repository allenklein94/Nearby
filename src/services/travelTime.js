// Real travel time: the plug-in point ONLY (2026-09-26, owner decision "both, staged"). NO PROVIDER EXISTS and none may be
// registered until the owner approves the design and cost in PRODUCT_AUDIT/TRAVEL_TIME_ROUTING_DESIGN_2026-09-26.md. This file
// makes no network call, holds no API key and sends no location anywhere; with no provider every call returns null and ranking
// stays on measured miles (constants/transportMode.js).
//
// The one internal concept ranking reads is travelTimeSeconds(result, mode): seconds, or null when unknown. Ranking never knows
// which provider produced it. A future provider is a server-side relay (an edge function) that receives a coarsened origin and
// candidate KEYS (never destination coordinates from the client; the server looks them up) and returns seconds per key.

export const ROUTABLE_MODES = ['walking', 'bike', 'driving', 'transit'];
// At most this many of the already-ranked, already-bounded results are ever routed per ask (cost cap; see the design doc).
export const MAX_ROUTED_CANDIDATES = 20;
export const ROUTING_TIMEOUT_MS = 1500;
// A travel time outside this range is treated as unknown, never shown.
export const MAX_PLAUSIBLE_SECONDS = 4 * 60 * 60;
// Origin sent to a provider is rounded to 3 decimals (~110 m), never the precise fix.
export const ORIGIN_DECIMALS = 3;

let provider = null;

// provider = { name, travelTimes({ origin: {latitude, longitude}, candidateKeys: string[], mode, signal }) => Promise<(number|null)[]> }
// Test-only today. Registering a real one requires the owner's explicit approval (design doc, "Approval gate").
export function registerTravelTimeProvider(p) {
  provider = p && typeof p.travelTimes === 'function' ? p : null;
}
export const hasTravelTimeProvider = () => provider != null;

export function coarsenOrigin(loc) {
  const lat = loc?.latitude;
  const lng = loc?.longitude;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const f = 10 ** ORIGIN_DECIMALS;
  return { latitude: Math.round(lat * f) / f, longitude: Math.round(lng * f) / f };
}

const plausible = (s) => typeof s === 'number' && Number.isFinite(s) && s >= 0 && s <= MAX_PLAUSIBLE_SECONDS;

// Returns Map(candidateKey -> seconds) for the top results, or null (no provider, no mode, no origin, failure, timeout).
// Never throws: any failure falls back to null, and the caller ranks on miles as before.
export async function getTravelTimes(candidates, mode, origin, { keyOf, timeoutMs = ROUTING_TIMEOUT_MS } = {}) {
  if (!provider || !ROUTABLE_MODES.includes(mode) || !Array.isArray(candidates) || typeof keyOf !== 'function') return null;
  const from = coarsenOrigin(origin);
  if (!from) return null;
  const keys = [...candidates]
    .sort((a, b) => (b?.score ?? 0) - (a?.score ?? 0))
    .map(keyOf)
    .filter(Boolean)
    .filter((k, i, all) => all.indexOf(k) === i)
    .slice(0, MAX_ROUTED_CANDIDATES);
  if (keys.length < 2) return null;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer;
  try {
    const result = await Promise.race([
      provider.travelTimes({ origin: from, candidateKeys: keys, mode, signal: controller?.signal }),
      new Promise((resolve) => { timer = setTimeout(() => { controller?.abort(); resolve(null); }, timeoutMs); }),
    ]);
    if (!Array.isArray(result) || result.length !== keys.length) return null;
    const map = new Map();
    keys.forEach((k, i) => { if (plausible(result[i])) map.set(k, result[i]); });
    return map.size >= 2 ? map : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// The internal concept: seconds for this result in this mode, from a map getTravelTimes returned, else null.
export function travelTimeSeconds(result, travelTimes, keyOf) {
  if (!(travelTimes instanceof Map) || typeof keyOf !== 'function') return null;
  const s = travelTimes.get(keyOf(result));
  return plausible(s) ? s : null;
}

const MODE_PHRASE = { walking: 'on foot', bike: 'by bike', driving: 'by car', transit: 'by transit' };

// "About 12 min by transit". Only for a real provider-supplied time; unknown = null (nothing shown, nothing guessed).
export function travelTimeLabel(seconds, mode) {
  if (!plausible(seconds) || !MODE_PHRASE[mode]) return null;
  const min = Math.max(1, Math.round(seconds / 60));
  const text = min < 60 ? `${min} min` : `${Math.floor(min / 60)} hr${min % 60 ? ` ${min % 60} min` : ''}`;
  return `About ${text} ${MODE_PHRASE[mode]}`;
}
