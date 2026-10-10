import { supabase } from './supabase';

// Owner item 16 (2026-10-10, LOCKED): which businesses are responding to this request RIGHT NOW = a reply they sent is
// being checked (business_offer_submissions 'reviewing', under the 3-minute stall boundary, request open). Requester only;
// the server decides, a failed read = nobody shown (never a guess). Each row carries `stale_at`, the moment the server would
// stop calling it in progress, so the screen can re-read then instead of showing a stalled check forever.
export async function getRespondingBusinesses(requestId) {
  if (!requestId) return [];
  try {
    const { data, error } = await supabase.rpc('get_responding_businesses', { request_id_param: requestId });
    if (error) return [];
    return (data ?? []).map((r) => ({ partnerId: r.partner_id, name: r.name, staleAt: r.stale_at }));
  } catch {
    return [];
  }
}

// A submission for this request changed (sent, checked, held, refused, published). Requester RLS decides who hears it; the
// event itself carries only the request id and is never read: the caller re-reads getRespondingBusinesses.
export function subscribeToRespondingChanges(requestId, onChange) {
  const channel = supabase
    .channel(`request_responding:${requestId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'request_responding_pings', filter: `request_id=eq.${requestId}` }, () => onChange())
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// When to re-read so a stalled check stops showing: the earliest stale_at, or null when nothing is in flight.
export function nextRespondingCheckMs(rows, now = Date.now()) {
  const times = (rows ?? []).map((r) => new Date(r.staleAt).getTime()).filter(Number.isFinite);
  if (times.length === 0) return null;
  return Math.max(0, Math.min(...times) - now) + 250;
}
