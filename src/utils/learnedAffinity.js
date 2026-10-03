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
//   - owner decision (2026-10-03, LOCKED): when the ask states ANY explicit constraint (askStatesConstraint below: a time,
//     a budget, indoor/outdoor, a vibe or energy, an exclusion, a required feature, open now, a distance...), it is a LITERAL
//     tie-breaker: it adds nothing to the score and only orders results that tie on every other comparison (never an
//     additive boost that could overcome a higher-priority signal). No hardcoded mood list;
//   - it also counts as HISTORY (historyScore), so the session-intent rule (constants/sessionIntent.js) still removes it
//     entirely from a result that conflicts with a stated mood or quality;
//   - unknown maturity (the account lookup failed) = nothing learned, never full weight.
// Reason: "Based on your recent activity: Coffee" (never "you like"). Ranking only; never stored, never sent anywhere.
import { behaviorNudge } from '../constants/blendedRanking';
import { reasonText, appendReason } from '../constants/recommendationReasonVocabulary';
import { vibesFromAsk } from '../constants/businessVibes';
import { energiesFromText } from '../constants/energyLevel';
import { parseAskFacets, attributesFromAsk } from '../constants/askFacets';
import { dateWindowFromText, priceLevelFromText, budgetMaxFromText } from './askResolver';
import { clockWindowFromText } from '../constants/clockWindow';
import { timeBudgetFromText } from '../constants/timeBudget';
import { distanceWillingnessFromText } from '../constants/distanceWillingness';
import { dietaryFromAsk } from '../constants/dietaryOptions';
import { openNowAskFromText } from './operatingStatus';
import { askedChildAges } from './suitedAges';

// Does THIS ask state an explicit constraint on the results? Only what the person said or explicitly picked (the words, or a
// chip: budget, Open now, a Browse category). Reuses the existing parsers; nothing new is detected or stored. Who it is with
// is social context, not a constraint on the results, so it is not counted.
export function askStatesConstraint(text, { dateWindow = null, priceLevel = null, budgetMax = null, openNowChip = false, narrowGroup = null } = {}) {
  if (dateWindow || priceLevel || budgetMax || openNowChip || narrowGroup) return true;
  if (typeof text !== 'string' || !text.trim()) return false;
  const vibes = vibesFromAsk(text);
  const facets = parseAskFacets(text);
  return !!(
    vibes.want.length || vibes.avoid.length || energiesFromText(text).length
    || facets.environment || facets.exclude.length || facets.pricey
    || dateWindowFromText(text) || clockWindowFromText(text) || timeBudgetFromText(text)
    || priceLevelFromText(text) || budgetMaxFromText(text)
    || attributesFromAsk(text).length || dietaryFromAsk(text).length || askedChildAges(text).length
    || distanceWillingnessFromText(text) || openNowAskFromText(text)
  );
}

export function applyLearnedAffinity(candidates, learned, { constrained = false } = {}) {
  if (!Array.isArray(candidates) || !learned || learned.maturity == null) return candidates;
  const behavior = learned.behavior ?? {};
  if (Object.keys(behavior).length === 0) return candidates;
  return candidates.map((c) => {
    const lift = behaviorNudge(c?.category, { behavior, maturity: learned.maturity });
    if (!(lift > 0)) return c;
    const reasons = appendReason(c.reasons, reasonText('recentActivity', { category: c.category }));
    // A stated constraint: a LITERAL tie-breaker. Nothing is added to the score, so it can never move a result past one that
    // ranks higher on anything else; it only orders results that are otherwise tied (comparePersonalTieBreak).
    if (constrained) return { ...c, learnedTieBreak: lift, reasons };
    return {
      ...c,
      score: (c.score ?? 0) + lift,
      historyScore: (Number.isFinite(c.historyScore) ? c.historyScore : 0) + lift,
      reasons,
    };
  });
}

// The final tie-break: only consulted when every ranking comparison said "equal". Personalization that is a literal
// tie-breaker lives here: learned affinity under a stated constraint (learnedTieBreak) and the declared-interest history a
// stated mood moved out of the score (historyTieBreak, constants/sessionIntent.js).
export function comparePersonalTieBreak(a, b) {
  const v = (c) => (Number.isFinite(c?.learnedTieBreak) ? c.learnedTieBreak : 0) + (Number.isFinite(c?.historyTieBreak) ? c.historyTieBreak : 0);
  return v(b) - v(a);
}
