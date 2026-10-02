// Item 141 (2026-10-02, owner): notification PRIORITY. Not everything deserves the same urgency; three levels, one table,
// every push type the app handles classified exactly once (notificationTier.test.js reads the destination switch, and asserts
// supabase/functions/send-push/index.ts carries an identical copy, which is where delivery is decided).
//
//   high    something needs you soon, or a commitment you have just changed: a business responded, it starts soon, a deadline
//           is close, it was cancelled or moved, a message. Sound, high delivery priority, heads-up on Android.
//   medium  person-to-person news and the status of your own plans: a friend joined, you're approved, an invitation, a
//           confirmation. Shown, but silent: no sound, no heads-up (iOS 'active' without sound; Android 'updates' channel).
//   low     discovery and nudges: trending / recommended nearby, streaks, demand signals, digests, a partner's shared-list
//           additions. Silent and passive: iOS 'passive' (lands in Notification Center without lighting the screen),
//           Android LOW-importance channel, normal (deferrable) delivery.
//
// An unclassified (future) type is 'medium': delivered and visible, but never interrupting until someone decides it should.
// This replaces item 110's two tiers (important / recommendation): 'important' split into high and medium.
// Not built, by decision: a "friend became interested" push (Interested is private and never shown to another person,
// item 37); the closest real signal, a friend JOINING ("Sam is going", friend_joined_gathering), is medium.
export const NOTIFICATION_PRIORITIES = ['high', 'medium', 'low'];

const HIGH = [
  // a business responded / a deadline is close
  'business_offer_received', 'social_offer_received', 'group_plan_offer_pending', 'business_request_expiring',
  // it starts soon, or a commitment changed under you
  'gathering_reminder', 'gathering_updated', 'gathering_cancelled', 'community_cancelled', 'plan_item_time_changed',
  'plan_reservation_cancelled', 'plan_cancelled', 'occasion_group_plan_cancelled', 'business_reservation_cancelled',
  // a person is talking to you right now
  'message', 'video_call',
  // business owner: a same-day/next-day request (only urgent requests push individually), a booking, a customer cancelling
  'business_opportunity_received', 'business_offer_accepted', 'reservation_cancelled_by_customer',
];

const LOW = [
  // discovery
  'recommended_gathering', 'recurring_gathering', 'recommended_business_availability', 'group_intent_signal',
  'crossed_paths_sighting', 'new_story', 'business_update', 'business_recall_outreach',
  // nudges
  'first_mission_reminder', 'momentum_streak_nudge', 'reward_tier_nudge', 'match_reminder',
  // a partner added to a shared list (never time-bound)
  'playlist_addition', 'trip_idea_addition', 'shared_decision_addition', 'constitution_addition', 'memory_addition',
  'stress_test_addition', 'timeline_addition',
  // demand signals and the business digest
  'aggregated_demand_growing', 'occasion_demand_growing', 'community_area_demand_growing', 'business_opportunities_digest',
];

const MEDIUM = [
  // people
  'match', 'new_match', 'friend_discovery_match', 'wave', 'screenshot', 'friend_request', 'friend_accepted', 'birthday',
  'friend_joined_gathering', 'occasion_surprise_revealed',
  // your gatherings
  'gathering_approved', 'gathering_waitlisted', 'gathering_interest', 'gathering_invite', 'gathering_business_reminder',
  // occasions coming up (days of lead time)
  'birthday_upcoming', 'anniversary_upcoming', 'occasion_upcoming',
  // your plans and requests
  'business_reservation_confirmed', 'plan_organizer_added', 'plan_confirmed', 'plan_addon_removed',
  'business_offer_withdrawn', 'business_offer_declined', 'business_request_all_declined',
  'group_plan_invite', 'group_plan_response', 'group_plan_confirmed', 'group_plan_reservation_confirmed', 'group_plan_removed',
  'social_offer_responded', 'date_proposal', 'date_proposal_response', 'experience_shared', 'preference_poll_received',
  'occasion_group_plan_invite', 'occasion_group_plan_decided', 'occasion_group_plan_voting_business',
  'occasion_group_plan_stalled', 'occasion_group_plan_date_set', 'occasion_group_plan_guest_rsvp',
  // business owner: account and status
  'business_partner_approved', 'business_partner_denied', 'business_partner_needs_info', 'business_partnership_response',
  'business_request_cancelled', 'business_offer_review_result',
];

export const NOTIFICATION_PRIORITY_BY_TYPE = Object.freeze(Object.fromEntries([
  ...HIGH.map((t) => [t, 'high']), ...MEDIUM.map((t) => [t, 'medium']), ...LOW.map((t) => [t, 'low']),
]));

export function notificationPriority(type) {
  return NOTIFICATION_PRIORITY_BY_TYPE[type] ?? 'medium';
}

export const ANDROID_NOTIFICATION_CHANNELS = {
  high: 'important-alerts',
  medium: 'updates',
  low: 'recommendations',
};

// How each priority is delivered (the Expo push fields send-push sets). Identical copy in send-push (test-enforced).
export const PRIORITY_DELIVERY = {
  high: { sound: 'default', priority: 'high', channelId: 'important-alerts', interruptionLevel: 'active' },
  medium: { sound: null, priority: 'default', channelId: 'updates', interruptionLevel: 'active' },
  low: { sound: null, priority: 'normal', channelId: 'recommendations', interruptionLevel: 'passive' },
};
