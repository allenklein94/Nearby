import { supabase } from './supabase';

// Share a gathering into a one-to-one chat (owner decision 2026-10-20, idea "244" follow-up). The ONE write path is
// share_gathering_in_chat (migration 20270331): the server checks the caller is in that chat (not blocked) and may see the
// gathering; only the person's own tap on GatheringDetail's "Share in a chat" calls it, never anything automatic.

// The person's one-to-one chats (the same matches rows Messages lists), newest first: [{ matchId, name }].
export async function getMyOneToOneChats() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];
  const { data, error } = await supabase
    .from('matches')
    .select('id, user_a, user_b, matched_at, a:profiles!matches_user_a_fkey(id, display_name), b:profiles!matches_user_b_fkey(id, display_name)')
    .or(`user_a.eq.${myId},user_b.eq.${myId}`)
    .order('matched_at', { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .map((m) => ({ matchId: m.id, name: (m.user_a === myId ? m.b : m.a)?.display_name ?? null }))
    .filter((c) => c.name);
}

export async function shareGatheringInChat(matchId, gatheringId) {
  const { data, error } = await supabase.rpc('share_gathering_in_chat', { match_id_param: matchId, gathering_id_param: gatheringId });
  if (error) throw error;
  return data;
}

// What a shared-gathering card shows, read through the recipient's OWN gatherings read (the item 147 policy): a gathering
// they may not see, or one since deleted, comes back as null and the card says it isn't available. Never a second reader.
export async function getSharedGatheringCard(gatheringId) {
  const { data, error } = await supabase
    .from('gatherings')
    .select('id, title, scheduled_at, duration_minutes')
    .eq('id', gatheringId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}
