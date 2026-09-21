// Accessibility and family features are STRUCTURED, declared facts (owner items 49/50): a business declares them in its attribute
// vocabulary (already scored by attributeAndCuisineBonus), and a gathering's HOST declares them in `gatherings.features`. This is the
// gathering half of the same ranking: an ask that names attributes ("something to do with my kids" -> kid_friendly, "wheelchair
// accessible") lifts a gathering whose host declared a match. A gathering that declared nothing is UNKNOWN, not inaccessible -- it is
// never removed and never marked as lacking the feature. Ranking only.
export const DECLARED_FEATURE_POINTS = 2;

export function declaredFeatureMatches(candidate, asked) {
  if (!Array.isArray(asked) || asked.length === 0 || !Array.isArray(candidate?.features)) return [];
  return candidate.features.filter((k) => asked.includes(k));
}

export function applyDeclaredFeatures(candidates, asked) {
  if (!Array.isArray(asked) || asked.length === 0) return candidates;
  return candidates.map((c) => {
    const hit = declaredFeatureMatches(c, asked);
    return hit.length ? { ...c, score: (c.score ?? 0) + DECLARED_FEATURE_POINTS } : c;
  });
}
