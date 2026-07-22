import { supabase } from './supabase';

export async function getRecentIntentionChangeCount(userId) {
  const { data, error } = await supabase.rpc('get_intention_change_count', { target_user_id: userId });

  if (error) {
    console.error('getRecentIntentionChangeCount error', error);
    return 0;
  }
  return data ?? 0;
}