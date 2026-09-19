// Item 110 (CLAUDE.md, "distinguish Important (relationship/contextual)
// from Recommendation (discovery)... that distinction will make your
// notifications feel much less spammy"): a real tier classification for
// every push type this app actually sends, mirroring the exact vocabulary
// notifications.js's own routeNotificationTap() switch already enumerates
// (this file's own Jest test reads that switch's real case labels and
// asserts every one of them is classified here, and vice versa, so the two
// can never silently drift the way several other duplicated vocabularies in
// this codebase already have).
//
// 'important' = relationship/contextual -- about a specific person, a real
// commitment, or something the recipient already actively did/started.
// Delivered at normal priority with sound, same as every push has always
// behaved.
// 'recommendation' = discovery -- an algorithmic "you might like this"
// surfacing of something the recipient hasn't engaged with yet (interest-
// matched gatherings/business postings, aggregated demand signals,
// engagement/gamification nudges). Delivered quietly (low priority, no
// sound, Android LOW-importance channel) so it doesn't compete for
// attention the way a real relationship/commitment update should.
//
// An unrecognized/future type defaults to 'important' -- failing toward
// "deliver it normally" rather than silently muting a brand-new push type
// nobody has classified yet, matching this repo's own no-dead-ends/
// fail-safe discipline.
const RECOMMENDATION_TYPES = new Set([
  'recommended_gathering',
  'recommended_business_availability',
  'first_mission_reminder',
  'momentum_streak_nudge',
  'reward_tier_nudge',
  'business_opportunity_received',
  'business_opportunities_digest',
  'aggregated_demand_growing',
  'occasion_demand_growing',
  'community_area_demand_growing',
  'group_intent_signal',
]);

export function notificationTier(type) {
  return RECOMMENDATION_TYPES.has(type) ? 'recommendation' : 'important';
}

// Exported for notificationTier.test.js's own drift-guard test only (to
// confirm every classified type still exists as a real switch case in
// notifications.js) -- not meant for other callers, which should always go
// through notificationTier() itself.
export const RECOMMENDATION_TYPES_FOR_TEST = RECOMMENDATION_TYPES;

export const ANDROID_NOTIFICATION_CHANNELS = {
  important: 'important-alerts',
  recommendation: 'recommendations',
};
