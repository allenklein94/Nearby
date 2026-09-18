// One place decides where the user is (Location wiring, Phase 1, 2026-09-18). Before this, ~19 call
// sites each asked for permission and took their own GPS fix -- several per screen load, each with its
// own failure handling. Now: permission is checked once and only asked for while undetermined; a fresh
// fix is shared (in-flight requests are deduplicated, results cached briefly); if a fix can't be had the
// OS last-known position and then the last position we stored are used, so the user is never asked
// "where are you" by the app -- it either knows, or the feature honestly says location is off.
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportNotificationArea } from './notificationArea';

const STORED_KEY = 'nearby_last_location';
export const DEFAULT_MAX_AGE_MS = 2 * 60 * 1000;

export function createLocationProvider({ loc, storage, now = () => Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS, onFix = null }) {
  let cache = null; // { coords, timestamp, source }
  let inflight = null;
  let lastStatus = null;

  async function permissionGranted(ask) {
    let perm = await loc.getForegroundPermissionsAsync().catch(() => null);
    if (perm?.status !== 'granted' && ask && perm?.status !== 'denied') {
      perm = await loc.requestForegroundPermissionsAsync().catch(() => null);
    } else if (perm?.status === 'denied' && ask && perm?.canAskAgain) {
      perm = await loc.requestForegroundPermissionsAsync().catch(() => perm);
    }
    lastStatus = perm?.status ?? 'undetermined';
    return lastStatus === 'granted';
  }

  async function remember(pos, source) {
    cache = { coords: pos.coords, timestamp: now(), source };
    if (source === 'fresh') Promise.resolve(onFix?.(pos.coords)).catch(() => {}); // real current fix only
    storage?.setItem(STORED_KEY, JSON.stringify({ coords: { latitude: pos.coords.latitude, longitude: pos.coords.longitude }, timestamp: cache.timestamp })).catch(() => {});
    return cache;
  }

  async function resolve({ fresh, ask, accuracy }) {
    if (!(await permissionGranted(ask))) return null;
    let pos = await loc.getCurrentPositionAsync({ accuracy }).catch(() => null);
    if (pos?.coords) return remember(pos, 'fresh');
    pos = await loc.getLastKnownPositionAsync().catch(() => null);
    if (pos?.coords) return remember(pos, 'last_known');
    try {
      const stored = JSON.parse((await storage?.getItem(STORED_KEY)) ?? 'null');
      if (stored?.coords) {
        cache = { coords: stored.coords, timestamp: stored.timestamp ?? 0, source: 'stored' };
        return cache;
      }
    } catch {
      // fall through to null
    }
    return null;
  }

  // Returns { coords: { latitude, longitude, ... }, source } -- same `.coords` shape callers already used
  // with expo-location -- or null when location is off/unavailable. Never throws.
  async function getUserLocation({ fresh = false, ask = true, accuracy = loc.Accuracy?.Balanced } = {}) {
    if (!fresh && cache && now() - cache.timestamp < maxAgeMs && cache.source !== 'stored') return cache;
    if (!inflight) inflight = resolve({ fresh, ask, accuracy }).finally(() => { inflight = null; });
    return inflight;
  }

  // For features that can't work without it: same message each feature already used.
  async function requireUserLocation(message, opts) {
    const l = await getUserLocation(opts);
    if (!l) throw new Error(message);
    return l;
  }

  return {
    getUserLocation,
    requireUserLocation,
    getLocationPermissionStatus: () => lastStatus,
    __reset: () => { cache = null; inflight = null; lastStatus = null; },
  };
}

const provider = createLocationProvider({ loc: Location, storage: AsyncStorage, onFix: reportNotificationArea });
export const getUserLocation = provider.getUserLocation;
export const requireUserLocation = provider.requireUserLocation;
export const getLocationPermissionStatus = provider.getLocationPermissionStatus;
