/**
 * CROSSED PATHS SIGNALS -- shared, PURE logic for the unified Crossed
 * Paths mechanism used by both Dating (services/proximity.js) and
 * Friends (services/friendDiscovery.js). See CLAUDE.md's locked design
 * (2026-09-10) for the full plan this implements.
 *
 * Deliberately has NO supabase/React Native import, unlike almost every
 * other service file in this codebase -- the same split already used
 * between intentResolver.js (I/O) and intentResolverScoring.js (pure),
 * and between experienceAssembly.js and its own callers. That split is
 * what lets this file be unit-tested directly under plain Node
 * (crossedPathsSignals.test.js) with no mocking. All real I/O -- the
 * sightings query, the get_shared_gathering_partners() RPC call, the
 * exclusion-set queries -- stays in proximity.js/friendDiscovery.js,
 * which both already import supabase.
 *
 * Signal priority (locked, never blended): a genuine shared-past-
 * gathering-attendance match always wins over a proximity sighting for
 * the same pair, even when both are real for that pair. Raw "N people
 * near you" with no explained reason is never shown.
 */

// Pure merge of the two real Crossed Paths signal sources into one
// candidate list, keyed by otherUserId.
//
// `sightings`: [{ otherUserId, last_seen_at, sightingId, sightingLat, sightingLng }]
// `gatheringPartners`: raw get_shared_gathering_partners() RPC rows --
//   [{ other_user_id, gathering_id, gathering_title, scheduled_at }]
//
// Returns: [{ otherUserId, last_seen_at, sightingId, sightingLat, sightingLng, crossedPathsReason }]
// where crossedPathsReason is either
//   { type: 'gathering', gatheringId, gatheringTitle, scheduledAt }
// or
//   { type: 'proximity', lastSeenAt }
export function mergeCrossedPathsSignals(sightings = [], gatheringPartners = []) {
  const byOtherUserId = new Map();

  for (const sighting of sightings) {
    if (!sighting?.otherUserId) continue;
    byOtherUserId.set(sighting.otherUserId, {
      otherUserId: sighting.otherUserId,
      last_seen_at: sighting.last_seen_at ?? null,
      sightingId: sighting.sightingId ?? null,
      sightingLat: sighting.sightingLat ?? null,
      sightingLng: sighting.sightingLng ?? null,
      crossedPathsReason: { type: 'proximity', lastSeenAt: sighting.last_seen_at ?? null },
    });
  }

  // Gathering attendance is checked second and always overwrites a
  // proximity-only entry for the same pair -- the PREFERRED explanation
  // when both are real, never blended into one generic line. It never
  // discards real sighting fields (last_seen_at/sightingId/lat/lng) that
  // an existing proximity entry already carried -- only the reason
  // shown to the user changes, callers that want the raw sighting data
  // (e.g. "View on map") still have it.
  for (const partner of gatheringPartners) {
    if (!partner?.other_user_id) continue;
    const existing = byOtherUserId.get(partner.other_user_id);
    byOtherUserId.set(partner.other_user_id, {
      otherUserId: partner.other_user_id,
      last_seen_at: existing?.last_seen_at ?? null,
      sightingId: existing?.sightingId ?? null,
      sightingLat: existing?.sightingLat ?? null,
      sightingLng: existing?.sightingLng ?? null,
      crossedPathsReason: {
        type: 'gathering',
        gatheringId: partner.gathering_id,
        gatheringTitle: partner.gathering_title,
        scheduledAt: partner.scheduled_at,
      },
    });
  }

  return Array.from(byOtherUserId.values());
}

// The fuller, list-view relative-time formatter (was duplicated in
// DiscoveryScreen.js) -- "3 hours ago (Sep 10, 2:14 PM)" style, no
// upper cutoff (falls back to an absolute date/time stamp past a week).
export function formatCrossedPathsTime(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  const diffMs = Date.now() - then.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  const dateTimeStamp = then.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ', ' + then.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  let relative;
  if (diffMins < 1) relative = 'Just now';
  else if (diffMins < 60) relative = `${diffMins} min${diffMins === 1 ? '' : 's'} ago`;
  else if (diffHours < 24) relative = `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  else if (diffDays === 1) relative = 'Yesterday';
  else if (diffDays < 7) relative = `${diffDays} days ago`;
  else relative = null;

  return relative ? `${relative} (${dateTimeStamp})` : dateTimeStamp;
}

// The shorter, swipe-card relative-time formatter (was duplicated in
// SwipeableDiscoveryCards.js) -- "Just now"/"N min ago"/"Nh ago", no
// room on a card for the fuller absolute-stamp fallback above, so
// anything past 24h just returns null (caller omits the time clause).
export function formatCrossedPathsTimeShort(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  const diffMins = Math.floor((Date.now() - then.getTime()) / (1000 * 60));
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return null;
}

// Reason-aware copy for the gathering-attendance explanation, shared by
// every render call site so "You were both at {title}" is worded
// identically everywhere. Proximity's own "📍 Within about 35 feet ..."
// copy stays inline at each call site -- it's Dating Crossed Paths' own
// long-standing exact wording, not worth abstracting further.
export function gatheringReasonText(reason, formatTime = formatCrossedPathsTimeShort) {
  if (!reason || reason.type !== 'gathering') return null;
  const time = formatTime(reason.scheduledAt);
  return `You were both at ${reason.gatheringTitle}${time ? ` · ${time}` : ''}`;
}

// Friend Discovery's own eligibility filter over a merged Crossed Paths
// candidate list -- mirrors get_friend_discovery_candidates()'s real
// exclusion rule (20260816_friend_discovery.sql): the candidate must be
// open to friend discovery, and must not be blocked (either direction),
// already connected in any way (any friendships row in any status --
// covers friends/pending/declined both directions -- or an existing
// dating match), or already swiped on. Callers precompute both sets
// from real queries (blocks, friendships, matches, friend_discovery_swipes,
// profiles.open_to_friend_discovery) -- this function only applies the
// resulting membership tests, kept pure so it can be unit tested without
// touching the database.
export function filterFriendCrossedPathsCandidates(candidates, {
  excludedUserIds = new Set(),
  openToFriendDiscoveryUserIds = new Set(),
} = {}) {
  return candidates.filter((c) => (
    !excludedUserIds.has(c.otherUserId) && openToFriendDiscoveryUserIds.has(c.otherUserId)
  ));
}
