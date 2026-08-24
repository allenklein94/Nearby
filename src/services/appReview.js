import * as StoreReview from 'expo-store-review';
import AsyncStorage from '@react-native-async-storage/async-storage';

// CLAUDE.md, 14-item UX review item 14: a real App Store rating prompt,
// tied to a genuine high-satisfaction moment (a "Loved it" gathering
// rating) rather than a generic "rate us ⭐⭐⭐⭐⭐" banner competing with
// the OS's own native prompt. StoreReview.requestReview() is the real
// system-level dialog (Apple/Google's own UI, not a custom one) --
// this app only ever attempts it once per install via the persisted
// flag below; the OS itself further throttles how often the native
// dialog can actually appear, this gate just stops repeatedly asking
// regardless of what the OS decides to show.
const HAS_REQUESTED_REVIEW_KEY = 'has_requested_app_review';

export async function maybeRequestAppReview() {
  try {
    const already = await AsyncStorage.getItem(HAS_REQUESTED_REVIEW_KEY);
    if (already) return;
    const available = await StoreReview.isAvailableAsync();
    if (!available) return;
    await AsyncStorage.setItem(HAS_REQUESTED_REVIEW_KEY, 'true');
    await StoreReview.requestReview();
  } catch (e) {
    // Never worth surfacing to the user -- a rating prompt is the
    // definition of non-critical.
    console.error('maybeRequestAppReview failed', e);
  }
}
