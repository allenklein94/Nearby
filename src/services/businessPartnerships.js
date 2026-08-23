import { supabase } from './supabase';

// A gathering host or community leader proposing a real business be
// officially tied to their specific event/community, with the business
// owner actually approving — distinct from services/invites.js (inviting a
// person) and BusinessPartnerApplyScreen's generic "onboard my business as
// an app-wide partner" application, which has no link to any specific
// gathering/community at all.

export async function getMyPartnershipTargets() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const [{ data: gatherings }, { data: memberRows }] = await Promise.all([
    supabase
      .from('gatherings')
      .select('id, title, scheduled_at')
      .eq('host_id', myId)
      .gte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true }),
    supabase
      .from('community_members')
      .select('role, communities(id, name)')
      .eq('user_id', myId)
      .in('role', ['creator', 'leader']),
  ]);

  const gatheringTargets = (gatherings ?? []).map((g) => ({ type: 'gathering', id: g.id, title: g.title, subtitle: new Date(g.scheduled_at).toLocaleDateString() }));
  const communityTargets = (memberRows ?? [])
    .filter((row) => row.communities)
    .map((row) => ({ type: 'community', id: row.communities.id, title: row.communities.name, subtitle: 'Community' }));

  return [...gatheringTargets, ...communityTargets];
}

export async function requestBusinessPartnership({ targetType, targetId, partnerId, message = null }) {
  const { error } = await supabase.rpc('request_business_partnership', {
    target_type_param: targetType,
    target_id_param: targetId,
    partner_id_param: partnerId,
    message_param: message,
  });
  if (error) throw error;
}

// "Find a Business for This Plan" merge (locked directly by the user,
// CLAUDE.md) -- the most recent real request the caller has made for this
// specific target, regardless of status. A 'declined' row is deliberately
// still returned (not filtered out) so the caller can decide how to treat
// it -- GatheringDetailScreen's own host banner treats anything other than
// 'pending'/'approved' as "no active progress," letting the host try again
// through the same merged entry point rather than being permanently stuck.
export async function getMyPartnershipRequestForTarget(targetType, targetId) {
  const { data, error } = await supabase
    .from('business_partnership_requests')
    .select('id, status, created_at, brand_partners(name)')
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('getMyPartnershipRequestForTarget error', error);
    return null;
  }
  if (!data) return null;
  return { id: data.id, status: data.status, partnerName: data.brand_partners?.name ?? 'a local business' };
}

export async function respondToBusinessPartnershipRequest(requestId, approve) {
  const { error } = await supabase.rpc('respond_to_business_partnership_request', {
    request_id_param: requestId,
    approve,
  });
  if (error) throw error;
}

// Titles aren't denormalized onto business_partnership_requests, so this
// resolves them in two batched follow-up queries, same shape as
// getMyReceivedInvites() in services/invites.js.
export async function getPendingPartnershipRequestsForPartner(partnerId) {
  const { data, error } = await supabase
    .from('business_partnership_requests')
    .select('id, target_type, target_id, message, created_at, requester:profiles!business_partnership_requests_requester_id_fkey(id, display_name, photo_url)')
    .eq('partner_id', partnerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getPendingPartnershipRequestsForPartner error', error);
    return [];
  }

  const requests = data ?? [];
  const gatheringIds = requests.filter((r) => r.target_type === 'gathering').map((r) => r.target_id);
  const communityIds = requests.filter((r) => r.target_type === 'community').map((r) => r.target_id);

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

  return requests.map((r) => ({
    id: r.id,
    targetType: r.target_type,
    targetId: r.target_id,
    message: r.message,
    createdAt: r.created_at,
    requesterName: r.requester?.display_name,
    requesterPhotoUrl: r.requester?.photo_url,
    targetTitle: r.target_type === 'gathering' ? gatheringTitles[r.target_id] : communityNames[r.target_id],
  }));
}
