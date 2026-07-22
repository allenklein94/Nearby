import { supabase } from './supabase';

export async function unmatch(matchId) {
  const { error } = await supabase.rpc('unmatch', { target_match_id: matchId });
  if (error) throw error;
}