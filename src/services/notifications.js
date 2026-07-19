import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Call once after login (e.g. from RootNavigator once profileComplete
// is true). Silently no-ops on simulators, which don't support push.
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
    // Don't nag — respect a decline. In-app notices/matches/messages
    // still work without push, they just won't show a system alert.
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