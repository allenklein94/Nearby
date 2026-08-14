import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { navigationRef } from '../navigation/RootNavigator';

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
export function routeNotificationTap(data) {
  if (!data) return;
  if (!navigationRef.isReady()) {
    AsyncStorage.setItem(PENDING_NOTIFICATION_TAP_KEY, JSON.stringify(data));
    return;
  }

  switch (data.type) {
    case 'match':
    case 'new_match':
    case 'message':
    case 'gathering_approved':
    case 'playlist_addition':
    case 'trip_idea_addition':
    case 'shared_decision_addition':
    case 'constitution_addition':
    case 'memory_addition':
    case 'stress_test_addition':
    case 'timeline_addition':
    case 'match_reminder':
    case 'screenshot':
      // Same "Together" tools family as playlist/trip/decision — all of
      // these are per-match content additions or nudges, all carry a
      // match_id, all belong in that match's own chat.
      if (data.match_id) {
        navigationRef.navigate('Chat', { matchId: data.match_id });
      }
      break;
    case 'wave':
      navigationRef.navigate('Notices');
      break;
    case 'gathering_interest':
    case 'gathering_invite':
    case 'gathering_reminder':
    case 'gathering_waitlisted':
    case 'gathering_updated':
    case 'recurring_gathering':
      if (data.gathering_id) {
        navigationRef.navigate('GatheringDetail', { gatheringId: data.gathering_id });
      } else {
        navigationRef.navigate('Gatherings');
      }
      break;
    case 'gathering_cancelled':
      // Deliberately no gathering_id in this payload — the row is already
      // deleted by the time this fires (an ON DELETE trigger), so there's
      // nothing left to open. Land on browse instead of doing nothing.
    case 'first_mission_reminder':
      navigationRef.navigate('Gatherings');
      break;
    case 'friend_request':
    case 'friend_accepted':
      navigationRef.navigate('Friends');
      break;
    case 'birthday':
      if (data.birthday_user_id) {
        navigationRef.navigate('ViewProfile', { userId: data.birthday_user_id });
      }
      break;
    case 'new_story':
      // No dedicated story-viewer route exists anywhere in this app —
      // stories render inline in feeds/carousels, not as their own
      // navigable screen. This is the closest real destination (the
      // poster's own profile), not a claim that it opens the story itself.
      if (data.story_user_id) {
        navigationRef.navigate('ViewProfile', { userId: data.story_user_id });
      }
      break;
    case 'momentum_streak_nudge':
      navigationRef.navigate('Momentum');
      break;
    case 'reward_tier_nudge':
      navigationRef.navigate('Rewards');
      break;
    case 'business_partner_approved':
      navigationRef.navigate('BusinessDashboard');
      break;
    case 'business_partner_denied':
      navigationRef.navigate('MyBusinessApplication');
      break;
    case 'business_partnership_response':
      if (data.target_type === 'gathering' && data.target_id) {
        navigationRef.navigate('GatheringDetail', { gatheringId: data.target_id });
      } else if (data.target_type === 'community' && data.target_id) {
        navigationRef.navigate('CommunityDetail', { communityId: data.target_id });
      }
      break;
    case 'business_update':
      if (data.partner_id) {
        navigationRef.navigate('BusinessProfile', { partnerId: data.partner_id });
      }
      break;
    case 'business_offer_received':
      if (data.request_id) {
        navigationRef.navigate('BusinessRequestDetail', { requestId: data.request_id });
      }
      break;
    case 'business_offer_accepted':
      navigationRef.navigate('BusinessDashboard');
      break;
    default:
      break;
  }
}

// Called from RootNavigator once session && profileComplete, so a tap that
// arrived before the authenticated stack existed isn't lost.
export async function consumePendingNotificationTap() {
  const raw = await AsyncStorage.getItem(PENDING_NOTIFICATION_TAP_KEY);
  if (!raw) return;
  await AsyncStorage.removeItem(PENDING_NOTIFICATION_TAP_KEY);
  routeNotificationTap(JSON.parse(raw));
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