// The one place edge functions learn the category-tag vocabulary: public.category_tag_groups (migration 20270160).
// It replaces four hand-copied lists that had already drifted. Tags are added by an admin (admin_add_category_tag), so a
// new tag becomes valid here on the next refresh (60 s cache) with no redeploy. Group ("major") keys stay in code.
// A failed read returns the last good copy, else an EMPTY vocabulary: callers then drop the AI's category/subcategory
// (a suggestion is lost, nothing invalid is ever accepted).
export type CategoryVocab = { tags: string[]; byGroup: Record<string, string[]> };

const TTL_MS = 60_000;
let cache: { at: number; all: CategoryVocab; consumer: CategoryVocab } | null = null;

// `includeBusinessOnly` (default FALSE, the safe side): business-only tags (migration 20270180, e.g. clinical health
// services) exist for a business to describe ITSELF. Only the two business-facing functions pass true; the consumer
// intent extractor never does, so an AI reading a person's words can never assign one.
// deno-lint-ignore no-explicit-any
export async function loadCategoryVocab(admin: any, opts: { includeBusinessOnly?: boolean } = {}): Promise<CategoryVocab> {
  const pick = (c: NonNullable<typeof cache>) => (opts.includeBusinessOnly ? c.all : c.consumer);
  if (cache && Date.now() - cache.at < TTL_MS) return pick(cache);
  const { data, error } = await admin.from('category_tag_groups').select('tag, group_key, business_only').order('created_at').order('tag');
  if (error || !Array.isArray(data)) {
    console.warn('category_tag_groups read failed', error?.message);
    return cache ? pick(cache) : { tags: [], byGroup: {} };
  }
  const build = (rows: { tag: string; group_key: string }[]): CategoryVocab => {
    const byGroup: Record<string, string[]> = {};
    for (const r of rows) (byGroup[r.group_key] ??= []).push(r.tag);
    return { tags: rows.map((r) => r.tag), byGroup };
  };
  const rows = data as { tag: string; group_key: string; business_only?: boolean }[];
  cache = { at: Date.now(), all: build(rows), consumer: build(rows.filter((r) => !r.business_only)) };
  return pick(cache);
}
