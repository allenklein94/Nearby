import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { applyRemoteCategoryTags, applyTaxonomySnapshot } from '../constants/categoryRegistry';
import { registerSynonyms } from '../constants/categorySynonyms';

const CACHE_KEY = 'category_taxonomy_cache_v2'; // get_category_taxonomy() snapshot (20270232)
const SYN_CACHE_KEY = 'category_synonyms_cache_v1';

// Signed-in start-up: apply the last cached snapshot at once (so a tag added yesterday is there before the network
// answers), then refresh. The snapshot (get_category_taxonomy, migration 20270232) carries the taxonomy version, every
// tag with its stable ID (retired ones marked) and every former name, so renames, moves and retirements reach the app
// with no release. Failures are silent by design: the built-in baseline always works.
export async function hydrateCategoryTags() {
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) applyTaxonomySnapshot(JSON.parse(cached));
  } catch (_e) { /* cache is a convenience */ }
  const { data, error } = await supabase.rpc('get_category_taxonomy');
  if (error || !data || !Array.isArray(data.tags)) return 0;
  const changed = applyTaxonomySnapshot(data);
  await hydrateCategorySynonyms(); // after the tags, so a synonym of a brand-new tag is kept
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data)).catch(() => {});
  return changed;
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

// Admin taxonomy changes (migration 20270232). There is deliberately no management screen: the server is the only
// place a rename / move / retirement is decided and checked. Every change is previewed first (existing data, synonyms,
// matching); the commit must carry that preview's impact token, a reason and a request id (a retry with the same id is
// safe and returns the committed result).
export async function adminPreviewCategoryChange({ action, tag, newName = null, newGroup = null, replacement = null, keepExisting = false }) {
  const { data, error } = await supabase.rpc('admin_preview_category_change', {
    action_param: action, tag_param: tag, new_name_param: newName, new_group_param: newGroup,
    replacement_param: replacement, keep_existing_param: keepExisting,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function adminCommitCategoryChange(preview, { reason, requestId }) {
  const common = { reason_param: reason, impact_token_param: preview?.impact_token, request_id_param: requestId };
  const tag = String(preview?.tag?.id ?? '');
  const calls = {
    rename: ['admin_rename_category_tag', { tag_param: tag, new_name_param: preview?.new_name, ...common }],
    move: ['admin_move_category_tag', { tag_param: tag, new_group_param: preview?.new_group, ...common }],
    retire: ['admin_retire_category_tag', { tag_param: tag, replacement_param: preview?.replacement ? String(preview.replacement.id) : null,
      keep_existing_param: preview?.keep_existing === true, ...common }],
    restore: ['admin_restore_category_tag', { tag_param: tag, ...common }],
  };
  const call = calls[preview?.action];
  if (!call) throw new Error('Preview the change first.');
  const { data, error } = await supabase.rpc(call[0], call[1]);
  if (error) throw new Error(error.message);
  return data;
}

export async function adminGetCategoryTagHistory(tag) {
  const { data, error } = await supabase.rpc('admin_get_category_tag_history', { tag_param: tag });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Any name (current or former) or ID -> the stable record and the name it points to now.
export async function resolveCategoryTag(nameOrId) {
  const { data, error } = await supabase.rpc('resolve_category_tag', { name_param: String(nameOrId ?? '') });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data[0] ?? null) : null;
}
