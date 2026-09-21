import { supabase } from './supabase';

// { [tag]: { friend_count, sample_names } } for the tags at least one accepted friend declared. Best-effort: any failure is
// an empty map (no reason is shown, none is invented). Ids and other interests never come back from the server.
export async function getFriendsInterestedIn(tags) {
  const list = [...new Set((tags ?? []).filter((t) => typeof t === 'string' && t))].slice(0, 20);
  if (list.length === 0) return {};
  try {
    const { data, error } = await supabase.rpc('get_friends_interested_in', { tags_param: list });
    if (error || !Array.isArray(data)) return {};
    return Object.fromEntries(data.map((r) => [r.tag, { friend_count: r.friend_count, sample_names: r.sample_names ?? [] }]));
  } catch {
    return {};
  }
}
