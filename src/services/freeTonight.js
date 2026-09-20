// Opt-in "Free tonight" (item 77 follow-up). The flag is private: the server only ever answers "who among these
// candidates is ALSO free tonight", and only to someone who set it themselves. Nothing here reads another person's flag
// directly and no status is shown outside a mutual pair.
import { supabase } from './supabase';

export async function getMyFreeTonight() {
  const { data, error } = await supabase.rpc('get_my_free_tonight');
  if (error) throw error;
  return data ?? null;
}

export async function setFreeTonight(untilIso) {
  const { data, error } = await supabase.rpc('set_free_tonight', { until_param: untilIso });
  if (error) throw error;
  return data ?? null;
}

export async function getMutualFreeTonightIds(candidateIds) {
  const ids = [...new Set((candidateIds ?? []).filter(Boolean))].slice(0, 200);
  if (ids.length === 0) return [];
  const { data, error } = await supabase.rpc('get_mutual_free_tonight', { candidate_ids: ids });
  if (error) throw error;
  return (data ?? []).map((r) => r.user_id);
}

// Approximate whole-mile distance to someone you are MATCHED with (null = unknown or not a match).
export async function getMatchDistanceMiles(matchId) {
  const { data, error } = await supabase.rpc('get_match_distance', { match_id_param: matchId });
  if (error) throw error;
  return typeof data === 'number' ? data : null;
}
