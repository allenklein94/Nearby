import { supabase } from './supabase';

// "Invite people" — the biggest confirmed gap from the Aug 7 2026 vision-doc
// feedback: no way to invite a specific person to a gathering or community
// anywhere. Not to be confused with InviteFriendsScreen.js (`InviteFriends`
// route) — that's an app-referral-code screen, a different feature.
export async function sendInvite(inviteType, targetId, inviteeId) {
  const { error } = await supabase.rpc('send_social_invite', {
    invite_type_param: inviteType,
    target_id_param: targetId,
    invitee_id_param: inviteeId,
  });
  if (error) throw error;
}

export async function respondToInvite(inviteId, accept) {
  const { error } = await supabase.rpc('respond_to_social_invite', {
    invite_id_param: inviteId,
    accept,
  });
  if (error) throw error;
}

// Real target titles aren't stored on social_invites itself (a plain
// polymorphic FK, not a denormalized copy), so this fetches them in two
// batched follow-up queries rather than one row-by-row lookup per invite.
export async function getMyReceivedInvites() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data, error } = await supabase
    .from('social_invites')
    .select('id, invite_type, target_id, created_at, inviter:profiles!social_invites_inviter_id_fkey(id, display_name, photo_url)')
    .eq('invitee_id', myId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getMyReceivedInvites error', error);
    return [];
  }

  const invites = data ?? [];
  const gatheringIds = invites.filter((i) => i.invite_type === 'gathering').map((i) => i.target_id);
  const communityIds = invites.filter((i) => i.invite_type === 'community').map((i) => i.target_id);

  const [gatherings, communities] = await Promise.all([
    gatheringIds.length
      ? supabase.from('gatherings').select('id, title').in('id', gatheringIds).then((r) => r.data ?? [])
      : Promise.resolve([]),
    communityIds.length
      ? supabase.from('communities').select('id, name').in('id', communityIds).then((r) => r.data ?? [])
      : Promise.resolve([]),
  ]);
  const gatheringTitles = Object.fromEntries(gatherings.map((g) => [g.id, g.title]));
  const communityNames = Object.fromEntries(communities.map((c) => [c.id, c.name]));

  return invites.map((i) => ({
    id: i.id,
    inviteType: i.invite_type,
    targetId: i.target_id,
    createdAt: i.created_at,
    inviterName: i.inviter?.display_name,
    inviterPhotoUrl: i.inviter?.photo_url,
    targetTitle: i.invite_type === 'gathering' ? gatheringTitles[i.target_id] : communityNames[i.target_id],
  }));
}
