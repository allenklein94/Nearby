// Item 140 (2026-10-02, owner): every notification carries ONE direct next action, shown as a button on the notification
// itself ("Coastal Coffee made you an offer" -> View Offer). The button opens exactly what tapping the notification opens
// (navigation/notificationDestinations.js); this table only names it.
//
// The labels are deliberately NAVIGATION verbs (View, Review, Reply, Open, Start Planning...), never a state change
// (Accept, Join, Pay, Vote): the object may have changed since the push was sent (the offer taken, the spot gone, the vote
// closed), so the action that changes something lives on the destination screen, where it is generated from the object's
// CURRENT state (utils/primaryAction.js, item 73). A label is a promise about where the tap goes (global rule 7).
//
// send-push sets the push's categoryId from the same table (supabase/functions/send-push/index.ts keeps a copy;
// notificationActions.test.js asserts the two are identical). The app registers one category per action, labelled in the
// person's language (services/notifications.js). A device that has not registered the categories yet simply shows no
// button; tapping the notification still works.
export const NOTIFICATION_ACTION_KEYS = [
  'view_plan', 'view_offer', 'review_request', 'view_gathering', 'view_invite', 'view_attendees', 'reply', 'open_chat',
  'view_notices', 'see_details', 'browse_gatherings', 'find_something_else', 'view_friend_request', 'view_friends',
  'view_profile', 'start_planning', 'plan_visit', 'view_progress', 'open_dashboard', 'view_application', 'view_business',
  'view_opportunities', 'view_your_offers', 'view_booking', 'view_community', 'see_ideas', 'view_proposal', 'answer_question',
];

export const NOTIFICATION_ACTION_BY_TYPE = {
  // a match or a conversation
  match: 'open_chat', new_match: 'open_chat', friend_discovery_match: 'open_chat', message: 'reply',
  playlist_addition: 'open_chat', trip_idea_addition: 'open_chat', shared_decision_addition: 'open_chat',
  constitution_addition: 'open_chat', memory_addition: 'open_chat', stress_test_addition: 'open_chat',
  timeline_addition: 'open_chat', match_reminder: 'open_chat', screenshot: 'open_chat', video_call: 'open_chat',
  wave: 'view_notices',
  // gatherings: yours (you're going / waiting / hosting) = the plan; someone else's = the gathering
  gathering_approved: 'view_plan', gathering_reminder: 'view_plan', gathering_updated: 'view_plan',
  gathering_waitlisted: 'view_plan', gathering_business_reminder: 'view_plan',
  gathering_interest: 'view_attendees', gathering_invite: 'view_invite',
  recommended_gathering: 'view_gathering', friend_joined_gathering: 'view_gathering', recurring_gathering: 'view_gathering',
  gathering_cancelled: 'find_something_else', community_cancelled: 'find_something_else', first_mission_reminder: 'browse_gatherings',
  // people
  friend_request: 'view_friend_request', friend_accepted: 'view_friends',
  birthday: 'view_profile', crossed_paths_sighting: 'view_profile', new_story: 'view_profile', occasion_surprise_revealed: 'view_profile',
  // occasions
  birthday_upcoming: 'start_planning', anniversary_upcoming: 'start_planning', occasion_upcoming: 'start_planning',
  business_recall_outreach: 'plan_visit',
  // progress
  momentum_streak_nudge: 'view_progress', reward_tier_nudge: 'view_progress',
  // a request the person made to businesses
  business_offer_received: 'view_offer', business_reservation_confirmed: 'view_plan', plan_organizer_added: 'view_plan',
  plan_confirmed: 'view_plan', plan_reservation_cancelled: 'view_plan', plan_cancelled: 'view_plan',
  plan_addon_removed: 'view_plan', plan_item_time_changed: 'view_plan',
  business_offer_withdrawn: 'review_request', business_offer_declined: 'review_request',
  business_request_all_declined: 'review_request', business_reservation_cancelled: 'review_request',
  recommended_business_availability: 'see_details', business_update: 'view_business',
  // group plans and occasion plans
  group_plan_invite: 'view_invite', occasion_group_plan_invite: 'view_invite',
  group_plan_response: 'view_plan', group_plan_confirmed: 'view_plan', group_plan_offer_pending: 'view_plan',
  group_plan_reservation_confirmed: 'view_plan', group_plan_removed: 'view_plan',
  social_offer_received: 'view_offer', social_offer_responded: 'view_plan',
  occasion_group_plan_decided: 'view_plan', occasion_group_plan_voting_business: 'view_plan',
  occasion_group_plan_stalled: 'view_plan', occasion_group_plan_date_set: 'view_plan',
  occasion_group_plan_cancelled: 'view_plan', occasion_group_plan_guest_rsvp: 'view_plan',
  date_proposal: 'view_proposal', date_proposal_response: 'view_plan', experience_shared: 'view_plan',
  preference_poll_received: 'answer_question',
  group_intent_signal: 'see_ideas',
  // communities
  community_area_demand_growing: 'view_community', business_partnership_response: 'see_details',
  // a business owner
  business_partner_approved: 'open_dashboard', business_partner_denied: 'view_application', business_partner_needs_info: 'view_application',
  business_opportunity_received: 'view_opportunities', business_opportunities_digest: 'view_opportunities',
  aggregated_demand_growing: 'view_opportunities', occasion_demand_growing: 'view_opportunities',
  business_request_cancelled: 'view_opportunities', business_offer_review_result: 'view_your_offers',
  business_offer_accepted: 'view_booking', reservation_cancelled_by_customer: 'view_booking',
};

export const CATEGORY_PREFIX = 'nearby_';
export const categoryIdFor = (type) => (NOTIFICATION_ACTION_BY_TYPE[type] ? `${CATEGORY_PREFIX}${NOTIFICATION_ACTION_BY_TYPE[type]}` : null);
// The one button each category carries; tapping it is handled exactly like tapping the notification.
export const OPEN_ACTION_ID = 'open';
