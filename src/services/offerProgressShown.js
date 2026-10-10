import AsyncStorage from '@react-native-async-storage/async-storage';
import { rememberShown } from '../utils/offerProgress';

// The step-change animations already played on this device, so a reopen, a second push tap or a duplicate realtime event
// never replays one. Owner item 13 (business, per partner) and marketplace moment 6 (customer "Visit confirmed", per
// signed-in person). Device-only convenience: a failed read/write just means an animation may play again; the stored
// transaction status is always what the screen shows.
export async function loadShown(storageKey) {
  try {
    const raw = await AsyncStorage.getItem(storageKey);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveShown(storageKey, list, keys) {
  const next = rememberShown(list, keys);
  try {
    await AsyncStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    // ignore: the worst case is one replay
  }
  return next;
}

export const businessProgressKey = (partnerId) => `biz_offer_progress_shown:${partnerId}`;
export const visitConfirmedKey = (userId) => `visit_confirmed_shown:${userId}`;

export const loadShownProgress = (partnerId) => loadShown(businessProgressKey(partnerId));
export const saveShownProgress = (partnerId, list, keys) => saveShown(businessProgressKey(partnerId), list, keys);
