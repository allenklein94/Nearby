// Category tags live in ONE place: public.category_tag_groups (migration 20270160). The tags in gatheringCategories.js are
// only the built-in baseline; a tag an admin adds later arrives here and is merged IN PLACE into the same arrays every
// picker, ranking helper and mapping already reads (CATEGORY_GROUPS, INTEREST_OPTIONS, PERSONAL_INTEREST_OPTIONS), so a
// new tag is searchable/matchable everywhere with no per-feature list. Groups (majors) are never created here.
import { CATEGORY_GROUPS, INTEREST_OPTIONS, PERSONAL_INTEREST_OPTIONS } from './gatheringCategories';

export function registerCategoryTag(tag, groupKey, businessOnly = false) {
  if (typeof tag !== 'string' || !tag) return false;
  const group = CATEGORY_GROUPS.find((g) => g.key === groupKey);
  if (!group) return false;
  if (CATEGORY_GROUPS.some((g) => g.tags.includes(tag) || (g.businessOnlyTags ?? []).includes(tag))) return false;
  if (businessOnly) {
    // Business-only (migration 20270180): kept OUT of every consumer list on purpose.
    (group.businessOnlyTags ??= []).push(tag);
    return true;
  }
  group.tags.push(tag);
  INTEREST_OPTIONS.push(tag);
  if (tag !== 'Dating') PERSONAL_INTEREST_OPTIONS.push(tag);
  return true;
}

// rows: [{ tag, group_key }] from category_tag_groups. Returns how many were new to this device.
export function applyRemoteCategoryTags(rows) {
  let added = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (registerCategoryTag(r?.tag, r?.group_key, r?.business_only === true)) added += 1;
  }
  return added;
}
