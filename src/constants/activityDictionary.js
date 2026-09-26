// Canonical activity dictionary (owner item 75, 2026-09-26). Two different relations, never blurred:
//   SAME activity   = a synonym: "cafe", "café", "coffee shop", "coffeehouse" ARE Coffee. Owned by categorySynonyms.js
//                     (SYNONYM_GROUPS + category_synonyms); search and matching treat them as one tag.
//   RELATED activity = a sibling: Padel is related to Pickleball, but it is NOT Pickleball. Owned by this file. A related
//                     activity is never a search result for the other, never a synonym, and never worded "you like"; it may
//                     only give the weak, labeled "Related to your interest in Pickleball" lift (hobbyRelations RELATED_POINTS,
//                     below a declared tag, ranking only, nothing hidden or added).
// Guards (activityDictionary.test.js): every tag is canonical; no synonym phrase maps to two siblings of one group; a
// canonical tag's own name only ever maps to itself (padel never -> Pickleball, also refused server-side by
// admin_add_category_synonym, migration 20270213). Client-side only; no business sees it. Add a group only for activities a
// person would plausibly swap for each other; similar-sounding names are not a reason.
import { tagsForPhrase } from './categorySynonyms';

export const RELATED_ACTIVITY_GROUPS = [
  ['Pickleball', 'Padel', 'Tennis'],
  ['Golf', 'Mini Golf'],
  ['Yoga', 'Pilates'],
  ['Paddleboarding', 'Kayaking', 'Surfing'],
  ['Snorkeling', 'Diving'],
  ['Hiking', 'Walking', 'Running'],
];

// The one canonical activity a phrase stands for, or null when it names none or is ambiguous (several tags).
export function canonicalActivity(text) {
  const tags = tagsForPhrase(text);
  return tags.length === 1 ? tags[0] : null;
}

// Tags related to (but distinct from) this one; never includes the tag itself.
export function relatedActivities(tag) {
  const out = new Set();
  for (const g of RELATED_ACTIVITY_GROUPS) if (g.includes(tag)) g.forEach((t) => t !== tag && out.add(t));
  return [...out];
}

export function isSameActivity(a, b) {
  return !!a && a === b;
}

export function areRelatedActivities(a, b) {
  return !!a && !!b && a !== b && relatedActivities(a).includes(b);
}
