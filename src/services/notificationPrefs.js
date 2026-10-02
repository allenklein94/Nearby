// Item 142: the one writer of a person's notification choices (profiles.notification_mutes, via the server, which also
// derives the older on/off columns). Returns the saved list of muted groups.
import { supabase } from './supabase';

export async function setMyNotificationGroup(group, enabled) {
  const { data, error } = await supabase.rpc('set_my_notification_group', { group_param: group, enabled_param: enabled });
  if (error) throw new Error(error.message);
  return data ?? [];
}
