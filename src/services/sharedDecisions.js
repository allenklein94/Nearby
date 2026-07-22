import { supabase } from './supabase';

export async function addSharedDecisionNote(matchId, category, noteText) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('shared_decisions')
    .insert({ match_id: matchId, added_by: userId, category, note_text: noteText });

  if (error) throw error;
}

export async function getSharedDecisionNotes(matchId) {
  const { data, error } = await supabase
    .from('shared_decisions')
    .select('*, profiles(display_name)')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getSharedDecisionNotes error', error);
    return [];
  }
  return data ?? [];
}