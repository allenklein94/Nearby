import { supabase } from './supabase';

export async function getMyBlockedUsers() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data, error } = await supabase
    .from('blocks')
    .select('id, blocked_id, created_at, profiles!blocks_blocked_id_fkey(display_name, photo_url)')
    .eq('blocker_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getMyBlockedUsers error', error);
    return [];
  }
  return data ?? [];
}

export async function unblockUser(blockId) {
  const { error } = await supabase.from('blocks').delete().eq('id', blockId);
  if (error) throw error;
}
// The one block action (same RPC as ReportBlockModal): records the block and ends any match/friendship between the two.
export async function blockAndUnmatch(userId) {
  const { error } = await supabase.rpc('block_and_unmatch', { blocked_user_id: userId });
  if (error) throw error;
}
