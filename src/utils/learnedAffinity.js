// "What Nearby has noticed" (owner item 95): the person's learned category affinities, shown back to them. Rows come from
// get_my_behavior_categories (private, owner-only, 90 days; open/search = 1, create/join/accept = 3, capped at 12). An
// affinity is listed once it amounts to at least one deliberate act or three glances (LEARNED_MIN_WEIGHT), strongest
// first. Listing it changes nothing: behavior only ranks. It becomes a profile interest only by the person's own tap.
export const LEARNED_MIN_WEIGHT = 3;
export const LEARNED_MAX_SHOWN = 5;

export function learnedAffinities(rows, declaredInterests = []) {
  const declared = new Set(declaredInterests ?? []);
  return (rows ?? [])
    .filter((r) => r?.category && Number(r.weight) >= LEARNED_MIN_WEIGHT)
    .sort((a, b) => Number(b.weight) - Number(a.weight))
    .slice(0, LEARNED_MAX_SHOWN)
    .map((r) => ({ category: r.category, weight: Number(r.weight), inProfile: declared.has(r.category) }));
}
