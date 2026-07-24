import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';
import { navigationRef } from '../navigation/RootNavigator';

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

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = tokenData.data;

  await supabase.from('profiles').update({ expo_push_token: token }).eq('id', userId);

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.DEFAULT,
      lightColor: '#e94560',
    });
  }
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
function routeNotificationTap(data) {
  if (!data || !navigationRef.isReady()) return;

  switch (data.type) {
    case 'match':
    case 'message':
    case 'gathering_approved':
    case 'playlist_addition':
    case 'trip_idea_addition':
    case 'shared_decision_addition':
      if (data.match_id) {
        navigationRef.navigate('Chat', { matchId: data.match_id });
      }
      break;
    case 'wave':
      navigationRef.navigate('MainTabs', { screen: 'Notices' });
      break;
    case 'gathering_interest':
      navigationRef.navigate('MainTabs', { screen: 'Gatherings' });
      break;
    default:
      break;
  }
}

// Call once, high in the component tree (App.js), to start listening
// for notification taps for the lifetime of the app.
export function setupNotificationTapHandling() {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    routeNotificationTap(response.notification.request.content.data);
  });

  // Also handle the case where the app was fully closed and the user
  // tapped a notification to launch it fresh — this response won't
  // fire through the listener above since it happens before the
  // listener even gets attached.
  Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) {
      routeNotificationTap(response.notification.request.content.data);
    }
  });

  return () => subscription.remove();
}