import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { navigationRef } from '../navigation/RootNavigator';
import { getBusinessAvailabilityById } from './businessFulfillment';
import { extractNameFromBirthdayTitle } from './celebrateSomething';

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
export async function routeNotificationTap(data) {
  if (!data) return;
  if (!navigationRef.isReady()) {
    AsyncStorage.setItem(PENDING_NOTIFICATION_TAP_KEY, JSON.stringify(data));
    return;
  }

  switch (data.type) {
    case 'match':
    case 'new_match':
    case 'friend_discovery_match':
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
    case 'video_call':
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
    // Item 55 ("deep links should preserve context, too" -- CLAUDE.md):
    // don't just dump the tap onto a bare GatheringDetail as if the user
    // browsed there organically -- carry the real reason (the push's own
    // already-computed body text, the exact sentence the user just read in
    // their notification center, never a re-derived or fabricated one)
    // through so the destination screen can explain itself. Only
    // gathering_interest (a host learns someone's interested) and
    // recommended_gathering (a stranger learns real nearby interest matches
    // their own tastes) also suggest the one obviously-relevant next
    // action, "Invite Friends" -- capitalizing on real momentum. The other
    // types here (an update, a reminder, a waitlist change) have a real
    // reason worth showing but no single obviously-correct next action to
    // force, so they get the reason banner without ever the invite CTA.
    case 'gathering_interest':
    case 'recommended_gathering':
      if (data.gathering_id) {
        navigationRef.navigate('GatheringDetail', {
          gatheringId: data.gathering_id,
          notificationReason: data.body ?? null,
          notificationSuggestsInvite: true,
        });
      } else {
        navigationRef.navigate('Gatherings');
      }
      break;
    case 'gathering_invite':
    case 'gathering_reminder':
    case 'gathering_waitlisted':
    case 'gathering_updated':
    case 'recurring_gathering':
      if (data.gathering_id) {
        navigationRef.navigate('GatheringDetail', { gatheringId: data.gathering_id, notificationReason: data.body ?? null });
      } else {
        navigationRef.navigate('Gatherings');
      }
      break;
    // Item 49 (CLAUDE.md, "don't notify users about things they can't
    // actually act on"): this push already names a specific matched
    // posting (availability_id/partner_id), and a real consumer action
    // already exists for one -- AskBusinessScreen's "matchedAvailability"
    // banner + bound submit, the same shape resolveBusinessAvailability()
    // (intentResolver.js) already builds for the intent-search path.
    // get_business_availability_by_id() (SECURITY DEFINER, since
    // business_availability itself has owner-only SELECT RLS) fetches that
    // one row so the tap lands on the actual matched posting, pre-filled,
    // rather than a generic browse tab. A stale tap (the slot already
    // expired/filled by the time it's opened) genuinely returns null --
    // falls back to the same honest generic Discover landing rather than
    // crashing or showing a broken screen.
    case 'recommended_business_availability':
      if (data.availability_id) {
        try {
          const posting = await getBusinessAvailabilityById(data.availability_id);
          if (posting) {
            navigationRef.navigate('AskBusiness', {
              matchedAvailability: {
                availabilityId: posting.id,
                partnerName: posting.partner_name,
                title: posting.title,
                description: posting.description,
                offerType: posting.offer_type,
                price: posting.price,
                attributes: posting.attributes ?? [],
                cuisine: posting.cuisine,
              },
            });
            break;
          }
        } catch (e) {
          // Fall through to the generic landing below.
        }
      }
      navigationRef.navigate('MainTabs', { screen: 'Discover' });
      break;
    case 'gathering_cancelled':
      // Deliberately no gathering_id in this payload — the row is already
      // deleted by the time this fires (an ON DELETE trigger), so there's
      // nothing left to open. Land on browse instead of doing nothing.
    case 'first_mission_reminder':
      navigationRef.navigate('Gatherings');
      break;
    // Item 49 audit fix: community_cancelled previously had no case at all
    // (tap did nothing) despite carrying a real, specific reason. Same
    // honest "row's gone, land on browse" shape as gathering_cancelled
    // above — cancel_community() doesn't delete the row, but there's no
    // dedicated post-cancellation detail view to land on either way.
    case 'community_cancelled':
      navigationRef.navigate('Communities');
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
    // "Birthday reminders as a recurring retention mechanism" (CLAUDE.md):
    // a real, planning-oriented reason to open the app, distinct from
    // 'birthday' above (a same-day "wish them happy birthday" touchpoint,
    // unchanged) -- this fires days ahead, while there's still real time
    // to plan something, and lands directly on the "What would you like to
    // do?" step of the Celebrate Something wizard rather than a bare
    // profile. Two real sources: a connected Nearby friend/match's own
    // profiles.birthdate (birthday_user_id + a real display_name, both
    // server-sent), or a self-logged Occasions row for someone who isn't a
    // Nearby user at all (occasion_title only -- Item 61 follow-up,
    // CLAUDE.md's "don't require a Nearby account"). The occasions path
    // best-effort extracts a name from the row's own title; when that
    // doesn't cleanly parse, land one step earlier (still occasion-
    // prefilled) rather than guess a name wrong.
    case 'birthday_upcoming':
      if (data.birthday_user_id) {
        navigationRef.navigate('CelebrateSomething', {
          initialOccasion: 'birthday',
          initialWhoFor: 'friend',
          initialWhoForName: data.display_name ?? null,
          initialWhoForFriendId: data.birthday_user_id,
        });
      } else if (data.occasion_title) {
        const extractedName = extractNameFromBirthdayTitle(data.occasion_title);
        navigationRef.navigate('CelebrateSomething', extractedName
          ? { initialOccasion: 'birthday', initialWhoFor: 'family', initialWhoForName: extractedName }
          : { initialOccasion: 'birthday' });
      } else {
        navigationRef.navigate('Occasions');
      }
      break;
    // "Anniversaries could work the same way" (CLAUDE.md, direct follow-up):
    // same real mechanism as birthday_upcoming above, but anniversary has
    // no structural "connected user's own profile field" source at all
    // (send_anniversary_planning_nudges() reads only a self-logged
    // occasions row) -- connected_user_id/connected_display_name are only
    // ever present when the wizard's own "save to calendar" step originally
    // attached a real, explicitly-picked connected friend/match to this
    // occasion (celebrateSomething.js's shouldOfferCalendarSave()), never
    // inferred from the free-text title.
    case 'anniversary_upcoming':
      if (data.connected_user_id) {
        navigationRef.navigate('CelebrateSomething', {
          initialOccasion: 'anniversary',
          initialWhoFor: 'friend',
          initialWhoForName: data.connected_display_name ?? null,
          initialWhoForFriendId: data.connected_user_id,
        });
      } else if (data.occasion_title) {
        navigationRef.navigate('CelebrateSomething', { initialOccasion: 'anniversary' });
      } else {
        navigationRef.navigate('Occasions');
      }
      break;
    case 'crossed_paths_sighting':
      // Same real destination the existing Crossed Paths Discover surfaces
      // already open on a tap (see CLAUDE.md, "Unified Crossed Paths across
      // Dating and Friends") -- there's no dedicated sighting-detail screen,
      // the person's own profile is the real place this is actionable from.
      if (data.other_user_id) {
        navigationRef.navigate('ViewProfile', { userId: data.other_user_id });
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
    // "Request More Information" reviewer state (see CLAUDE.md's own entry)
    // -- lands on the same status screen, which now renders a real
    // resubmit form for a 'needs_info' row.
    case 'business_partner_needs_info':
      navigationRef.navigate('MyBusinessApplication');
      break;
    // Item 55 fast-follow #2 (CLAUDE.md): CommunityDetail, the other
    // candidate the original Item 55 paragraph flagged and BusinessRequest
    // Detail's own fast-follow already left open — same real-reason banner,
    // no forced CTA (the community's own content right below is already the
    // obvious next thing to look at, same reasoning as BusinessRequestDetail).
    case 'business_partnership_response':
      if (data.target_type === 'gathering' && data.target_id) {
        navigationRef.navigate('GatheringDetail', { gatheringId: data.target_id, notificationReason: data.body ?? null });
      } else if (data.target_type === 'community' && data.target_id) {
        navigationRef.navigate('CommunityDetail', { communityId: data.target_id, notificationReason: data.body ?? null });
      }
      break;
    case 'business_update':
      if (data.partner_id) {
        navigationRef.navigate('BusinessProfile', { partnerId: data.partner_id });
      }
      break;
    // Item 49 audit fix: business_offer_withdrawn previously had no case at
    // all (tap did nothing) despite naming the real business and request.
    // Same destination as its sibling business_offer_received below -- it's
    // the same request object, just a different state change on it.
    case 'business_offer_withdrawn':
    case 'business_offer_received':
      if (data.request_id) {
        navigationRef.navigate('BusinessRequestDetail', { requestId: data.request_id, notificationReason: data.body ?? null });
      }
      break;
    case 'business_opportunity_received':
    // Nearby 2.0 vision layer 1 (see CLAUDE.md's "Nearby 2.0 Vision" doc):
    // real aggregated nearby demand crossing a meaningful threshold for
    // this business's own category -- same destination as a single
    // opportunity, since the new "Demand Near You" section lives right
    // above the opportunities list on the same tab.
    case 'aggregated_demand_growing':
      navigationRef.navigate('BusinessDashboard', { initialSection: 'requests' });
      break;
    // Community demand-generation (see CLAUDE.md's "community
    // demand-generation" entry) -- the community-Area-scoped counterpart to
    // aggregated_demand_growing above, notifying a community's own
    // creator/leaders instead of a business. Lands on that community's own
    // detail screen, the one real place this signal is actionable from.
    case 'community_area_demand_growing':
      if (data.community_id) {
        navigationRef.navigate('CommunityDetail', { communityId: data.community_id, notificationReason: data.body ?? null });
      }
      break;
    case 'business_offer_accepted':
      navigationRef.navigate('BusinessDashboard');
      break;
    // Item 50 (state consistency audit, fix 5): cancel_business_reservation()
    // notifies whichever side didn't initiate the cancellation -- two
    // distinct type strings since each role needs a different destination
    // for the same underlying event (see that RPC's own comment).
    case 'business_reservation_cancelled':
      if (data.request_id) {
        navigationRef.navigate('BusinessRequestDetail', { requestId: data.request_id, notificationReason: data.body ?? null });
      }
      break;
    case 'reservation_cancelled_by_customer':
      navigationRef.navigate('BusinessDashboard', { initialSection: 'requests' });
      break;
    // Nearby 2.0 vision layer 3 (see CLAUDE.md's "Nearby 2.0 Vision" doc):
    // a real "N people you know are looking for X" signal just crossed
    // its own real 2+ threshold -- lands on Home, where the dismissible
    // group-intent card (built the same pass) re-fetches and renders it
    // fresh, same as any other Home visit.
    case 'group_intent_signal':
      navigationRef.navigate('MainTabs', { screen: 'Home' });
      break;
    // "Nearby V3/V4" plan, Phase D (see CLAUDE.md) -- every group-plan
    // event, whether it's a fresh invite, a response, a budget re-consent
    // ping, or a live reservation confirming, all land on the same real
    // GroupPlan detail screen, which renders whatever's actually true for
    // the caller right now rather than needing a distinct destination per
    // event shape.
    case 'group_plan_invite':
    case 'group_plan_response':
    case 'group_plan_confirmed':
    case 'group_plan_offer_pending':
    case 'group_plan_reservation_confirmed':
    case 'group_plan_removed':
    // Item 49 audit fix: a social offer only ever exists on a request that
    // came out of a group plan (GroupPlanScreen is the only screen that
    // ever calls submit_social_offer/respond_to_social_offer), so it
    // belongs in this same family now that submit_social_offer()/
    // respond_to_social_offer() also resolve and include the real
    // proposal_id (20261011_notification_reason_action_fixes.sql). A
    // request created outside the group-plan flow correctly yields no
    // proposal_id -- the tap does nothing rather than guessing, same as
    // any other case here with a missing id.
    case 'social_offer_received':
    case 'social_offer_responded':
      if (data.proposal_id) {
        navigationRef.navigate('GroupPlan', { proposalId: data.proposal_id });
      }
      break;
    // Item 49 audit fix: date_proposal/date_proposal_response previously
    // had no case at all (tap did nothing) despite naming the real
    // proposer/outcome. Both already carry match_id; DateProposalScreen is
    // keyed by matchId and fetches the latest proposal itself, so no new
    // lookup is needed.
    case 'date_proposal':
    case 'date_proposal_response':
      if (data.match_id) {
        navigationRef.navigate('DateProposal', { matchId: data.match_id });
      }
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
  await routeNotificationTap(JSON.parse(raw));
}

// Call once, high in the component tree (App.js), to start listening
// for notification taps for the lifetime of the app.
// Item 55: the push's own real body text (the exact reason a user just
// read) lives on the notification's top-level `content`, separate from its
// custom `data` payload -- merged here, once, so every routeNotificationTap
// case can read data.body without each one reaching into `response` itself.
function contentWithBody(content) {
  return { ...content.data, body: content.body ?? null };
}

export function setupNotificationTapHandling() {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    routeNotificationTap(contentWithBody(response.notification.request.content));
  });

  // Also handle the case where the app was fully closed and the user
  // tapped a notification to launch it fresh — this response won't
  // fire through the listener above since it happens before the
  // listener even gets attached.
  Notifications.getLastNotificationResponseAsync().then((response) => {
    if (response) {
      routeNotificationTap(contentWithBody(response.notification.request.content));
    }
  });

  return () => subscription.remove();
}