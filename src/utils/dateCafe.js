// Café on a date (owner decision 2026-09-26, after item 85). The date-night recipe's "Dinner" part listed restaurant tags only,
// so a café its owner marked as a date spot could never be the plan's food/drink stop (it fell into "Finish the Night"). A café
// is now eligible for that part ALONGSIDE restaurants, only when the ask is compatible with a café:
//   * the person asked for coffee ("a coffee date": the ask's own category is a café tag), or
//   * the café's owner DECLARED it date-friendly or romantic (DATE_PLACE_KEYS; never inferred from category, price or photos).
// A cuisine the person asked for must be the café's own declared cuisine (else it stays out, like any restaurant would).
// Business results only: gatherings are never placed or framed as a date. Nothing is removed or re-scored; the other
// constraints (budget, time, open now, booking mode) were already applied to the candidates upstream.
import { DATE_CAFE_CATEGORIES } from '../constants/experienceTemplates';
import { DATE_PLACE_KEYS, declaredQualities } from '../constants/businessVibes';

const BUSINESS_TYPES = ['business_availability'];

function rowTags(c) {
  return [c?.category, c?.subcategory, ...(Array.isArray(c?.categories) ? c.categories : [])].filter(Boolean);
}

export function isCafe(c) {
  return rowTags(c).some((t) => DATE_CAFE_CATEGORIES.includes(t));
}

export function cafeFitsDatePlan(c, context = {}) {
  if (!BUSINESS_TYPES.includes(c?.type) || !isCafe(c)) return false;
  const { category = null, cuisine = null } = context ?? {};
  if (cuisine) {
    const declaredCuisine = c.matchedAvailability?.cuisine ?? c.businessPartner?.cuisine ?? null;
    if (declaredCuisine !== cuisine) return false;
  }
  if (category && DATE_CAFE_CATEGORIES.includes(category)) return true;
  return declaredQualities(c).some((k) => DATE_PLACE_KEYS.includes(k));
}

// The part's name follows what is really in it: all cafés = "Coffee", cafés beside restaurants = "Dinner or Coffee".
export function dateFoodLabel(items, fallback) {
  const cafes = items.filter(isCafe).length;
  if (cafes === 0) return fallback;
  return cafes === items.length ? '☕ Coffee' : '🍽️ Dinner or Coffee';
}
