import { supabase } from './supabase';

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