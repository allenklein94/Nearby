import { supabase } from './supabase';

export async function addTripIdea(matchId, category, ideaText) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('trip_ideas')
    .insert({ match_id: matchId, added_by: userId, category, idea_text: ideaText });

  if (error) throw error;
}

export async function getTripIdeas(matchId) {
  const { data, error } = await supabase
    .from('trip_ideas')
    .select('*, profiles(display_name)')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getTripIdeas error', error);
    return [];
  }
  return data ?? [];
}