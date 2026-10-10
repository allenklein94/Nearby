// Network edges of the offer arrival signal (services/offerArrivals.js decides; this only reads).
import { supabase } from './supabase';

// The person's live replies: offers in status 'offered' on requests THEY made. RLS also lets match partners, group-plan
// participants and plan organizers read offers, but the signal is only for the requester ("your request").
export async function fetchMyLiveReplies(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('business_request_offers')
    .select('id, request_id, partner_id, status, viewed_at, offer_type, offer_title, offer_price, discount_pct, included_items, brand_partners(name), business_requests!inner(requester_id, status)')
    .eq('status', 'offered')
    .eq('business_requests.requester_id', userId)
    .eq('business_requests.status', 'open');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    ...r,
    partner_name: r.brand_partners?.name ?? null,
    request_status: r.business_requests?.status ?? null,
  }));
}

// The person's reply history, from the server (the same on every device, after a reinstall or a new phone):
//   seenAny          they have opened at least one business reply on their own requests (viewed_at, set once by
//                    mark_business_offer_viewed, the requester's own read receipt)
//   earliestReplyId  the first reply any business ever sent them (responded_at; a decline is not counted as a reply)
// Returns null when either read fails, so the caller shows the normal wording.
export async function fetchFirstReplyState(userId) {
  if (!userId) return null;
  try {
    const [seen, earliest] = await Promise.all([
      supabase
        .from('business_request_offers')
        .select('id, business_requests!inner(requester_id)', { count: 'exact', head: true })
        .not('viewed_at', 'is', null)
        .eq('business_requests.requester_id', userId),
      supabase
        .from('business_request_offers')
        .select('id, responded_at, business_requests!inner(requester_id)')
        .eq('business_requests.requester_id', userId)
        .not('responded_at', 'is', null)
        .neq('status', 'declined')
        .order('responded_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(1),
    ]);
    if (seen.error || earliest.error || typeof seen.count !== 'number') return null;
    return { seenAny: seen.count > 0, earliestReplyId: earliest.data?.[0]?.id ?? null };
  } catch {
    return null;
  }
}

// Any change to an offer row the person may read (RLS decides who receives it). The payload is dropped and never read:
// an event only means "look again" (fetchMyLiveReplies), same pattern as the host's message count.
export function subscribeToOfferChanges(userId, onChange) {
  const channel = supabase
    .channel(`offer_arrivals:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'business_request_offers' }, () => onChange())
    .subscribe();
  return () => supabase.removeChannel(channel);
}
