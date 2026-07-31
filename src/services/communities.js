import { supabase } from './supabase';

export async function getBusinessCommunities(partnerId) {
  const { data, error } = await supabase
    .from('communities')
    .select('id, name, description')
    .eq('hosting_partner_id', partnerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getBusinessCommunities error', error);
    return [];
  }

  const withCounts = await Promise.all(
    (data ?? []).map(async (c) => {
      const count = await getCommunityMemberCount(c.id);
      return { ...c, memberCount: count };
    })
  );
  return withCounts;
}

export async function createCommunity({ name, description, interestTag, isPublic = true }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const creatorId = sessionData?.session?.user?.id;

  const { data, error } = await supabase
    .from('communities')
    .insert({ name, description, interest_tag: interestTag, is_public: isPublic, creator_id: creatorId })
    .select()
    .single();

  if (error) throw error;

  // Creating a community automatically makes you its first member
  await supabase.from('community_members').insert({ community_id: data.id, user_id: creatorId, role: 'creator' });

  return data;
}

export async function getMyCommunities() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data, error } = await supabase
    .from('community_members')
    .select('community_id, role, communities(id, name, description, interest_tag, is_public, cover_photo_url, creator_id, hosting_partner_id)')
    .eq('user_id', myId);

  if (error) {
    console.error('getMyCommunities error', error);
    return [];
  }
  return (data ?? []).filter((row) => row.communities).map((row) => ({ ...row.communities, myRole: row.role }));
}

export async function getPublicCommunities() {
  const { data, error } = await supabase
    .from('communities')
    .select('id, name, description, interest_tag, is_public, cover_photo_url, creator_id, hosting_partner_id')
    .eq('is_public', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getPublicCommunities error', error);
    return [];
  }
  return data ?? [];
}

export async function getCommunityMemberCount(communityId) {
  const { count, error } = await supabase
    .from('community_members')
    .select('id', { count: 'exact', head: true })
    .eq('community_id', communityId);

  if (error) return 0;
  return count ?? 0;
}

export async function joinCommunity(communityId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('community_members')
    .insert({ community_id: communityId, user_id: myId, role: 'member' });

  if (error) {
    if (error.code === '23505') return; // already a member, fine
    throw error;
  }
}

export async function leaveCommunity(communityId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('community_members')
    .delete()
    .eq('community_id', communityId)
    .eq('user_id', myId);

  if (error) throw error;
}

export async function getCommunityMessages(communityId) {
  const { data, error } = await supabase
    .from('community_messages')
    .select('id, sender_id, body, created_at, profiles(display_name, photo_url)')
    .eq('community_id', communityId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getCommunityMessages error', error);
    return [];
  }
  return data ?? [];
}

export async function sendCommunityMessage(communityId, body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('community_messages')
    .insert({ community_id: communityId, sender_id: myId, body });

  if (error) throw error;
}

export async function getCommunityGatherings(communityId) {
  const { data, error } = await supabase
    .from('gatherings')
    .select('id, title, description, interest_tag, scheduled_at, host_id')
    .eq('community_id', communityId)
    .order('scheduled_at', { ascending: true });

  if (error) {
    console.error('getCommunityGatherings error', error);
    return [];
  }
  return data ?? [];
}