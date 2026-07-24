import { supabase } from './supabase';

export async function submitGoodbyeEntry(aboutDisplayName, entry) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('goodbye_archive_entries')
    .insert({
      user_id: userId,
      about_display_name: aboutDisplayName,
      what_was_beautiful: entry.whatWasBeautiful || null,
      what_was_difficult: entry.whatWasDifficult || null,
      what_you_learned: entry.whatYouLearned || null,
      what_you_want_next_time: entry.whatYouWantNextTime || null,
    });

  if (error) throw error;
}

export async function getMyGoodbyeEntries() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data, error } = await supabase
    .from('goodbye_archive_entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getMyGoodbyeEntries error', error);
    return [];
  }
  return data ?? [];
}

export async function deleteGoodbyeEntry(entryId) {
  const { error } = await supabase.from('goodbye_archive_entries').delete().eq('id', entryId);
  if (error) throw error;
}