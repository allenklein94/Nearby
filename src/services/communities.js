import { supabase } from './supabase';
import { filterToMyFriends } from './friends';
import { sendInvite } from './invites';

// "Start a Community from This Gathering" — a real invite-based spinoff, not
// auto-membership. community_members' own INSERT policy only ever allows
// user_id = auth.uid() (self-insert), so there's no way to add someone as a
// member without their own consent even as the community's creator; this
// goes through the exact same social_invites path every other community
// invite already uses, including its real friendship + blocks checks. A
// gathering attendee who isn't a real friend of the host is never invited
// here — sendInvite would just reject it, so we pre-filter instead of
// attempting (and silently swallowing) an invite that can't succeed.
export async function seedCommunityFromGathering(communityId, gatheringId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;

  const { data: attendeeRows, error } = await supabase
    .from('gathering_interest')
    .select('user_id')
    .eq('gathering_id', gatheringId)
    .eq('status', 'approved');

  if (error) {
    console.error('seedCommunityFromGathering error', error);
    return { invitedCount: 0, totalAttendeeCount: 0 };
  }

  const attendeeIds = (attendeeRows ?? []).map((r) => r.user_id).filter((id) => id !== myId);
  if (attendeeIds.length === 0) return { invitedCount: 0, totalAttendeeCount: 0 };

  const friendsAmongAttendees = await filterToMyFriends(attendeeIds);
  const results = await Promise.allSettled(
    friendsAmongAttendees.map((f) => sendInvite('community', communityId, f.id))
  );
  const invitedCount = results.filter((r) => r.status === 'fulfilled').length;

  return { invitedCount, totalAttendeeCount: attendeeIds.length };
}

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

// Scalability audit step 7: was unbounded, downloading every public
// community in the app on every browse. A plain cap is the right-sized fix
// here (per the audit's own locked decision 5) -- communities have no
// location column to bound geographically, so there's no distance-based
// RPC to build, just a Postgres-side LIMIT on top of the existing query.
export async function getPublicCommunities() {
  const { data, error } = await supabase
    .from('communities')
    .select(PUBLIC_COMMUNITY_SELECT)
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('getPublicCommunities error', error);
    return [];
  }
  return data ?? [];
}

const PUBLIC_COMMUNITY_SELECT = 'id, name, description, interest_tag, is_public, cover_photo_url, creator_id, hosting_partner_id';

// Real, indexed, server-side search — used by DiscoverHubScreen's search box
// instead of downloading every public community and filtering client-side.
// Backed by the trigram GIN indexes added in 20260809_indexed_text_search.sql.
// Base filter (is_public = true) matches getPublicCommunities() exactly, so
// search can never surface a private community the caller isn't a member of.
export async function searchPublicCommunities(queryText) {
  const term = (queryText ?? '').trim();
  if (!term) return [];
  const escaped = term.replace(/[%_]/g, '\\$&');

  const baseQuery = () => supabase
    .from('communities')
    .select(PUBLIC_COMMUNITY_SELECT)
    .eq('is_public', true);

  const [nameRes, descriptionRes] = await Promise.all([
    baseQuery().ilike('name', `%${escaped}%`),
    baseQuery().ilike('description', `%${escaped}%`),
  ]);
  if (nameRes.error) console.error('searchPublicCommunities name error', nameRes.error);
  if (descriptionRes.error) console.error('searchPublicCommunities description error', descriptionRes.error);

  const byId = new Map();
  for (const row of [...(nameRes.data ?? []), ...(descriptionRes.data ?? [])]) byId.set(row.id, row);
  return [...byId.values()];
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

// Paginated, cursor-based fetch backing usePaginatedMessages — returns
// rows newest-first, capped at `limit`. Was previously an unconditional
// `getCommunityMessages()` fetch of the entire history, called on every
// load *and* re-called every 3 seconds by a poll (see the Aug 10 2026
// scalability audit) — this is the replacement for that unbounded query.
export async function getCommunityMessagesPage(communityId, { limit = 50, beforeCreatedAt = null } = {}) {
  let query = supabase
    .from('community_messages')
    .select('id, sender_id, body, created_at, profiles(display_name, photo_url)')
    .eq('community_id', communityId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (beforeCreatedAt) query = query.lt('created_at', beforeCreatedAt);

  const { data, error } = await query;
  if (error) {
    // Was swallowed into an empty array -- indistinguishable from a
    // genuinely empty/exhausted conversation to usePaginatedMessages, the
    // caller. Throw so the hook's own try/catch can surface a real error
    // state instead of a silent, misleading "nothing here."
    console.error('getCommunityMessagesPage error', error);
    throw error;
  }
  return data ?? [];
}

// Single-row fetch (with the same profiles join getCommunityMessages already
// uses) for a realtime INSERT payload, which only carries raw table columns —
// used to append one new message without re-downloading the whole history.
export async function getCommunityMessageById(messageId) {
  const { data, error } = await supabase
    .from('community_messages')
    .select('id, sender_id, body, created_at, profiles(display_name, photo_url)')
    .eq('id', messageId)
    .single();

  if (error) {
    console.error('getCommunityMessageById error', error);
    return null;
  }
  return data;
}

export async function sendCommunityMessage(communityId, body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('community_messages')
    .insert({ community_id: communityId, sender_id: myId, body });

  if (error) throw error;
}

export async function getCommunityMembers(communityId) {
  // RLS on community_members only shows the full roster for public
  // communities or to the community's own creator — anyone else viewing a
  // private community only sees their own row. That's a real privacy
  // constraint from the schema, not a bug in this function.
  //
  // Scalability audit step 8: was unbounded. Same plain-cap treatment as
  // getPublicCommunities() (locked decision 6) — no "load more" UI exists
  // or is demanded today, so a cap alone closes the unbounded-download
  // risk without building pagination UI nothing currently needs.
  const { data, error } = await supabase
    .from('community_members')
    .select('user_id, role, joined_at, profiles(display_name, photo_url)')
    .eq('community_id', communityId)
    .order('joined_at', { ascending: true })
    .limit(200);

  if (error) {
    console.error('getCommunityMembers error', error);
    return [];
  }
  return data ?? [];
}

export async function setCommunityMemberRole(communityId, memberUserId, role) {
  const { error } = await supabase.rpc('set_community_member_role', {
    community_id_param: communityId,
    member_id_param: memberUserId,
    new_role: role,
  });
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