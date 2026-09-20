// The one place edge functions learn the category-tag vocabulary: public.category_tag_groups (migration 20270160).
// It replaces four hand-copied lists that had already drifted. Tags are added by an admin (admin_add_category_tag), so a
// new tag becomes valid here on the next refresh (60 s cache) with no redeploy. Group ("major") keys stay in code.
// A failed read returns the last good copy, else an EMPTY vocabulary: callers then drop the AI's category/subcategory
// (a suggestion is lost, nothing invalid is ever accepted).
export type CategoryVocab = { tags: string[]; byGroup: Record<string, string[]> };

const TTL_MS = 60_000;
let cache: { at: number; vocab: CategoryVocab } | null = null;

// deno-lint-ignore no-explicit-any
export async function loadCategoryVocab(admin: any): Promise<CategoryVocab> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.vocab;
  const { data, error } = await admin.from('category_tag_groups').select('tag, group_key').order('created_at').order('tag');
  if (error || !Array.isArray(data)) {
    console.warn('category_tag_groups read failed', error?.message);
    return cache?.vocab ?? { tags: [], byGroup: {} };
  }
  const byGroup: Record<string, string[]> = {};
  for (const r of data as { tag: string; group_key: string }[]) (byGroup[r.group_key] ??= []).push(r.tag);
  const vocab = { tags: (data as { tag: string }[]).map((r) => r.tag), byGroup };
  cache = { at: Date.now(), vocab };
  return vocab;
}
