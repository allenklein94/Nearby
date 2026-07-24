import { supabase } from './supabase';

export async function addTimelineNote(matchId, period, noteText) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('timeline_notes')
    .insert({ match_id: matchId, added_by: userId, period, note_text: noteText });

  if (error) throw error;
}

export async function getTimelineNotes(matchId) {
  const { data, error } = await supabase
    .from('timeline_notes')
    .select('*, profiles(display_name)')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getTimelineNotes error', error);
    return [];
  }
  return data ?? [];
}