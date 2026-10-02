import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { navigationRef } from '../navigation/RootNavigator';
import { openOnTop } from '../navigation/openOnTop';
import { getBusinessAvailabilityById } from './businessFulfillment';
import { notificationDestination } from '../navigation/notificationDestinations';
import { canOpenFromOutside, keepEntry, takeEntry, whenOpenable, firstTimeSeen } from '../navigation/outsideEntry';
import { ANDROID_NOTIFICATION_CHANNELS } from '../constants/notificationTier';
import { NOTIFICATION_ACTION_KEYS, CATEGORY_PREFIX, OPEN_ACTION_ID } from '../constants/notificationActions';
import { translate, getCurrentLanguage } from '../i18n/translate';

// A push tap can arrive (via getLastNotificationResponseAsync, below) before
// the authenticated stack is mounted — e.g. the app was fully closed and the
// tap is what's launching it. navigationRef isn't ready yet at that point, so
// the tap is stashed here and replayed once RootNavigator's own session/
// profileComplete effect confirms the stack exists — same PENDING_GATHERING_
// LINK_KEY pattern RootNavigator already uses for a nearby:// link tapped
// before sign-in.
const PENDING_NOTIFICATION_TAP_KEY = 'pending_notification_tap';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications(userId) {
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device — skipping on simulator.');
    return;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    return;
  }

  await registerNotificationActions();

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = tokenData.data;

  await supabase.from('profiles').update({ expo_push_token: token }).eq('id', userId);

  if (Platform.OS === 'android') {
    // Item 110 (CLAUDE.md, "distinguish Important (relationship/
    // contextual) from Recommendation (discovery)... much less spammy"):
    // two real Android channels, matching notificationTier()'s own two
    // tiers -- send-push (the one Edge Function every push actually goes
    // through) sets `channelId` on the outbound Expo push request using
    // that same classifier, so a "Sarah's birthday is in 7 days" push
    // lands on the HIGH-importance channel (heads-up + sound, today's
    // existing behavior, unchanged) while a "New live music nearby" push
    // lands quietly on the LOW-importance one (tray only, no heads-up, no
    // sound) instead of interrupting the same way. 'default' is kept
    // registered too as a harmless fallback for any push that somehow
    // arrives with no channelId (an already-installed client that hasn't
    // picked up this update yet, or a future bug) -- Android silently
    // falls back to it rather than dropping the notification.
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#e94560',
    });
    await Notifications.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNELS.important, {
      name: 'Important',
      importance: Notifications.AndroidImportance.HIGH,
      lightColor: '#e94560',
    });
    await Notifications.setNotificationChannelAsync(ANDROID_NOTIFICATION_CHANNELS.recommendation, {
      name: 'Recommendations',
      importance: Notifications.AndroidImportance.LOW,
      lightColor: '#e94560',
    });
  }
}

// Item 140: one notification category per next action (constants/notificationActions.js), each with ONE button labelled in
// the person's language. send-push sets the matching categoryId; the button opens exactly what tapping the notification
// opens (handleNotificationResponse ignores which of the two was tapped). Re-registered on every sign-in, so a language
// change takes effect then. Best effort: a failure only means no button, the notification itself is unaffected.
export async function registerNotificationActions(language = getCurrentLanguage()) {
  if (Platform.OS === 'web') return;
  await Promise.all(NOTIFICATION_ACTION_KEYS.map((key) =>
    Notifications.setNotificationCategoryAsync(`${CATEGORY_PREFIX}${key}`, [{
      identifier: OPEN_ACTION_ID,
      buttonTitle: translate(language, `ui.notificationActions.${key}`),
      options: { opensAppToForeground: true },
    }]).catch(() => null)));
}

export async function disablePushNotifications(userId) {
  await supabase.from('profiles').update({ expo_push_token: null }).eq('id', userId);
}

export async function updateBadgeCount(userId) {
  if (!Device.isDevice) return;

  const { data: matches } = await supabase
    .from('matches')
    .select('id')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);

  const matchIds = (matches ?? []).map((m) => m.id);
  if (matchIds.length === 0) {
    await Notifications.setBadgeCountAsync(0);
    return;
  }

  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('match_id', matchIds)
    .neq('sender_id', userId)
    .is('read_at', null);

  await Notifications.setBadgeCountAsync(count ?? 0);
}

// Routes a tapped notification to the right screen, based on the
// `type` set by whichever database trigger sent it. Notifications can
// arrive while the app is backgrounded or fully closed, so this needs
// to work independent of any specific screen already being mounted —
// that's why it uses the exported navigationRef rather than a
// component-level navigation prop.
export async function routeNotificationTap(data, ref = navigationRef) {
  if (!data) return;
  // Not signed in yet (or the app is still starting): keep it and open it right after (outsideEntry.js).
  if (!canOpenFromOutside(ref)) {
    await keepEntry(AsyncStorage, PENDING_NOTIFICATION_TAP_KEY, data);
    return;
  }
  const dest = await notificationDestination(data, { lookupAvailability: getBusinessAvailabilityById });
  if (dest) openOnTop(ref, dest.name, dest.params);
}

// Called from RootNavigator once session && profileComplete, so a tap that arrived before the authenticated stack existed
// isn't lost. Waits for the signed-in stack (it may still be mounting), then opens it once; a kept tap older than a day is
// dropped (outsideEntry.js).
export async function consumePendingNotificationTap(ref = navigationRef) {
  return whenOpenable(ref, async () => {
    const data = await takeEntry(AsyncStorage, PENDING_NOTIFICATION_TAP_KEY);
    if (data) await routeNotificationTap(data, ref);
  });
}

// Item 55: the push's own real body text (the exact reason a user just
// read) lives on the notification's top-level `content`, separate from its
// custom `data` payload -- merged here, once, so every destination can read
// data.body without reaching into `response` itself.
function contentWithBody(content) {
  return { ...content.data, body: content.body ?? null };
}

// Item 139: one handler for both ways a tap arrives (live listener, and the response that launched a closed app). The same
// response reported by both is opened once (firstTimeSeen).
export function handleNotificationResponse(response, ref = navigationRef) {
  if (!response || !firstTimeSeen(response)) return Promise.resolve();
  return routeNotificationTap(contentWithBody(response.notification.request.content), ref);
}

// Call once, high in the component tree (App.js), to start listening
// for notification taps for the lifetime of the app.
export function setupNotificationTapHandling() {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    handleNotificationResponse(response);
  });

  // Also handle the case where the app was fully closed and the user
  // tapped a notification to launch it fresh — this response won't
  // fire through the listener above since it happens before the
  // listener even gets attached.
  Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) handleNotificationResponse(response);
  });

  return () => subscription.remove();
}
