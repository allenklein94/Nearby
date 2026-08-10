import { supabase } from './supabase';

// Paginated, cursor-based fetch backing usePaginatedMessages — returns
// rows newest-first, capped at `limit`. Was previously an unconditional
// `getGatheringMessages()` fetch of the entire history, called on every
// load *and* re-called every 3 seconds by a poll (see the Aug 10 2026
// scalability audit) — this is the replacement for that unbounded query.
export async function getGatheringMessagesPage(gatheringId, { limit = 50, beforeCreatedAt = null } = {}) {
  let query = supabase
    .from('gathering_messages')
    .select('id, sender_id, body, created_at, profiles(display_name, photo_url)')
    .eq('gathering_id', gatheringId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (beforeCreatedAt) query = query.lt('created_at', beforeCreatedAt);

  const { data, error } = await query;
  if (error) {
    console.error('getGatheringMessagesPage error', error);
    return [];
  }
  return data ?? [];
}

// Single-row fetch (with the same profiles join getGatheringMessages already
// uses) for a realtime INSERT payload, which only carries raw table columns —
// used to append one new message without re-downloading the whole history.
export async function getGatheringMessageById(messageId) {
  const { data, error } = await supabase
    .from('gathering_messages')
    .select('id, sender_id, body, created_at, profiles(display_name, photo_url)')
    .eq('id', messageId)
    .single();

  if (error) {
    console.error('getGatheringMessageById error', error);
    return null;
  }
  return data;
}

export async function sendGatheringMessage(gatheringId, body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('gathering_messages')
    .insert({ gathering_id: gatheringId, sender_id: userId, body });

  if (error) throw error;
}