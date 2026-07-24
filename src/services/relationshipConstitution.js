import { supabase } from './supabase';

export async function addConstitutionEntry(matchId, article, entryText) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('constitution_entries')
    .insert({ match_id: matchId, added_by: userId, article, entry_text: entryText });

  if (error) throw error;
}

export async function getConstitutionEntries(matchId) {
  const { data, error } = await supabase
    .from('constitution_entries')
    .select('*, profiles(display_name)')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getConstitutionEntries error', error);
    return [];
  }
  return data ?? [];
}