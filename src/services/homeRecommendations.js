// Phase 1 of the "Build everything" plan (CLAUDE.md, Aug 22 2026) — the
// unified Home recommendation engine. A pure, dependency-free scoring
// function (no I/O, matching intentResolverScoring.js's own established
// "testable in isolation" shape) that reuses the SAME shared scoring axis
// the intent resolver already proved out across 5 candidate types
// (SCORE_INTEREST_MATCH/SCORE_CLOSE_DISTANCE/SCORE_HAPPENING_NOW/
// SCORE_OWN_NETWORK) — deliberately not a new invented scale. Every point
// awarded has a real, itemized reason attached; nothing here is an opaque
// machine-learned weight, matching this file's oldest and most
// consistently-enforced rule (see CLAUDE.md's own repeated "no premature
// universal/AI-driven matching algorithm" constraint).
import { SCORE_INTEREST_MATCH, SCORE_CLOSE_DISTANCE, SCORE_HAPPENING_NOW, SCORE_OWN_NETWORK } from './intentResolverScoring';
import { isIndoorCategory, isOutdoorCategory } from '../constants/gatheringIndoorOutdoor';
import { isWeatherIndoorBiased, isWeatherOutdoorBiased } from '../utils/weatherBias';

export const MAX_HOME_RECOMMENDATIONS = 5;

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

// The real weather-context bonus/penalty this phase actually adds beyond
// what the intent resolver already scores — reuses SCORE_HAPPENING_NOW's
// own weight (matching this file's "reuse an existing weight, don't
// invent a new number" convention) rather than a fresh constant. Only
// ever applied to a category this app can honestly classify as indoor or
// outdoor (constants/gatheringIndoorOutdoor.js's own deliberately
// conservative map) — a genuinely ambiguous category (Sports, Music,
// Fitness, ...) never gets a weather-driven bonus either way.
//
// P2 item 7 (Universal Signal Remediation Pass, CLAUDE.md, Aug 28 2026):
// now reuses the one shared isWeatherIndoorBiased/isWeatherOutdoorBiased
// definition (utils/weatherBias.js) instead of this file's own local
// forecast-fields-only check — a real, disclosed widening: this bonus now
// also fires on a genuinely bad forecast_label ('Quiet') right now, not
// just a bad forecast for later today, closing the exact inconsistency
// the audit found between this file and HomeScreen's own weather card.
function weatherAdjustment(interestTag, weather) {
  if (!weather) return null;
  if (isWeatherIndoorBiased(weather) && isIndoorCategory(interestTag)) {
    return { points: SCORE_HAPPENING_NOW, reason: 'A good indoor option with weather coming in' };
  }
  if (isWeatherOutdoorBiased(weather) && isOutdoorCategory(interestTag)) {
    return { points: SCORE_HAPPENING_NOW, reason: 'Great weather for this' };
  }
  return null;
}

function scoreGathering(gathering, weather, positiveHostIds) {
  let score = 0;
  const reasons = [];

  if (gathering.matchesYourInterests) {
    score += SCORE_INTEREST_MATCH;
    reasons.push('Matches your interests');
  }
  if (gathering.distanceMiles !== null && gathering.distanceMiles !== undefined && gathering.distanceMiles < 2) {
    score += SCORE_CLOSE_DISTANCE;
    reasons.push('Close by');
  }
  if (isToday(gathering.scheduled_at)) {
    score += SCORE_HAPPENING_NOW;
    reasons.push('Happening today');
  }
  const weatherBonus = weatherAdjustment(gathering.interest_tag, weather);
  if (weatherBonus) {
    score += weatherBonus.points;
    reasons.push(weatherBonus.reason);
  }
  // "The Plan Engine" Phase 4 (CLAUDE.md) -- closes the doc's own VISIT ->
  // FEEDBACK -> NEXT PLAN loop: a real, itemized bonus when the caller has
  // genuinely rated a past gathering with this same host positively
  // (satisfaction_rating loved_it/good AND would_attend_again = true, per
  // get_my_positive_experience_signals()) -- reuses SCORE_OWN_NETWORK, the
  // highest existing weight, since a real lived experience is at least as
  // strong a signal as an own-network connection.
  if (gathering.host_id && positiveHostIds?.has(gathering.host_id)) {
    score += SCORE_OWN_NETWORK;
    reasons.push('You loved a gathering with this host before');
  }

  return { score, reasons };
}

function scoreOffer(offer, positivePartnerIds) {
  let score = 0;
  const reasons = [];

  // getActiveOffers() already only ever returns an untargeted offer, or a
  // targeted one whose target_interest_tag genuinely matches the
  // caller's own real interests — so any offer reaching this function at
  // all is already a real, honest match; a targeted one just gets to say
  // so explicitly.
  if (offer.target_interest_tag) {
    score += SCORE_INTEREST_MATCH;
    reasons.push('Matches your interests');
  }
  if (offer.brand_partners?.name) {
    reasons.push(`At ${offer.brand_partners.name}`);
  }
  // "The Plan Engine" Phase 4 (CLAUDE.md) -- same real closing-the-loop
  // bonus as scoreGathering above, for a business the caller has genuinely
  // rated positively before (satisfaction_rating loved_it/good AND
  // would_repeat yes/maybe on a real past offer).
  if (offer.partner_id && positivePartnerIds?.has(offer.partner_id)) {
    score += SCORE_OWN_NETWORK;
    reasons.push('You loved this business last time');
  }

  return { score, reasons };
}

// context: { gatherings=[], offers=[], weather=null, excludeIds=Set(),
// positiveHostIds=Set(), positivePartnerIds=Set() }
// Returns up to MAX_HOME_RECOMMENDATIONS items, highest score first, each
// carrying every real reason it earned that score — never a bare number
// with no explanation attached.
export function buildHomeRecommendations({
  gatherings = [],
  offers = [],
  weather = null,
  excludeIds = new Set(),
  positiveHostIds = new Set(),
  positivePartnerIds = new Set(),
} = {}) {
  const candidates = [];

  for (const gathering of gatherings) {
    if (excludeIds.has(gathering.id)) continue;
    const { score, reasons } = scoreGathering(gathering, weather, positiveHostIds);
    if (reasons.length === 0) continue;
    candidates.push({ type: 'gathering', id: gathering.id, title: gathering.title, reasons, score, data: gathering });
  }

  for (const offer of offers) {
    if (excludeIds.has(offer.id)) continue;
    const { score, reasons } = scoreOffer(offer, positivePartnerIds);
    if (reasons.length === 0) continue;
    candidates.push({ type: 'perk', id: offer.id, title: offer.title, reasons, score, data: offer });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, MAX_HOME_RECOMMENDATIONS);
}
