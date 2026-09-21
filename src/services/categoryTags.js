import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { applyRemoteCategoryTags } from '../constants/categoryRegistry';
import { registerSynonyms } from '../constants/categorySynonyms';

const CACHE_KEY = 'category_tags_cache_v1';
const SYN_CACHE_KEY = 'category_synonyms_cache_v1';

// Signed-in start-up: apply the last cached list at once (so a tag added yesterday is there before the network answers),
// then refresh from the table. Failures are silent by design: the built-in baseline always works.
export async function hydrateCategoryTags() {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) applyRemoteCategoryTags(JSON.parse(cached));
  } catch (_e) { /* cache is a convenience */ }
  const { data, error } = await supabase.from('category_tag_groups').select('tag, group_key, business_only');
  if (error || !Array.isArray(data)) return 0;
  const added = applyRemoteCategoryTags(data);
  await hydrateCategorySynonyms(); // after the tags, so a synonym of a brand-new tag is kept
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

// Synonyms are data too: cached list first, then the server's. Failures are silent; the built-in table always works.
export async function hydrateCategorySynonyms() {
  try {
    const cached = await AsyncStorage.getItem(SYN_CACHE_KEY);
    if (cached) registerSynonyms(JSON.parse(cached));
  } catch (_e) { /* cache is a convenience */ }
  const { data, error } = await supabase.rpc('get_category_synonyms');
  if (error || !Array.isArray(data)) return 0;
  const added = registerSynonyms(data);
  AsyncStorage.setItem(SYN_CACHE_KEY, JSON.stringify(data)).catch(() => {});
  return added;
}

// Admin action: teach one more way of saying an existing category.
export async function adminAddCategorySynonym(phrase, tag) {
  const { data, error } = await supabase.rpc('admin_add_category_synonym', { phrase_param: phrase, tag_param: tag });
  if (error) throw new Error(error.message);
  registerSynonyms([{ phrase: data, tag }]);
  return data;
}
