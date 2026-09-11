import { supabase } from './supabase';

// Relationship-state audit (external UX critique item 32, 2026-09-11): the
// one canonical place to derive a real person's relationship to the
// viewer -- blocked (either direction), friendship status (accepted /
// pending_sent / pending_received / none), and whether a real matches row
// (and therefore a messaging channel) exists. This logic used to live only
// inline in ViewProfileScreen.js, the sole consumer, with nothing else in
// the codebase reusing it -- extracted so the next screen that needs
// relationship state has a real canonical function to call instead of
// reinventing (and possibly getting wrong) its own copy, which is exactly
// the failure mode item 32 asked to prevent.
export async function getRelationshipStatus(otherUserId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId || myId === otherUserId) {
    return { blocked: false, friendshipStatus: null, friendshipId: null, matchId: null };
  }

  const { data: blockedByMe } = await supabase
    .from('blocks')
    .select('id')
    .eq('blocker_id', myId)
    .eq('blocked_id', otherUserId)
    .maybeSingle();
  const { data: blockedMe } = await supabase
    .from('blocks')
    .select('id')
    .eq('blocker_id', otherUserId)
    .eq('blocked_id', myId)
    .maybeSingle();

  if (blockedByMe || blockedMe) {
    return { blocked: true, friendshipStatus: null, friendshipId: null, matchId: null };
  }

  const { data: friendship } = await supabase
    .from('friendships')
    .select('id, status, requested_by')
    .or(`and(user_a.eq.${myId},user_b.eq.${otherUserId}),and(user_a.eq.${otherUserId},user_b.eq.${myId})`)
    .maybeSingle();

  let friendshipStatus = null;
  let friendshipId = null;
  if (friendship?.status === 'accepted') {
    friendshipStatus = 'accepted';
    friendshipId = friendship.id;
  } else if (friendship?.status === 'pending') {
    friendshipStatus = friendship.requested_by === myId ? 'pending_sent' : 'pending_received';
    friendshipId = friendship.id;
  }

  // A "Message" action only ever makes sense when a real matches row
  // exists -- a plain accepted friendship has no messaging channel behind
  // it at all (respondToFriendRequest() never creates one directly; the
  // real messaging channel comes from on_friendship_accepted_create_match,
  // a DB trigger that inserts a real matches row the moment a friend
  // request is accepted).
  const { data: match } = await supabase
    .from('matches')
    .select('id')
    .or(`and(user_a.eq.${myId},user_b.eq.${otherUserId}),and(user_a.eq.${otherUserId},user_b.eq.${myId})`)
    .maybeSingle();

  return { blocked: false, friendshipStatus, friendshipId, matchId: match?.id ?? null };
}

export async function getMutualFriends(otherUserId) {
  const { data, error } = await supabase.rpc('get_mutual_friends', { other_user_id: otherUserId });
  if (error) {
    console.error('getMutualFriends error', error);
    return [];
  }
  return data ?? [];
}

export async function getSuggestedFriends() {
  const { data, error } = await supabase.rpc('get_suggested_friends');
  if (error) {
    console.error('getSuggestedFriends error', error);
    return [];
  }
  return data ?? [];
}

export async function sendFriendRequest(otherUserId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) throw new Error('Not signed in');
  if (myId === otherUserId) throw new Error("You can't add yourself as a friend.");

  const { data: blockedByMe } = await supabase
    .from('blocks')
    .select('id')
    .eq('blocker_id', myId)
    .eq('blocked_id', otherUserId)
    .maybeSingle();
  const { data: blockedMe } = await supabase
    .from('blocks')
    .select('id')
    .eq('blocker_id', otherUserId)
    .eq('blocked_id', myId)
    .maybeSingle();

  if (blockedByMe || blockedMe) {
    throw new Error("You can't send a friend request to this person.");
  }

  const userA = myId < otherUserId ? myId : otherUserId;
  const userB = myId < otherUserId ? otherUserId : myId;

  const { error } = await supabase
    .from('friendships')
    .insert({ user_a: userA, user_b: userB, status: 'pending', requested_by: myId });

  if (error) {
    if (error.code === '23505') throw new Error("You've already sent or received a friend request with this person.");
    throw error;
  }
}

export async function respondToFriendRequest(friendshipId, accept) {
  const { error } = await supabase
    .from('friendships')
    .update({ status: accept ? 'accepted' : 'declined' })
    .eq('id', friendshipId);
  if (error) throw error;
}

export async function getMyFriends() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data, error } = await supabase
    .from('friendships')
    .select('id, user_a, user_b, a:profiles!friendships_user_a_fkey(id, display_name, photo_url), b:profiles!friendships_user_b_fkey(id, display_name, photo_url)')
    .eq('status', 'accepted')
    .or(`user_a.eq.${myId},user_b.eq.${myId}`);

  if (error) {
    console.error('getMyFriends error', error);
    return [];
  }

  return (data ?? []).map((row) => {
    const friend = row.user_a === myId ? row.b : row.a;
    return { friendshipId: row.id, id: friend?.id, display_name: friend?.display_name, photo_url: friend?.photo_url };
  });
}

export async function getPendingFriendRequests() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data, error } = await supabase
    .from('friendships')
    .select('id, user_a, user_b, requested_by, a:profiles!friendships_user_a_fkey(id, display_name, photo_url), b:profiles!friendships_user_b_fkey(id, display_name, photo_url)')
    .eq('status', 'pending')
    .neq('requested_by', myId)
    .or(`user_a.eq.${myId},user_b.eq.${myId}`);

  if (error) {
    console.error('getPendingFriendRequests error', error);
    return [];
  }

  return (data ?? []).map((row) => {
    const requester = row.user_a === myId ? row.b : row.a;
    return { friendshipId: row.id, id: requester?.id, display_name: requester?.display_name, photo_url: requester?.photo_url };
  });
}

// Given a list of user IDs (e.g., everyone interested in a
// gathering), returns just the ones who are also the current
// person's accepted friends — used to show "3 friends are into this
// too" alongside a gathering.
export async function filterToMyFriends(userIds) {
  if (!userIds || userIds.length === 0) return [];
  const friends = await getMyFriends();
  const friendIds = new Set(friends.map((f) => f.id));
  return friends.filter((f) => userIds.includes(f.id));
}

// "The Plan Engine" Phase 1 (see CLAUDE.md, Aug 23 2026) -- an advance-notice
// birthday signal, distinct from the existing same-day "Birthday Today" push
// (which routes to ViewProfile). Real connected-set scoping (friends+matches)
// is enforced server-side by get_upcoming_connected_birthdays() itself, not
// re-derived here.
export async function getUpcomingConnectedBirthdays(daysAhead = 14) {
  const { data, error } = await supabase.rpc('get_upcoming_connected_birthdays', {
    days_ahead_param: daysAhead,
  });
  if (error) {
    console.error('getUpcomingConnectedBirthdays error', error);
    return [];
  }
  return data ?? [];
}