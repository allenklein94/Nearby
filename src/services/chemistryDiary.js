import { supabase } from './supabase';

export async function submitChemistryEntry(aboutDisplayName, signals, noteText) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('chemistry_diary_entries')
    .insert({
      user_id: userId,
      about_display_name: aboutDisplayName,
      felt_relaxed: signals.felt_relaxed,
      felt_curious: signals.felt_curious,
      felt_respected: signals.felt_respected,
      felt_laughed: signals.felt_laughed,
      felt_like_myself: signals.felt_like_myself,
      note_text: noteText || null,
    });

  if (error) throw error;
}

export async function getMyChemistryEntries() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data, error } = await supabase
    .from('chemistry_diary_entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getMyChemistryEntries error', error);
    return [];
  }
  return data ?? [];
}

export async function deleteChemistryEntry(entryId) {
  const { error } = await supabase.from('chemistry_diary_entries').delete().eq('id', entryId);
  if (error) throw error;
}