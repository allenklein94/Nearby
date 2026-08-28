// Business Intelligence & Opportunity Engine, Phase 2 (see CLAUDE.md's own
// plan) -- the Opportunity Engine's real, itemized scoring. Pure function,
// no I/O, same "fully testable" shape as intentResolverScoring.js/
// homeRecommendations.js -- and deliberately reuses their exact SCORE_*
// weights rather than inventing a second scale, matching this app's own
// long-standing "ranking stays simple/explainable, never an opaque
// blended score" rule.
//
// A real, deliberate deviation from the plan's own literal wording ("a
// persisted opportunity_score"): this is computed at READ time, not
// frozen onto the business_request_offers row at insert time. A
// business's own priority_attributes/priority_time_windows/temporary
// boost can change *after* an opportunity already exists -- a score
// computed once at insertion would silently go stale the moment the
// business updates its own preferences, which is a real correctness
// problem, not just an implementation nicety. Every input here is data
// the dashboard already fetches (business_requests.attributes/cuisine/
// category/date/time_window_start via getBusinessOpportunities; the
// business's own already-loaded attributes/cuisine/priority_attributes/
// priority_time_windows; Phase 1's activePrioritySignals) -- no new query.
import { SCORE_INTEREST_MATCH, SCORE_HAPPENING_NOW, SCORE_OWN_NETWORK } from './intentResolverScoring';
import { getTimePeriod } from '../utils/timeContext';

// Universal Signal Remediation Pass, P1 item 5 (CLAUDE.md, Aug 28 2026):
// a real, monotonic, capped-not-fabricated reference point -- $150 was
// picked as a plausible mid-range "the full existing SCORE_OWN_NETWORK
// weight" ceiling, not derived from any real spend data (none exists yet
// in this young app), and is explicitly disclosed as a placeholder a
// future pass should re-tune once real business_requests.budget_max
// volume exists to look at. Never a hard filter -- a low-budget request
// still scores, just lower, per the user's own explicit "shouldn't
// necessarily be excluded" instruction.
const BUDGET_BONUS_REFERENCE = 150;

export function scoreBusinessOpportunity({
  requestAttributes = [],
  requestCuisine = null,
  requestCategory = null,
  requestDate = null,
  requestTimeWindowStart = null,
  requestBudgetMax = null,
  businessAttributes = [],
  businessCuisine = null,
  businessPriorityAttributes = [],
  businessPriorityTimeWindows = [],
  activePrioritySignals = [],
} = {}) {
  const reasons = [];
  let score = 0;

  // The strongest real signal: the business explicitly said it wants
  // more of this attribute. Counted once per opportunity (not once per
  // matching attribute) -- multiple overlapping priority attributes are
  // still one real fact ("this fits what you're looking for"), not
  // several stacked ones.
  const priorityMatches = requestAttributes.filter((a) => businessPriorityAttributes.includes(a));
  if (priorityMatches.length > 0) {
    score += SCORE_OWN_NETWORK;
    reasons.push({ label: 'Matches what you said you want more of', points: SCORE_OWN_NETWORK });
  }

  // A weaker, still-real signal: the business already offers this, even
  // though it's not flagged as a current priority. Never double-counts an
  // attribute already credited above under the stronger priority reason.
  const generalMatches = requestAttributes.filter(
    (a) => businessAttributes.includes(a) && !businessPriorityAttributes.includes(a)
  );
  if (generalMatches.length > 0) {
    score += SCORE_INTEREST_MATCH;
    reasons.push({ label: 'You already offer this', points: SCORE_INTEREST_MATCH });
  }

  if (requestCuisine && businessCuisine && requestCuisine === businessCuisine) {
    score += SCORE_INTEREST_MATCH;
    reasons.push({ label: 'Matches your cuisine', points: SCORE_INTEREST_MATCH });
  }

  // Finding 5 (audit): a real, explicitly-typed dollar amount that
  // previously dead-ended at display -- collected, stored, shown to the
  // business, never scored. A real bonus, never a hard filter -- proportional
  // to the real amount, capped at the existing SCORE_OWN_NETWORK weight
  // (this scale's own highest), never a fabricated new maximum.
  if (requestBudgetMax != null && requestBudgetMax > 0) {
    const budgetBonus = Math.min(SCORE_OWN_NETWORK, Math.round((requestBudgetMax / BUDGET_BONUS_REFERENCE) * SCORE_OWN_NETWORK));
    if (budgetBonus > 0) {
      score += budgetBonus;
      reasons.push({ label: `Offers up to $${requestBudgetMax}`, points: budgetBonus });
    }
  }

  // Timing fit -- reuses the exact same morning/afternoon/evening/weekend
  // bucketing this app already established for priority_time_windows
  // (getTimePeriod, utils/timeContext.js), not a second invented
  // definition of "weekend."
  if (requestDate && requestTimeWindowStart && businessPriorityTimeWindows.length > 0) {
    const period = getTimePeriod(new Date(`${requestDate}T${requestTimeWindowStart}`));
    if (businessPriorityTimeWindows.includes(period)) {
      score += SCORE_HAPPENING_NOW;
      reasons.push({ label: `Fits your usual ${period} hours`, points: SCORE_HAPPENING_NOW });
    }
  }

  // Phase 1's real, time-bounded "want more of X right now" signal --
  // scaled by the business's own real, honest strength value (0-1), never
  // a flat bonus regardless of how strongly the business actually meant
  // it.
  if (requestCategory) {
    const activeSignal = activePrioritySignals.find((s) => s.category === requestCategory);
    if (activeSignal) {
      const points = Math.round((activeSignal.strength ?? 1) * SCORE_OWN_NETWORK);
      if (points > 0) {
        score += points;
        reasons.push({ label: `You're actively boosting ${requestCategory} this week`, points });
      }
    }
  }

  return { score, reasons };
}
