import { supabase } from './supabase';

export async function getMyCircles() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data, error } = await supabase
    .from('friend_circles')
    .select('id, name, created_at, friend_circle_members(friend_user_id)')
    .eq('user_id', myId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getMyCircles error', error);
    return [];
  }

  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    memberIds: (c.friend_circle_members ?? []).map((m) => m.friend_user_id),
  }));
}

export async function createCircle(name) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;

  const { data, error } = await supabase
    .from('friend_circles')
    .insert({ user_id: myId, name })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteCircle(circleId) {
  const { error } = await supabase.from('friend_circles').delete().eq('id', circleId);
  if (error) throw error;
}

export async function addFriendToCircle(circleId, friendUserId) {
  const { error } = await supabase
    .from('friend_circle_members')
    .insert({ circle_id: circleId, friend_user_id: friendUserId });
  if (error && error.code !== '23505') throw error;
}

export async function removeFriendFromCircle(circleId, friendUserId) {
  const { error } = await supabase
    .from('friend_circle_members')
    .delete()
    .eq('circle_id', circleId)
    .eq('friend_user_id', friendUserId);
  if (error) throw error;
}
