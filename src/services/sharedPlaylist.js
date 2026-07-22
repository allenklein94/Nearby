import { supabase } from './supabase';

export async function addPlaylistItem(matchId, songTitle, artist) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('shared_playlist_items')
    .insert({ match_id: matchId, added_by: userId, song_title: songTitle, artist: artist || null });

  if (error) throw error;
}

export async function getPlaylistItems(matchId) {
  const { data, error } = await supabase
    .from('shared_playlist_items')
    .select('*, profiles(display_name)')
    .eq('match_id', matchId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getPlaylistItems error', error);
    return [];
  }
  return data ?? [];
}