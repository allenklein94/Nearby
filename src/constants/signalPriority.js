// Which signal wins when they compete: the recommendation hierarchy (owner item 115, 2026-09-27; supersedes item 53's eight
// tiers). Lower tier = stronger. An explicit ask beats a habit; what the person is already doing beats what is merely popular.
//
//    1 intent       explicit current intent (the active Ask-Nearby search; item 114: it also outranks history in typed asks)
//    2 constraint   hard constraints the person stated (date/time, group size, age limit, open now, compatibility). These are
//                   enforced FIRST as filters in typed asks: a result that fails one is removed, never ranked. The tier exists
//                   so a surface that can mark a met requirement ranks it right under the ask itself.
//    3 planFriend   friends / social context (an existing plan, a connected friend hosting or going)
//    4 availability can it actually happen: a business has this ready (a live posting), confirmed usable now
//    5 time         time relevance (starts within the Right Now window, "starting soon", happening today)
//    6 interest     strong personal interest (a declared/matched interest)
//    7 business     business opportunity (a perk / offer, "a business may be able to help"); a tag only RELATED to an
//                   interest and a friend's declared interest ("Sam is into Coffee") also sit here, weaker than a real interest
//    8 weather      weather fit
//    9 popularity   trending / popularity (attendance)
//   10 discovery    general discovery (distance, capacity, anything else)
//
// Ranking uses a candidate's STRONGEST tier first (lexicographic, not additive), so many weak signals cannot add up
// to beat one strong one; the number of real reasons only breaks ties within a tier.
import { categorizeReasonText, REASON_CATEGORIES, REASON_TEXT } from './recommendationReasonVocabulary';

export const SIGNAL_TIERS = { intent: 1, constraint: 2, planFriend: 3, availability: 4, time: 5, interest: 6, business: 7, weather: 8, popularity: 9, discovery: 10 };
export const WORST_TIER = SIGNAL_TIERS.discovery;

const KIND_TIER = {
  intent: SIGNAL_TIERS.intent,
  going: SIGNAL_TIERS.planFriend,
  friend: SIGNAL_TIERS.planFriend,
  soon: SIGNAL_TIERS.time,
  interest: SIGNAL_TIERS.interest,
  availability: SIGNAL_TIERS.availability,
  business: SIGNAL_TIERS.business,
  trending: SIGNAL_TIERS.popularity,
  weather: SIGNAL_TIERS.weather,
};

// A friend's declared interest ("Sam is into Coffee"): social, but weaker than a friend hosting/going (and than the person's own
// interest), so it ranks with business opportunity.
const FRIEND_INTEREST_RE = /^.+ (is|are) into .+$/;

// The tier of a free-text reason, from the shared reason vocabulary. Unknown text is general discovery, never stronger.
export function reasonTier(text) {
  if (typeof text !== 'string') return WORST_TIER;
  if (text === REASON_TEXT.WEATHER_GOOD_INDOOR.text || text === REASON_TEXT.WEATHER_GOOD_OUTDOOR.text) return SIGNAL_TIERS.weather;
  if (/ (is|are) (going|attending)$/.test(text) || /^\d+ of your friends /.test(text) || /\b(is|are) hosting\b/.test(text)) return SIGNAL_TIERS.planFriend;
  // A tag only RELATED to a declared hobby is weaker than a declared interest: it ranks with business opportunity.
  if (/^🟢 A business has this ready$/.test(text)) return SIGNAL_TIERS.availability;
  if (/^Related to your interest in /.test(text) || FRIEND_INTEREST_RE.test(text)) return SIGNAL_TIERS.business;
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

// Strongest tier among signals, plus flags the caller knows: `intent` (matches the active ask), `constraint` (meets a hard
// requirement the person stated), `available` (confirmed usable / a business has it ready), `urgent` (inside the Right Now
// window), `business` (a perk/offer).
export function bestTier(signals = [], { intent = false, constraint = false, available = false, urgent = false, business = false } = {}) {
  let best = WORST_TIER;
  for (const s of signals) best = Math.min(best, signalTier(s));
  if (intent) best = Math.min(best, SIGNAL_TIERS.intent);
  if (constraint) best = Math.min(best, SIGNAL_TIERS.constraint);
  if (available) best = Math.min(best, SIGNAL_TIERS.availability);
  if (urgent) best = Math.min(best, SIGNAL_TIERS.time);
  if (business) best = Math.min(best, SIGNAL_TIERS.business);
  return best;
}

// Owner item 59: the four things a reason can MEAN, never blurred. personalized = because of you (a declared/matched
// interest); popular = because many people are going (attendance, trending); social = because of someone you are
// connected to (a friend hosting or going); time = because of when (starting soon, happening today). Anything else
// (distance, weather, capacity, business availability) is null: a fact about the thing, not one of the four claims.
export const REASON_KINDS = { PERSONALIZED: 'personalized', POPULAR: 'popular', SOCIAL: 'social', TIME: 'time' };

export function reasonKind(signalOrText) {
  const signal = typeof signalOrText === 'string' ? { text: signalOrText } : signalOrText;
  if (/^Related to your interest in /.test(signal?.text ?? '')) return REASON_KINDS.PERSONALIZED;
  if (FRIEND_INTEREST_RE.test(signal?.text ?? '')) return REASON_KINDS.SOCIAL;
  switch (signalTier(signal)) {
    case SIGNAL_TIERS.planFriend: return REASON_KINDS.SOCIAL;
    case SIGNAL_TIERS.time: return REASON_KINDS.TIME;
    case SIGNAL_TIERS.interest: return REASON_KINDS.PERSONALIZED;
    case SIGNAL_TIERS.popularity: return REASON_KINDS.POPULAR;
    default: return null;
  }
}
