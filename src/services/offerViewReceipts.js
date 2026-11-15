// The customer's own read receipt on a business reply (owner, 2026-11-15; 20270422).
// The receipt lives in business_offer_views, never on the offer row a business can read. Before 20270422 is live the
// table doesn't exist and the receipt is still business_request_offers.viewed_at, so every reader merges: the
// receipt row wins, else the offer row's own viewed_at (NULL once 20270422 is live). A failed receipt read keeps the
// rows as they are (never marks anything unviewed by mistake on the old database).
import { supabase } from './supabase';

export function mergeViewReceipts(rows, receipts) {
  const seen = new Map((receipts ?? []).filter((r) => r?.offer_id).map((r) => [r.offer_id, r.viewed_at ?? null]));
  return (rows ?? []).map((row) => {
    const receipt = row?.id ? seen.get(row.id) : undefined;
    return receipt ? { ...row, viewed_at: receipt } : row;
  });
}

export async function withViewReceipts(rows) {
  const ids = (rows ?? []).map((r) => r?.id).filter(Boolean);
  if (ids.length === 0) return rows ?? [];
  try {
    const { data, error } = await supabase.from('business_offer_views').select('offer_id, viewed_at').in('offer_id', ids);
    if (error) return rows;
    return mergeViewReceipts(rows, data);
  } catch {
    return rows;
  }
}

// Has the person opened at least one business reply on a request THEY made? null = unknown.
export async function hasOpenedAnyReply(userId) {
  if (!userId) return null;
  const receipt = await supabase
    .from('business_offer_views')
    .select('offer_id, business_request_offers!inner(business_requests!inner(requester_id))', { count: 'exact', head: true })
    .eq('business_request_offers.business_requests.requester_id', userId);
  if (!receipt.error && typeof receipt.count === 'number') {
    if (receipt.count > 0) return true;
  }
  // Before 20270422 (or a receipt read error): the offer row's own viewed_at.
  const legacy = await supabase
    .from('business_request_offers')
    .select('id, business_requests!inner(requester_id)', { count: 'exact', head: true })
    .not('viewed_at', 'is', null)
    .eq('business_requests.requester_id', userId);
  if (legacy.error || typeof legacy.count !== 'number') return receipt.error ? null : false;
  return legacy.count > 0;
}
