import { supabase } from './supabase';
// Owner item 18: the push's glyph per request (☕ / 🍽️ / 🍷 / the occasion's / ✨), requester only. A failed read = {}
// (the pill keeps ✨).
export async function fetchReplyGlyphs(requestIds) {
  const ids = [...new Set((requestIds ?? []).filter(Boolean))].slice(0, 20);
  if (ids.length === 0) return {};
  try {
    const { data, error } = await supabase.rpc('get_reply_glyphs', { request_ids_param: ids });
    if (error) return {};
    return Object.fromEntries((data ?? []).map((r) => [r.request_id, r.glyph]));
  } catch {
    return {};
  }
}
