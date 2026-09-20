import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { applyRemoteCategoryTags } from '../constants/categoryRegistry';

const CACHE_KEY = 'category_tags_cache_v1';

// Signed-in start-up: apply the last cached list at once (so a tag added yesterday is there before the network answers),
// then refresh from the table. Failures are silent by design: the built-in baseline always works.
export async function hydrateCategoryTags() {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) applyRemoteCategoryTags(JSON.parse(cached));
  } catch (_e) { /* cache is a convenience */ }
  const { data, error } = await supabase.from('category_tag_groups').select('tag, group_key');
  if (error || !Array.isArray(data)) return 0;
  const added = applyRemoteCategoryTags(data);
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data)).catch(() => {});
  return added;
}

// Admin action: add a NEW tag under an existing group. The server validates everything; this only mirrors the result.
export async function adminAddCategoryTag(tag, groupKey) {
  const { data, error } = await supabase.rpc('admin_add_category_tag', { tag_param: tag, group_key_param: groupKey });
  if (error) throw new Error(error.message);
  applyRemoteCategoryTags([{ tag: data, group_key: groupKey }]);
  return data;
}
