import AsyncStorage from '@react-native-async-storage/async-storage';
import { rememberShown } from '../utils/offerProgress';

// Owner item 13: the step-change animations already played on this device, per business, so a reopen or a second push
// tap never replays one. Device-only convenience: a failed read/write just means an animation may play again.
const keyFor = (partnerId) => `biz_offer_progress_shown:${partnerId}`;

export async function loadShownProgress(partnerId) {
  try {
    const raw = await AsyncStorage.getItem(keyFor(partnerId));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveShownProgress(partnerId, list, keys) {
  const next = rememberShown(list, keys);
  try {
    await AsyncStorage.setItem(keyFor(partnerId), JSON.stringify(next));
  } catch {
    // ignore: the worst case is one replay
  }
  return next;
}
