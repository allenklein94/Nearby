import { supabase } from './supabase';

export async function addStressTestNote(matchId, scenario, noteText) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('stress_test_notes')
    .insert({ match_id: matchId, added_by: userId, scenario, note_text: noteText });

  if (error) throw error;
}

export async function getStressTestNotes(matchId) {
  const { data, error } = await supabase
    .from('stress_test_notes')
    .select('*, profiles(display_name)')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getStressTestNotes error', error);
    return [];
  }
  return data ?? [];
}