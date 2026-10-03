// Item 183 (owner, 2026-10-03, LOCKED): categories that are NEVER learned or persisted from behavior. An explicit search may
// RESOLVE to one for that request (results come back normally), but nothing about it is kept: no learned affinity
// (services/behaviorSignals.js), no search log or tap log category / words / title (services/intentOutcomes.js), no typed-ask
// audit (services/typedAskAudit.js). So it never reaches business demand counts, category trends, ranking explanations or
// Settings "What Nearby has noticed". A DECLARED profile interest is the person's own choice and is unaffected.
// Identical to the server's _category_never_learned (migrations 20270280 + 20270281), which enforces the same at the
// database; a test keeps the two lists equal. Add a category here and there together, never one-off per feature.
export const NEVER_LEARNED_CATEGORIES = Object.freeze(['Faith & Spirituality']);

export function isNeverLearnedCategory(category) {
  return typeof category === 'string' && NEVER_LEARNED_CATEGORIES.includes(category);
}
