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
import { SCORE_INTEREST_MATCH, SCORE_HAPPENING_NOW, SCORE_OWN_NETWORK, SCORE_CLOSE_DISTANCE } from './intentResolverScoring';
import { getTimePeriod } from '../utils/timeContext';
// P1 item 7 (CLAUDE.md, Aug 28 2026 Full Coherence Audit): the same real,
// shared weather-scoring primitive already threaded into the ask box
// (intentResolver.js) and GatheringsScreen's full browse surface (P2 item
// 7 of the same day's Universal Signal Remediation Pass) -- extended here
// into a fourth surface. Closes the audit's own closing-synthesis finding
// ("Business Opportunity ranking still lives in its own weather-blind
// world relative to the consumer side"), not a new invented rule.
import { isWeatherIndoorBiased, isWeatherOutdoorBiased } from '../utils/weatherBias';
import { isIndoorCategory, isOutdoorCategory } from '../constants/gatheringIndoorOutdoor';
// Reuses the exact same canonical weather-reason text P1 item 4's shared
// recommendation-reason vocabulary already established for the consumer
// side, so a business owner sees the identical real sentence a consumer
// would for the identical real signal, not a fourth independently-typed
// wording of the same fact.
import { REASON_TEXT } from '../constants/recommendationReasonVocabulary';

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
  requestPartySize = null,
  businessAttributes = [],
  businessCuisine = null,
  businessPriorityAttributes = [],
  businessPriorityTimeWindows = [],
  activePrioritySignals = [],
  fulfillmentPolicy = null,
  // Optional -- the real, already-fetched weather object for the
  // business's own real location (getSocialForecast(), same shape every
  // other weather-aware surface already uses). null/undefined for a
  // business with no coordinates set, or before the async weather
  // request resolves -- this bonus simply doesn't apply, never a
  // fabricated one.
  weather = null,
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

  // P1 item 6 (folds into P0 item 2's own implementation, per the plan):
  // party size becomes a real relevance signal here specifically because
  // this screen (which request should I look at first) never treats it
  // as a hard constraint the way the consumer-facing resolver's capacity
  // check already does -- every open request shows up regardless of
  // size. Reuses the exact same real fulfillment-policy party-size range
  // and SCORE_CLOSE_DISTANCE weight businessOfferRecommendation.js's own
  // rankExperiencesForOpportunity() already established, so a business
  // that's set a real "usual party size" range on its standing policy
  // sees a request that fits it ranked up -- never a fabricated fit
  // signal for a business with no policy set.
  if (
    requestPartySize != null &&
    fulfillmentPolicy?.party_size_min != null &&
    fulfillmentPolicy?.party_size_max != null &&
    requestPartySize >= fulfillmentPolicy.party_size_min &&
    requestPartySize <= fulfillmentPolicy.party_size_max
  ) {
    score += SCORE_CLOSE_DISTANCE;
    reasons.push({ label: 'Within your usual party size range', points: SCORE_CLOSE_DISTANCE });
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

  // P1 item 7 (CLAUDE.md, Aug 28 2026 Full Coherence Audit): a real
  // weather-context bonus, only when the request's own real category is
  // one this app can honestly classify as indoor or outdoor (the same
  // deliberately conservative map every other weather-aware surface
  // already relies on -- a genuinely ambiguous category like Sports or
  // Music never gets a bonus either way). A business fielding an indoor-
  // shaped request becomes more relevant to look at first when real bad
  // weather is coming in (people are about to need exactly this more
  // urgently); the symmetric case for an outdoor-shaped request on a
  // genuinely great-weather day. Reuses SCORE_HAPPENING_NOW, the same
  // weight every other weather bonus in this app already uses -- not a
  // new invented scale.
  if (requestCategory && weather) {
    if (isWeatherIndoorBiased(weather) && isIndoorCategory(requestCategory)) {
      score += SCORE_HAPPENING_NOW;
      reasons.push({ label: REASON_TEXT.WEATHER_GOOD_INDOOR.text, points: SCORE_HAPPENING_NOW });
    } else if (isWeatherOutdoorBiased(weather) && isOutdoorCategory(requestCategory)) {
      score += SCORE_HAPPENING_NOW;
      reasons.push({ label: REASON_TEXT.WEATHER_GOOD_OUTDOOR.text, points: SCORE_HAPPENING_NOW });
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
