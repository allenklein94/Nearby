import { supabase } from './supabase';

export async function addMemoryItem(matchId, category, memoryText) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('memory_vault_items')
    .insert({ match_id: matchId, added_by: userId, category, memory_text: memoryText });

  if (error) throw error;
}

export async function getMyMatchesWithMemoryCounts() {
  // Memory Vault is per-match (memory_vault_items.match_id) — there's no
  // single "your" memory vault to deep-link Profile straight into, so this
  // is a real index over your matches instead, each with a real count,
  // mirroring how Timeline is reached from Profile as an aggregate view.
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, user_a, user_b, matched_at, a:profiles!matches_user_a_fkey(display_name, photo_url), b:profiles!matches_user_b_fkey(display_name, photo_url)')
    .order('matched_at', { ascending: false });

  if (error) {
    console.error('getMyMatchesWithMemoryCounts error', error);
    return [];
  }

  const withOther = (matches ?? []).map((m) => ({
    matchId: m.id,
    other: m.user_a === myId ? m.b : m.a,
  }));

  const counts = await Promise.all(
    withOther.map(async (m) => {
      const { count } = await supabase
        .from('memory_vault_items')
        .select('id', { count: 'exact', head: true })
        .eq('match_id', m.matchId);
      return [m.matchId, count ?? 0];
    })
  );
  const countMap = Object.fromEntries(counts);

  return withOther.map((m) => ({ ...m, memoryCount: countMap[m.matchId] ?? 0 }));
}

export async function getMemoryItems(matchId) {
  const { data, error } = await supabase
    .from('memory_vault_items')
    .select('*, profiles(display_name)')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getMemoryItems error', error);
    return [];
  }
  return data ?? [];
}