/**
 * FRIEND DISCOVERY
 *
 * An explicit, opt-in "swipe to meet new people looking to make friends"
 * surface -- completely separate from dating discovery (services/proximity.js):
 * its own opt-in toggle, its own table, its own candidate pool, its own RPCs.
 * Deliberately never referenced by the intent resolver (services/intentResolver.js)
 * -- friend discovery is a real, explicitly opt-in stranger-facing surface,
 * not the "trusted network only" pool the resolver's own no-stranger-discovery
 * rule governs.
 *
 * See CLAUDE.md's "Friend Discovery" plan section for the full locked design
 * (candidate exclusion rules, the mutual-swipe -> friendship + chat flow).
 */

import { supabase } from './supabase';
import { mergeCrossedPathsSignals, filterFriendCrossedPathsCandidates } from './crossedPathsSignals';

export async function isOpenToFriendDiscovery() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return false;

  const { data, error } = await supabase
    .from('profiles')
    .select('open_to_friend_discovery')
    .eq('id', myId)
    .single();

  if (error) {
    console.error('isOpenToFriendDiscovery error', error);
    return false;
  }
  return !!data?.open_to_friend_discovery;
}

export async function setOpenToFriendDiscovery(enabled) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) throw new Error('Not signed in');

  const { error } = await supabase
    .from('profiles')
    .update({ open_to_friend_discovery: enabled })
    .eq('id', myId);

  if (error) throw error;
}

// Unified Crossed Paths, step 4 (CLAUDE.md, 2026-09-10): Friends' own
// Crossed Paths pool -- the same merged sightings+shared-gatherings
// union getNearbyMatches() (proximity.js) uses, but with Friend
// Discovery's own real exclusion set instead of Dating's, mirroring
// get_friend_discovery_candidates()'s own rule exactly (see
// 20260816_friend_discovery.sql): candidate must be open to friend
// discovery, and not blocked (either direction), not already connected
// (any friendships row in any status, either direction, or an existing
// dating match), and not already swiped on. Distance is deliberately
// never computed here (unlike Browse's own RPC-side haversine calc) --
// this pool comes from real proximity/gathering signals, not the
// wide_area grid, so a distance_bucket would have to be invented; every
// candidate here always carries a real crossedPathsReason instead.
export async function getFriendCrossedPaths() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data: myProfile } = await supabase
    .from('profiles')
    .select('open_to_friend_discovery, interests')
    .eq('id', myId)
    .single();

  if (!myProfile?.open_to_friend_discovery) return [];
  const myInterests = myProfile.interests ?? [];

  const { data: sightings, error } = await supabase
    .from('sightings')
    .select('id, user_a, user_b, last_seen_at')
    .or(`user_a.eq.${myId},user_b.eq.${myId}`);
  if (error) {
    console.error('getFriendCrossedPaths sightings error', error);
    return [];
  }

  const { data: gatheringPartners, error: gatheringError } = await supabase.rpc('get_shared_gathering_partners');
  if (gatheringError) {
    console.error('getFriendCrossedPaths get_shared_gathering_partners error', gatheringError);
  }

  const sightingSignals = (sightings ?? []).map((s) => ({
    otherUserId: s.user_a === myId ? s.user_b : s.user_a,
    last_seen_at: s.last_seen_at,
    sightingId: s.id,
  }));
  const merged = mergeCrossedPathsSignals(sightingSignals, gatheringPartners ?? []);
  if (merged.length === 0) return [];

  const candidateIds = merged.map((m) => m.otherUserId);

  const [{ data: blockedByMe }, { data: blockedMe }, { data: friendshipRows }, { data: matchRows }, { data: swipeRows }, { data: candidateProfiles }] = await Promise.all([
    supabase.from('blocks').select('blocked_id').eq('blocker_id', myId),
    supabase.from('blocks').select('blocker_id').eq('blocked_id', myId),
    supabase.from('friendships').select('user_a, user_b').or(`user_a.eq.${myId},user_b.eq.${myId}`),
    supabase.from('matches').select('user_a, user_b').or(`user_a.eq.${myId},user_b.eq.${myId}`),
    supabase.from('friend_discovery_swipes').select('to_user').eq('from_user', myId),
    supabase.from('profiles').select('id, display_name, photo_url, bio, interests, photo_verified, open_to_friend_discovery').in('id', candidateIds),
  ]);

  const excludedUserIds = new Set([
    ...(blockedByMe ?? []).map((b) => b.blocked_id),
    ...(blockedMe ?? []).map((b) => b.blocker_id),
    ...(friendshipRows ?? []).map((f) => (f.user_a === myId ? f.user_b : f.user_a)),
    ...(matchRows ?? []).map((m) => (m.user_a === myId ? m.user_b : m.user_a)),
    ...(swipeRows ?? []).map((s) => s.to_user),
  ]);

  const openToFriendDiscoveryUserIds = new Set(
    (candidateProfiles ?? []).filter((p) => p.open_to_friend_discovery).map((p) => p.id)
  );

  const eligible = filterFriendCrossedPathsCandidates(merged, { excludedUserIds, openToFriendDiscoveryUserIds });
  if (eligible.length === 0) return [];

  const profileById = Object.fromEntries((candidateProfiles ?? []).map((p) => [p.id, p]));
  const eligibleIds = eligible.map((m) => m.otherUserId);

  const [{ data: myCommunities }, { data: candidateCommunities }, { data: myFriendRows }, { data: candidateFriendRows }] = await Promise.all([
    supabase.from('community_members').select('community_id').eq('user_id', myId),
    supabase.from('community_members').select('user_id, community_id').in('user_id', eligibleIds),
    supabase.from('friendships').select('user_a, user_b').eq('status', 'accepted').or(`user_a.eq.${myId},user_b.eq.${myId}`),
    supabase.from('friendships').select('user_a, user_b').eq('status', 'accepted').or(`user_a.in.(${eligibleIds.join(',')}),user_b.in.(${eligibleIds.join(',')})`),
  ]);

  const myCommunityIds = new Set((myCommunities ?? []).map((c) => c.community_id));
  const myFriendIds = new Set((myFriendRows ?? []).map((f) => (f.user_a === myId ? f.user_b : f.user_a)));

  const sharedCommunityCountByUser = {};
  for (const row of candidateCommunities ?? []) {
    if (myCommunityIds.has(row.community_id)) {
      sharedCommunityCountByUser[row.user_id] = (sharedCommunityCountByUser[row.user_id] ?? 0) + 1;
    }
  }

  const mutualFriendCountByUser = {};
  const eligibleIdSet = new Set(eligibleIds);
  for (const row of candidateFriendRows ?? []) {
    const candidateSide = eligibleIdSet.has(row.user_a) ? row.user_a : (eligibleIdSet.has(row.user_b) ? row.user_b : null);
    if (!candidateSide) continue;
    const friendSide = candidateSide === row.user_a ? row.user_b : row.user_a;
    if (friendSide !== myId && myFriendIds.has(friendSide)) {
      mutualFriendCountByUser[candidateSide] = (mutualFriendCountByUser[candidateSide] ?? 0) + 1;
    }
  }

  return eligible
    .map((m) => {
      const profile = profileById[m.otherUserId];
      if (!profile) return null;
      const sharedInterestCount = (profile.interests ?? []).filter((i) => myInterests.includes(i)).length;
      return {
        id: profile.id,
        display_name: profile.display_name,
        photo_url: profile.photo_url,
        bio: profile.bio,
        interests: profile.interests ?? [],
        photo_verified: profile.photo_verified,
        shared_interest_count: sharedInterestCount,
        shared_community_count: sharedCommunityCountByUser[m.otherUserId] ?? 0,
        mutual_friend_count: mutualFriendCountByUser[m.otherUserId] ?? 0,
        distance_bucket: null,
        last_seen_at: m.last_seen_at,
        crossedPathsReason: m.crossedPathsReason,
      };
    })
    .filter(Boolean);
}

export async function getFriendDiscoveryCandidates(limit = 20) {
  const { data, error } = await supabase.rpc('get_friend_discovery_candidates', { limit_param: limit });
  if (error) {
    console.error('getFriendDiscoveryCandidates error', error);
    return [];
  }
  return data ?? [];
}

// direction is 'like' | 'pass'. Returns { isMutualMatch, matchId }.
export async function recordFriendDiscoverySwipe(targetUserId, direction) {
  const { data, error } = await supabase.rpc('record_friend_discovery_swipe', {
    target_user_id: targetUserId,
    direction_param: direction,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  return {
    isMutualMatch: !!row?.is_mutual_match,
    matchId: row?.match_id ?? null,
  };
}
