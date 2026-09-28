// Dietary options (owner item 88, 2026-09-26; migration 20270230). ONE vocabulary, two views:
//   the customer's NEED on a request (DIETARY_OPTIONS, business_requests.dietary, picked per request)
//   the business's OFFER (brand_partners.dietary_options, declared by the owner)
// Same keys, so a need matches an offer exactly. Structured and declared only: never inferred from a menu, a description, a cuisine,
// a category or photos. Empty = not said (unknown), never "offers none". Matching ranks, it never removes.
import { DIETARY_OPTIONS } from './businessAttributes';
import { appendReason } from './recommendationReasonVocabulary';

export const DIETARY_KEYS = DIETARY_OPTIONS.map((o) => o.key);

// How the owner and the public profile word each key as something the business OFFERS.
export const BUSINESS_DIETARY_OPTIONS = [
  { key: 'vegetarian', label: 'Vegetarian options', short: 'Vegetarian' },
  { key: 'vegan', label: 'Vegan options', short: 'Vegan' },
  { key: 'gluten_free', label: 'Gluten-free options', short: 'Gluten-free' },
  { key: 'dairy_free', label: 'Dairy-free options', short: 'Dairy-free' },
  { key: 'nut_allergy', label: 'Can accommodate nut / peanut allergies', short: 'Nut allergies' },
  { key: 'shellfish_allergy', label: 'Can accommodate shellfish allergies', short: 'Shellfish allergies' },
  { key: 'halal', label: 'Halal', short: 'Halal' },
  { key: 'kosher', label: 'Kosher', short: 'Kosher' },
];

export function dietaryOptionsOf(partner) {
  const list = Array.isArray(partner?.dietary_options) ? partner.dietary_options : [];
  return DIETARY_KEYS.filter((k) => list.includes(k));
}

// Safety-sensitive keys (an allergy or celiac disease): a declaration is the business's own statement that it accommodates it, never
// a guarantee against cross-contact. Anywhere a customer sees one, it reads "declared by the business" with that caveat.
export const SAFETY_SENSITIVE_DIETARY = ['gluten_free', 'dairy_free', 'nut_allergy', 'shellfish_allergy'];
export const DIETARY_SAFETY_NOTE = 'Declared by the business, not a guarantee against cross-contact. If you have an allergy or celiac disease, confirm with them.';
export function dietarySafetyNote(keys) {
  return (Array.isArray(keys) ? keys : []).some((k) => SAFETY_SENSITIVE_DIETARY.includes(k)) ? DIETARY_SAFETY_NOTE : null;
}

// Public profile line: "Vegan options · Gluten-free options · Halal"; null when nothing declared.
export function dietaryOptionsLine(partner) {
  const keys = dietaryOptionsOf(partner);
  if (keys.length === 0) return null;
  return BUSINESS_DIETARY_OPTIONS.filter((o) => keys.includes(o.key)).map((o) => o.label).join(' · ');
}

// Where the owner is asked: a food business (its major is Food & Drink, it serves food, caters, or has a declared cuisine), or one
// that already declared options (so it can remove them). Other businesses are never asked.
export function dietaryRelevantFor(partner) {
  if (!partner) return false;
  if (dietaryOptionsOf(partner).length > 0) return true;
  if (partner.category === 'food_drink' || partner.cuisine) return true;
  const attrs = Array.isArray(partner.attributes) ? partner.attributes : [];
  return attrs.includes('food_available') || attrs.includes('catering');
}

// ---- The ask side: ONLY the person's own words (deterministic, never AI) ----
const NEGATED = /\b(?:non|not|no)[- ]+(?:vegetarians?|vegans?|halal|kosher)\b/gi;
export const DIETARY_ASKS = [
  ['vegetarian', /\bvegetarians?\b|\bveggie[- ]friendly\b/i],
  ['vegan', /\bvegans?\b|\bplant[- ]based\b/i],
  ['gluten_free', /\bgluten[- ]free\b|\bceliacs?\b|\bcoeliacs?\b|\bno\s+gluten\b/i],
  ['dairy_free', /\bdairy[- ]free\b|\blactose[- ](?:free|intolerant)\b|\bno\s+dairy\b/i],
  ['nut_allergy', /\bnut[- ]free\b|\b(?:nut|peanut|tree[- ]nut)\s+allerg(?:y|ies|ic)\b|\ballergic\s+to\s+(?:peanuts?|nuts|tree\s+nuts)\b/i],
  ['shellfish_allergy', /\bshellfish[- ](?:free|allerg(?:y|ies|ic))\b|\ballergic\s+to\s+shellfish\b/i],
  ['halal', /\bhalal\b/i],
  ['kosher', /\bkosher\b/i],
];
export function dietaryFromAsk(text) {
  if (typeof text !== 'string' || !text) return [];
  const clean = text.replace(NEGATED, ' ');
  return DIETARY_ASKS.filter(([, re]) => re.test(clean)).map(([k]) => k);
}

export const DIETARY_FIT_POINTS = 2;

// Ranking only. A business result whose partner row DECLARED every asked need lifts, with a reason naming them; anything else
// (declared some, declared none, not a business, no partner row) is untouched. Nothing is removed.
export function applyDietaryToCandidates(candidates, needs) {
  if (!Array.isArray(needs) || needs.length === 0) return candidates;
  return candidates.map((c) => {
    const offered = dietaryOptionsOf(c?.businessPartner);
    if (offered.length === 0 || !needs.every((n) => offered.includes(n))) return c;
    const labels = BUSINESS_DIETARY_OPTIONS.filter((o) => needs.includes(o.key)).map((o) => o.label).join(' · ');
    const reason = dietarySafetyNote(needs) ? `Business-declared: ${labels}` : labels;
    return { ...c, score: (c.score ?? 0) + DIETARY_FIT_POINTS, dietaryReason: reason, subtitle: c.subtitle ?? reason, reasons: appendReason(c.reasons, reason) };
  });
}

// Business side: does the owner's declaration cover every need on a request? null when the request has no dietary need.
export function dietaryCovers(partner, requestDietary) {
  const needs = Array.isArray(requestDietary) ? requestDietary.filter((k) => DIETARY_KEYS.includes(k)) : [];
  if (needs.length === 0) return null;
  const offered = dietaryOptionsOf(partner);
  return needs.every((n) => offered.includes(n));
}
