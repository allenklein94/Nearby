// Network edges of the offer arrival signal (services/offerArrivals.js decides; this only reads).
import { supabase } from './supabase';

// The person's live replies: offers in status 'offered' on requests THEY made. RLS also lets match partners, group-plan
// participants and plan organizers read offers, but the signal is only for the requester ("your request").
export async function fetchMyLiveReplies(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('business_request_offers')
    .select('id, request_id, status, viewed_at, offer_type, offer_title, offer_price, discount_pct, included_items, brand_partners(name), business_requests!inner(requester_id, status)')
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

// Any change to an offer row the person may read (RLS decides who receives it). The payload is dropped and never read:
// an event only means "look again" (fetchMyLiveReplies), same pattern as the host's message count.
export function subscribeToOfferChanges(userId, onChange) {
  const channel = supabase
    .channel(`offer_arrivals:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'business_request_offers' }, () => onChange())
    .subscribe();
  return () => supabase.removeChannel(channel);
}
