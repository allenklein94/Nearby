// "What Nearby has noticed" (owner item 95): the person's learned category affinities, shown back to them. Rows come from
// get_my_behavior_categories (private, owner-only, 90 days; open/search = 1, create/join/accept = 3, capped at 12). Item 157:
// the server returns a category only once it rests on 2+ SEPARATE pieces of evidence (behavior_min_evidence), and that is
// the one bar: everything it returns can shape ranking, so everything it returns is listable here (no second, higher bar
// that would let a category rank while staying hidden), strongest first. Listing it changes nothing: behavior only ranks. It
// becomes a profile interest only by the person's own tap.
export const LEARNED_MIN_WEIGHT = 1;
export const LEARNED_MAX_SHOWN = 5;

export function learnedAffinities(rows, declaredInterests = []) {
  const declared = new Set(declaredInterests ?? []);
  return (rows ?? [])
    .filter((r) => r?.category && Number(r.weight) >= LEARNED_MIN_WEIGHT)
    .sort((a, b) => Number(b.weight) - Number(a.weight))
    .slice(0, LEARNED_MAX_SHOWN)
    .map((r) => ({ category: r.category, weight: Number(r.weight), inProfile: declared.has(r.category) }));
}

// Typed asks (owner item 156, 2026-10-03, LOCKED): the SAME learned affinity lifts results a typed ask already returned in a
// category the person has really been choosing. Subordinate to the ask, always:
//   - only results already in the list are touched; nothing is added, removed or narrowed, and no category joins the ask;
//   - the lift is behaviorNudge (0..BEHAVIOR_MAX_POINTS = 4, scaled by account maturity), strictly below a declared
//     interest (EXPLICIT_POINTS = 5), the same cap and dampening the feeds use;
//   - it counts as HISTORY (historyScore), so when the ask states a mood or quality ("something quiet") the session-intent
//     rule (constants/sessionIntent.js) cuts it to a tie-breaker, or to nothing for a result that conflicts with the ask;
//   - unknown maturity (the account lookup failed) = nothing learned, never full weight.
// Reason: "Based on your recent activity: Coffee" (never "you like"). Ranking only; never stored, never sent anywhere.
import { behaviorNudge } from '../constants/blendedRanking';
import { reasonText, appendReason } from '../constants/recommendationReasonVocabulary';

export function applyLearnedAffinity(candidates, learned) {
  if (!Array.isArray(candidates) || !learned || learned.maturity == null) return candidates;
  const behavior = learned.behavior ?? {};
  if (Object.keys(behavior).length === 0) return candidates;
  return candidates.map((c) => {
    const lift = behaviorNudge(c?.category, { behavior, maturity: learned.maturity });
    if (!(lift > 0)) return c;
    return {
      ...c,
      score: (c.score ?? 0) + lift,
      historyScore: (Number.isFinite(c.historyScore) ? c.historyScore : 0) + lift,
      reasons: appendReason(c.reasons, reasonText('recentActivity', { category: c.category })),
    };
  });
}
