// Cuisine filter inside Discover's Restaurants view (owner item 76 follow-up, 2026-09-26). A contextual row, not a global
// chip row, not a screen. Labels come ONLY from the canonical cuisine list (categoryTree.childrenOf -> CUISINE_OPTIONS, the
// same list typed search, the DB CHECKs and the AI functions use); a typed cuisine resolves through the same categoryTree
// resolver, so "Italian restaurants", "Italian dinner tonight" and the Italian chip are one constraint.
// A selected cuisine is EXACT: only businesses whose declared `cuisine` equals it. Never widened to all restaurants, all
// Food & Drink, related cuisines, or text that merely mentions the word. Gatherings, communities and Google Places carry no
// declared cuisine, so they are not shown while a cuisine is selected (nothing unverifiable rides the filter). No ranking.
import { childrenOf, CUISINE_PARENT_TAGS, cuisineFromText } from '../constants/categoryTree';

// Does this Discover context contain the restaurant branch (a restaurant tag, or a group that holds one)?
export function contextHasCuisines(contextTags = []) {
  return contextTags.some((t) => CUISINE_PARENT_TAGS.includes(t));
}

const partnerOf = (offer) => offer?.brand_partners ?? null;

// A perk belongs to the context by its own target tag, or by its business's own declared type (subcategory / major).
export function offerInContext(offer, { tags = [], groupKey = null } = {}) {
  if (!offer) return false;
  if (offer.target_interest_tag && tags.includes(offer.target_interest_tag)) return true;
  const p = partnerOf(offer);
  if (p?.subcategory && tags.includes(p.subcategory)) return true;
  return !!groupKey && p?.category === groupKey;
}

export function declaredCuisineOf(offer) {
  return partnerOf(offer)?.cuisine ?? null;
}

// Exact cuisine constraint; null/empty = no constraint (the broad list comes back unchanged).
export function applyCuisine(list, cuisine) {
  if (!cuisine) return list;
  return (list ?? []).filter((o) => declaredCuisineOf(o) === cuisine);
}

// Chips for the row: canonical cuisines declared by at least one item in view (most declared first, canonical order on
// ties), plus the selected one even when nothing matches (so it can be cleared in place). "Other" is never a chip.
export function cuisineChips(items, selected = null) {
  const counts = new Map();
  for (const o of items ?? []) {
    const c = declaredCuisineOf(o);
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const canonical = childrenOf({ tag: 'Restaurants' });
  return canonical
    .map((c, i) => ({ key: c.cuisine, label: c.label, count: counts.get(c.cuisine) ?? 0, active: c.cuisine === selected, i }))
    .filter((c) => c.count > 0 || c.active)
    .sort((a, b) => b.count - a.count || a.i - b.i)
    .map(({ i, ...c }) => c);
}

// The cuisine a typed request names, through the one resolver (null for "dinner tonight", "french class", "thai massage").
export function cuisineConstraintFromText(text) {
  return cuisineFromText(text);
}

export function cuisineLabel(key) {
  return childrenOf({ tag: 'Restaurants' }).find((c) => c.cuisine === key)?.label ?? null;
}
