// Canonical category mapping between the two existing taxonomies: a business's "major" (brand_partners.category, a
// CATEGORY_GROUPS key such as 'food_drink') and the leaf tags used by gatherings (interest_tag), requests and a
// business's subcategory/secondary categories. It is the SAME explicit list as CATEGORY_GROUPS -- nothing is inferred,
// no fuzzy or AI matching. Mirrored in SQL by public.category_tag_groups + business_served_tags() (migration
// 20270118); categoryMapping.test.js fails if the two drift. Neither taxonomy's stored values are changed.
import { CATEGORY_GROUPS } from './gatheringCategories';

export function canonicalGroupForTag(tag) {
  return CATEGORY_GROUPS.find((g) => g.tags.includes(tag))?.key ?? null;
}

export function tagsForGroup(groupKey) {
  return CATEGORY_GROUPS.find((g) => g.key === groupKey)?.tags ?? [];
}

// The leaf tags a business serves. What the owner explicitly declared (subcategory, secondary categories, posting
// categories) wins; only a business that declared NO leaf tag serves its whole major group.
export function servedTags({ category = null, subcategory = null, categories = [], availabilityCategories = [] } = {}) {
  const declared = [subcategory, ...(categories ?? []), ...(availabilityCategories ?? [])].filter(Boolean);
  const set = new Set(declared);
  if (!subcategory && (categories ?? []).length === 0) {
    for (const t of tagsForGroup(category)) set.add(t);
  }
  return [...set];
}

export function businessServesTag(business, tag) {
  return !!tag && servedTags(business).includes(tag);
}
