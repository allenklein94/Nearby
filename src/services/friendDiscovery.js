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
