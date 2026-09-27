// Category narrows the ask (owner item 108, 2026-09-27, Discover). With a typed ask on screen, tapping a Browse category is an
// ADDITIONAL constraint on that same ask, never a replacement search: time, who it is for, budget, attributes, firm and tentative
// preferences all stay exactly as the ask had them, and the category only keeps results CONFIRMED inside that group (a result
// whose category is unknown cannot be confirmed, so it is left out while the category is on; clearing it brings everything back).
// Pure: the resolver calls narrowToGroup; the surfaces call toggleCategoryNarrow on the ask's classification.
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';
import { groupKeyOf } from './openEndedAsk';

export const isCategoryGroup = (key) => typeof key === 'string' && CATEGORY_GROUPS.some((g) => g.key === key);

// Keeps only candidates whose own known category belongs to `groupKey`. No group (or an unknown one) = unchanged.
export function narrowToGroup(candidates, groupKey) {
  if (!isCategoryGroup(groupKey) || !Array.isArray(candidates)) return candidates;
  return candidates.filter((c) => groupKeyOf(c) === groupKey);
}

// The classification with the category set, switched to another, or cleared (tapping the selected one again). Touches nothing
// else: the tap never sets a time, a party size, who it is for, or any other constraint.
export function toggleCategoryNarrow(classify, groupKey) {
  const c = { ...(classify ?? {}) };
  if (!isCategoryGroup(groupKey) || c.narrowGroup === groupKey) {
    delete c.narrowGroup;
    return c;
  }
  c.narrowGroup = groupKey;
  return c;
}

export const narrowGroupLabel = (key) => CATEGORY_GROUPS.find((g) => g.key === key)?.label ?? null;
