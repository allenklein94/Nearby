// Item 142 (2026-10-02, owner): people control notification TYPES, from one central place.
//
// One store: profiles.notification_mutes (the groups a person turned off; empty = everything on).
// One check: public._send_push, the database's only push sender, drops a push whose type belongs to a muted group (it is
//   never queued). Every notification passes through it, so no screen, trigger or job decides this again.
// One table: NOTIFICATION_GROUP_BY_TYPE (below) = the SQL table notification_type_groups (test-enforced identical).
//
// The six older on/off columns (notify_planning, notify_social, ...) are now DERIVED from the store by a trigger (a column
// is off only when every group of its area is off) and are never written by the app. Each group sits in the area of the
// column its sender already checked, so those older checks can never block something the person left on. Their one
// non-push use follows automatically: turning off Discover > Recommendations also stops keeping the notification area.
//
// Item 143: a business owner's OPERATIONAL alerts are their own area ('business_owner', four owner_* groups) in the same
// store, independent of the customer 'businesses' area: one can never change or silence the other, even on one account
// that is both. Groups are assigned by each type's real RECIPIENT (audited from the senders), not by the word "business".
// The owner area is shown only to a business owner, and only an owner can change it (server-enforced). Account notices to
// a partner applicant (approved / denied / needs info) cannot be muted.
export const NOTIFICATION_AREAS = [
  { key: 'plans', icon: '📅', groups: ['plans_invitations', 'plans_changes', 'plans_reminders'], legacyColumn: 'notify_planning' },
  { key: 'friends', icon: '🤝', groups: ['friends_activity', 'friends_occasions'], legacyColumn: 'notify_social' },
  { key: 'dating', icon: '❤️', groups: ['dating'], legacyColumn: 'notify_dating' },
  { key: 'businesses', icon: '🏪', groups: ['business_offers', 'business_responses'], legacyColumn: 'notify_business' },
  { key: 'discover', icon: '🎯', groups: ['discover_recommendations', 'discover_nearby_people'] },
  { key: 'communities', icon: '🏘️', groups: ['communities'], legacyColumn: 'notify_community' },
  // Business owners only; no older column (owner senders read these groups only, via _send_push).
  { key: 'business_owner', icon: '💼', ownerOnly: true, groups: ['owner_requests', 'owner_offers', 'owner_reservations', 'owner_demand'] },
];
export const OWNER_GROUPS = ['owner_requests', 'owner_offers', 'owner_reservations', 'owner_demand'];
export const isOwnerGroup = (g) => OWNER_GROUPS.includes(g);
// The areas a person sees: the owner area only when they manage a business.
export function visibleNotificationAreas({ isBusinessOwner } = {}) {
  return NOTIFICATION_AREAS.filter((a) => !a.ownerOnly || isBusinessOwner);
}
// Translation keys for a group's label and hint. Owner groups reuse the dashboard's own wording (ui.bizComp.notifGroup).
export function groupTextKeys(g) {
  if (isOwnerGroup(g)) {
    const k = g.slice('owner_'.length);
    return { label: `ui.bizComp.notifGroup.${k}.label`, hint: `ui.bizComp.notifGroup.${k}.detail` };
  }
  return { label: `ui.notificationPrefs.group.${g}.label`, hint: `ui.notificationPrefs.group.${g}.hint` };
}
// Discover's two groups each derive their own older column.
export const LEGACY_COLUMN_GROUPS = {
  notify_planning: ['plans_invitations', 'plans_changes', 'plans_reminders'],
  notify_social: ['friends_activity', 'friends_occasions'],
  notify_dating: ['dating'],
  notify_business: ['business_offers', 'business_responses'],
  notify_discovery: ['discover_recommendations'],
  notify_proximity: ['discover_nearby_people'],
  notify_community: ['communities'],
};

export const NOTIFICATION_GROUPS = NOTIFICATION_AREAS.flatMap((a) => a.groups);

export const NOTIFICATION_GROUP_BY_TYPE = {
  // Plans > Invitations
  gathering_invite: 'plans_invitations', group_plan_invite: 'plans_invitations', occasion_group_plan_invite: 'plans_invitations',
  date_proposal: 'plans_invitations', experience_shared: 'plans_invitations',
  // Plans > Changes (to plans you are in or host: approvals, updates, cancellations, confirmations, offers on a group plan)
  gathering_approved: 'plans_changes', gathering_waitlisted: 'plans_changes', gathering_interest: 'plans_changes',
  gathering_updated: 'plans_changes', gathering_cancelled: 'plans_changes', date_proposal_response: 'plans_changes',
  plan_organizer_added: 'plans_changes', plan_confirmed: 'plans_changes', plan_reservation_cancelled: 'plans_changes',
  plan_cancelled: 'plans_changes', plan_addon_removed: 'plans_changes', plan_item_time_changed: 'plans_changes',
  group_plan_response: 'plans_changes', group_plan_confirmed: 'plans_changes', group_plan_offer_pending: 'plans_changes',
  group_plan_reservation_confirmed: 'plans_changes', group_plan_removed: 'plans_changes',
  social_offer_received: 'plans_changes', social_offer_responded: 'plans_changes',
  occasion_group_plan_decided: 'plans_changes', occasion_group_plan_voting_business: 'plans_changes',
  occasion_group_plan_stalled: 'plans_changes', occasion_group_plan_date_set: 'plans_changes',
  occasion_group_plan_cancelled: 'plans_changes', occasion_group_plan_guest_rsvp: 'plans_changes',
  occasion_surprise_revealed: 'plans_changes',
  // Plans > Reminders
  gathering_reminder: 'plans_reminders', gathering_business_reminder: 'plans_reminders', recurring_gathering: 'plans_reminders',
  // Friends
  friend_request: 'friends_activity', friend_accepted: 'friends_activity', friend_discovery_match: 'friends_activity',
  friend_joined_gathering: 'friends_activity', new_story: 'friends_activity', preference_poll_received: 'friends_activity',
  birthday: 'friends_occasions', birthday_upcoming: 'friends_occasions', anniversary_upcoming: 'friends_occasions',
  occasion_upcoming: 'friends_occasions',
  // Dating
  match: 'dating', new_match: 'dating', message: 'dating', wave: 'dating', video_call: 'dating', screenshot: 'dating',
  match_reminder: 'dating', playlist_addition: 'dating', trip_idea_addition: 'dating', shared_decision_addition: 'dating',
  constitution_addition: 'dating', memory_addition: 'dating', stress_test_addition: 'dating', timeline_addition: 'dating',
  // Businesses (as a customer)
  business_offer_received: 'business_offers', business_update: 'business_offers', business_recall_outreach: 'business_offers',
  business_offer_withdrawn: 'business_responses', business_offer_declined: 'business_responses',
  business_request_all_declined: 'business_responses', business_reservation_confirmed: 'business_responses',
  business_reservation_cancelled: 'business_responses', business_partnership_response: 'business_responses',
  // Discover
  recommended_gathering: 'discover_recommendations', recommended_business_availability: 'discover_recommendations',
  group_intent_signal: 'discover_recommendations', first_mission_reminder: 'discover_recommendations',
  momentum_streak_nudge: 'discover_recommendations', reward_tier_nudge: 'discover_recommendations',
  crossed_paths_sighting: 'discover_nearby_people',
  // Communities you lead
  community_area_demand_growing: 'communities', community_cancelled: 'communities',
  // Your business (to the business OWNER: managed_partner_id)
  business_opportunity_received: 'owner_requests', business_opportunities_digest: 'owner_requests',
  business_request_cancelled: 'owner_requests', business_request_expiring: 'owner_requests',
  business_offer_accepted: 'owner_offers', business_offer_review_result: 'owner_offers',
  reservation_cancelled_by_customer: 'owner_reservations',
  aggregated_demand_growing: 'owner_demand', occasion_demand_growing: 'owner_demand',
};

// Account notices to a business-partner applicant: never muted.
export const ACCOUNT_NOTICE_TYPES = ['business_partner_approved', 'business_partner_denied', 'business_partner_needs_info'];

export function notificationGroupOf(type) {
  return NOTIFICATION_GROUP_BY_TYPE[type] ?? null;
}

export function isMuted(type, mutes) {
  const g = notificationGroupOf(type);
  return !!g && Array.isArray(mutes) && mutes.includes(g);
}

// Onboarding asks per area (one switch each); an area turned off mutes all its groups. Older saved onboarding answers were
// keyed by the old columns (notify_planning: false ...); those are read too.
export const ONBOARDING_AREAS = NOTIFICATION_AREAS.filter((a) => a.key !== 'communities' && !a.ownerOnly);
export function mutesFromOnboardingChoices(choices) {
  const out = new Set();
  for (const [k, v] of Object.entries(choices ?? {})) {
    if (v !== false) continue;
    // Customer areas only: onboarding never asks about (or mutes) a business owner's alerts.
    const area = NOTIFICATION_AREAS.find((a) => a.key === k && !a.ownerOnly);
    for (const g of area?.groups ?? LEGACY_COLUMN_GROUPS[k] ?? []) out.add(g);
  }
  return NOTIFICATION_GROUPS.filter((g) => out.has(g));
}

export function toggleGroup(mutes, group, enabled) {
  const set = new Set(mutes ?? []);
  if (enabled) set.delete(group); else set.add(group);
  return NOTIFICATION_GROUPS.filter((g) => set.has(g));
}
