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
import { SCORE_INTEREST_MATCH, SCORE_CLOSE_DISTANCE, SCORE_HAPPENING_NOW } from './intentResolverScoring';
import { isIndoorCategory, isOutdoorCategory } from '../constants/gatheringIndoorOutdoor';

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
function weatherAdjustment(interestTag, weather) {
  if (!weather) return null;
  const forecastRisk = weather.rain_risk === 'high' || weather.heat_risk === true || weather.cold_risk === true;
  if (forecastRisk && isIndoorCategory(interestTag)) {
    return { points: SCORE_HAPPENING_NOW, reason: 'A good indoor option with weather coming in' };
  }
  if (weather.outdoor_favorable === true && isOutdoorCategory(interestTag)) {
    return { points: SCORE_HAPPENING_NOW, reason: 'Great weather for this' };
  }
  return null;
}

function scoreGathering(gathering, weather) {
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

  return { score, reasons };
}

function scoreOffer(offer) {
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

  return { score, reasons };
}

// context: { gatherings=[], offers=[], weather=null, excludeIds=Set() }
// Returns up to MAX_HOME_RECOMMENDATIONS items, highest score first, each
// carrying every real reason it earned that score — never a bare number
// with no explanation attached.
export function buildHomeRecommendations({ gatherings = [], offers = [], weather = null, excludeIds = new Set() } = {}) {
  const candidates = [];

  for (const gathering of gatherings) {
    if (excludeIds.has(gathering.id)) continue;
    const { score, reasons } = scoreGathering(gathering, weather);
    if (reasons.length === 0) continue;
    candidates.push({ type: 'gathering', id: gathering.id, title: gathering.title, reasons, score, data: gathering });
  }

  for (const offer of offers) {
    if (excludeIds.has(offer.id)) continue;
    const { score, reasons } = scoreOffer(offer);
    if (reasons.length === 0) continue;
    candidates.push({ type: 'perk', id: offer.id, title: offer.title, reasons, score, data: offer });
  }

  return candidates.sort((a, b) => b.score - a.score).slice(0, MAX_HOME_RECOMMENDATIONS);
}
