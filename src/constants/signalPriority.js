// Which signal wins when they compete (owner item 53, 2026-09-20). Lower tier = stronger. An explicit ask beats a
// habit; what the person is already doing beats what is merely popular. So a random trending event can never outrank
// something they explicitly asked for, or a friend's plan.
//
//   1 intent      explicit current intent ("what do I want to do?": the active Ask-Nearby search)
//   2 planFriend  existing plan / friend activity (a friend hosting or going)
//   3 time        time relevance (starts within the Right Now window, "starting soon", happening today)
//   4 interest    strong personal interest (a declared/matched interest)
//   5 business    business availability / offer
//   6 popularity  local popularity (trending, attendance)
//   7 weather     weather fit
//   8 discovery   general discovery (distance, capacity, anything else)
//
// Ranking uses a candidate's STRONGEST tier first (lexicographic, not additive), so many weak signals cannot add up
// to beat one strong one; the number of real reasons only breaks ties within a tier.
import { categorizeReasonText, REASON_CATEGORIES, REASON_TEXT } from './recommendationReasonVocabulary';

export const SIGNAL_TIERS = { intent: 1, planFriend: 2, time: 3, interest: 4, business: 5, popularity: 6, weather: 7, discovery: 8 };
export const WORST_TIER = SIGNAL_TIERS.discovery;

const KIND_TIER = {
  intent: SIGNAL_TIERS.intent,
  going: SIGNAL_TIERS.planFriend,
  friend: SIGNAL_TIERS.planFriend,
  soon: SIGNAL_TIERS.time,
  interest: SIGNAL_TIERS.interest,
  business: SIGNAL_TIERS.business,
  trending: SIGNAL_TIERS.popularity,
  weather: SIGNAL_TIERS.weather,
};

// The tier of a free-text reason, from the shared reason vocabulary. Unknown text is general discovery, never stronger.
export function reasonTier(text) {
  if (typeof text !== 'string') return WORST_TIER;
  if (text === REASON_TEXT.WEATHER_GOOD_INDOOR.text || text === REASON_TEXT.WEATHER_GOOD_OUTDOOR.text) return SIGNAL_TIERS.weather;
  if (/ (is|are) (going|attending)$/.test(text) || /^\d+ of your friends /.test(text) || /\b(is|are) hosting\b/.test(text)) return SIGNAL_TIERS.planFriend;
  switch (categorizeReasonText(text)) {
    case REASON_CATEGORIES.INTEREST: return SIGNAL_TIERS.interest;
    case REASON_CATEGORIES.TIME: return SIGNAL_TIERS.time;
    case REASON_CATEGORIES.AVAILABILITY: return SIGNAL_TIERS.business;
    case REASON_CATEGORIES.POPULARITY: return SIGNAL_TIERS.popularity;
    default: return WORST_TIER;
  }
}

export function signalTier(signal) {
  if (!signal) return WORST_TIER;
  if (signal.kind && KIND_TIER[signal.kind] != null) return KIND_TIER[signal.kind];
  return reasonTier(signal.text);
}

// Strongest tier among signals, plus flags the caller knows: `intent` (matches the active ask), `urgent` (inside the
// Right Now window), `business` (a perk/offer).
export function bestTier(signals = [], { intent = false, urgent = false, business = false } = {}) {
  let best = WORST_TIER;
  for (const s of signals) best = Math.min(best, signalTier(s));
  if (intent) best = Math.min(best, SIGNAL_TIERS.intent);
  if (urgent) best = Math.min(best, SIGNAL_TIERS.time);
  if (business) best = Math.min(best, SIGNAL_TIERS.business);
  return best;
}
