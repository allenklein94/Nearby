// Item 39 (owner, 2026-10-11): "A friend is nearby". The one client source for it (design + owner decisions:
// PRODUCT_AUDIT/ITEM_39_FRIEND_NEARBY_DESIGN_2026-10-11.md; server: migration 20270296).
//   * consent: OFF by default. setFriendNearbySharing(true) is called ONLY by the Settings toggle (guarded); Home's quiet
//     reminder may only turn it OFF. Off deletes the stored fix server-side at once.
//   * reporting: only a real fresh foreground fix from services/userLocation.js (its onFix), only while sharing is on and
//     the app is active; never from a background task. Throttled here AND on the server (5 min unless moved >= 0.25 mi).
//   * reading: getNearbyFriend() -> at most ONE friend { id, name, photoPath } or null. The server never returns coordinates,
//     distance or time, and every "not nearby" cause is the same null.
//   * no push, no analytics, no behaviour event, nothing stored on the device about anyone's location.
import { AppState } from 'react-native';
import { supabase } from './supabase';
import { FRIEND_NEARBY } from '../constants/friendNearby';

let sharingOn = false; // known only from the server; until read, nothing is reported

const milesBetween = (a, b) => {
  const r = (x) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.latitude - a.latitude) / 2) ** 2
    + Math.cos(r(a.latitude)) * Math.cos(r(b.latitude)) * Math.sin(r(b.longitude - a.longitude) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
};

// Pure throttle (tested): should this fix be sent, given the last one sent?
export function shouldReportFix(last, coords, nowMs, { minReportIntervalMs, moveBypassMiles } = FRIEND_NEARBY) {
  if (!coords || typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') return false;
  if (!last) return true;
  if (nowMs - last.at >= minReportIntervalMs) return true;
  return milesBetween(last.coords, coords) >= moveBypassMiles;
}

export function createFriendNearbyReporter({ send, isSharing, isForeground, now = () => Date.now() }) {
  let last = null; // { coords, at }
  async function report(coords) {
    if (!isSharing() || !isForeground()) return;
    if (!shouldReportFix(last, coords, now())) return;
    const prev = last;
    last = { coords: { latitude: coords.latitude, longitude: coords.longitude }, at: now() };
    try {
      await send(coords.latitude, coords.longitude);
    } catch {
      last = prev; // best-effort; the next fix tries again
    }
  }
  report.reset = () => { last = null; };
  return report;
}

export const reportFriendNearbyFix = createFriendNearbyReporter({
  send: async (lat, lng) => {
    const { error } = await supabase.rpc('report_friend_nearby_fix', { lat_param: lat, lng_param: lng });
    if (error) throw error;
  },
  isSharing: () => sharingOn,
  isForeground: () => AppState.currentState === 'active',
});

let readCache = null; // { at, friend }

export async function getMyFriendNearbySharing() {
  const { data, error } = await supabase.rpc('get_my_friend_nearby_sharing');
  if (error) throw error;
  sharingOn = data === true;
  return sharingOn;
}

export async function setFriendNearbySharing(on) {
  const { data, error } = await supabase.rpc('set_friend_nearby_sharing', { on_param: !!on });
  if (error) throw error;
  sharingOn = data === true;
  readCache = null;
  reportFriendNearbyFix.reset();
  return sharingOn;
}

// At most one friend, or null. Never cached past FRIEND_NEARBY.readCacheMs, and never while sharing is off.
export async function getNearbyFriend({ now = Date.now() } = {}) {
  if (!sharingOn) return null;
  if (readCache && now - readCache.at < FRIEND_NEARBY.readCacheMs) return readCache.friend;
  const { data, error } = await supabase.rpc('get_nearby_friends');
  if (error) throw error;
  const row = (data ?? [])[0];
  const friend = row?.friend_id ? { id: row.friend_id, name: row.display_name, photoPath: row.photo_url ?? null } : null;
  readCache = { at: now, friend };
  return friend;
}
