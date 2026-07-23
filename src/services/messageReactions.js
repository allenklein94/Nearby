import { supabase } from './supabase';

export async function toggleReaction(messageId, emoji) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data: existing } = await supabase
    .from('message_reactions')
    .select('id, emoji')
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing && existing.emoji === emoji) {
    const { error } = await supabase.from('message_reactions').delete().eq('id', existing.id);
    if (error) throw error;
    return null;
  }

  if (existing) {
    const { error } = await supabase.from('message_reactions').update({ emoji }).eq('id', existing.id);
    if (error) throw error;
    return emoji;
  }

  const { error } = await supabase.from('message_reactions').insert({ message_id: messageId, user_id: userId, emoji });
  if (error) throw error;
  return emoji;
}

export async function getReactionsForMatch(matchId) {
  const { data, error } = await supabase
    .from('message_reactions')
    .select('id, message_id, user_id, emoji, messages!inner(match_id)')
    .eq('messages.match_id', matchId);

  if (error) {
    console.error('getReactionsForMatch error', error);
    return [];
  }
  return data ?? [];
}