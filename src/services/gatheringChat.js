import { supabase } from './supabase';

export async function getGatheringMessages(gatheringId) {
  const { data, error } = await supabase
    .from('gathering_messages')
    .select('id, sender_id, body, created_at, profiles(display_name, photo_url)')
    .eq('gathering_id', gatheringId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getGatheringMessages error', error);
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