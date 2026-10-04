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

// Owner item 194 (2026-10-04): a recommendation shows only its one or two STRONGEST reasons, never every reason it earned.
// Strongest = lowest tier on the ladder above; equal tiers keep the engine's own order. Works on canonical English text (the
// shown text is localized afterwards). Selection only: what ranks an item never reads this.
export const MAX_SHOWN_REASONS = 2;
export function strongestReasons(texts = [], max = MAX_SHOWN_REASONS) {
  const list = (Array.isArray(texts) ? texts : []).filter((t) => typeof t === 'string' && t.trim());
  return list
    .map((text, i) => ({ text, i, tier: reasonTier(text) }))
    .sort((a, b) => a.tier - b.tier || a.i - b.i)
    .slice(0, Math.max(0, max))
    .map((r) => r.text);
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

// ---- The canonical ranking framework (unified ranking, 2026-09-27) ----
// One rule for every surface that orders things: a signal in a stronger tier always beats any amount of signal in a weaker
// tier; within a tier, points add. An item's ranking key is its TIER VECTOR, the points it earned in each tier (1..10), compared
// tier by tier from the strongest. `bestTier` above is the flag form of the same rule (a surface whose signals are yes/no).
// Surfaces keep their own eligibility (filters) and presentation; only the ORDER of what is eligible comes from here.
export const TIER_COUNT = WORST_TIER;

export function emptyTierVector() {
  return new Array(TIER_COUNT).fill(0);
}

// parts: [{ tier, delta }] -> [points in tier 1, ..., points in tier 10]. Unknown tiers count as general discovery.
export function tierVector(parts = []) {
  const v = emptyTierVector();
  for (const p of Array.isArray(parts) ? parts : []) {
    const d = Number(p?.delta);
    if (!Number.isFinite(d) || d === 0) continue;
    const t = Number.isInteger(p?.tier) && p.tier >= 1 && p.tier <= TIER_COUNT ? p.tier : WORST_TIER;
    v[t - 1] = Math.round((v[t - 1] + d) * 1000) / 1000;
  }
  return v;
}

// < 0 when `a` ranks ahead of `b`. Strongest tier first; 0 = a full tie (callers keep their own stable order).
export function compareTierVectors(a, b) {
  for (let i = 0; i < TIER_COUNT; i += 1) {
    const d = (b?.[i] ?? 0) - (a?.[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// The one comparator for ranked result items: by `rankVector` when both carry one, else by plain score (older callers).
export function compareRanked(a, b) {
  if (Array.isArray(a?.rankVector) && Array.isArray(b?.rankVector)) {
    const d = compareTierVectors(a.rankVector, b.rankVector);
    if (d !== 0) return d;
  }
  return (b?.score ?? 0) - (a?.score ?? 0);
}

// Typed search (Home, Discover, Surprise Me, Celebrate): the tier of every named signal the resolver scores with (the same codes
// the typed-ask audit records, utils/typedAskAudit.js SIGNAL_CODES, plus the two passes the audit never records). A new pass
// needs a row here; a test fails otherwise.
export const TYPED_ASK_SIGNAL_TIER = {
  // 1 explicit current intent: how well the result matches what was asked
  base_category_match: SIGNAL_TIERS.intent, base_subcategory: SIGNAL_TIERS.intent, base_secondary_category: SIGNAL_TIERS.intent,
  base_title_mention: SIGNAL_TIERS.intent, base_attribute_match: SIGNAL_TIERS.intent, base_activity_fit: SIGNAL_TIERS.intent,
  base_occasion_fit: SIGNAL_TIERS.intent,
  format: SIGNAL_TIERS.intent, genre: SIGNAL_TIERS.intent, intensity: SIGNAL_TIERS.intent, effort: SIGNAL_TIERS.intent,
  energy: SIGNAL_TIERS.intent, vibe: SIGNAL_TIERS.intent, quality_depth: SIGNAL_TIERS.intent, date_place: SIGNAL_TIERS.intent,
  date_tag: SIGNAL_TIERS.intent, preferred_category: SIGNAL_TIERS.intent, open_ended: SIGNAL_TIERS.intent,
  social_context: SIGNAL_TIERS.intent, commitment: SIGNAL_TIERS.intent, category_narrow: SIGNAL_TIERS.intent,
  // 2 hard constraints the person stated (enforced first as filters where verifiable; these are the ranked remainder)
  base_price_party: SIGNAL_TIERS.constraint, base_party_type_fit: SIGNAL_TIERS.constraint, price_budget: SIGNAL_TIERS.constraint,
  skill_level: SIGNAL_TIERS.constraint, distance_willingness: SIGNAL_TIERS.constraint, transport_mode: SIGNAL_TIERS.constraint,
  time_budget: SIGNAL_TIERS.constraint, clock_window: SIGNAL_TIERS.constraint, capabilities: SIGNAL_TIERS.constraint, likely_group: SIGNAL_TIERS.business,
  declared_features: SIGNAL_TIERS.constraint, ask_facets: SIGNAL_TIERS.constraint, compatibility: SIGNAL_TIERS.constraint,
  dietary: SIGNAL_TIERS.constraint, suited_ages: SIGNAL_TIERS.constraint,
  // 3 friends / social context
  base_own_network: SIGNAL_TIERS.planFriend, base_who_for: SIGNAL_TIERS.planFriend,
  // 4 availability: can it actually happen
  base_availability: SIGNAL_TIERS.availability, base_package: SIGNAL_TIERS.availability, open_now: SIGNAL_TIERS.availability,
  // 5 time relevance
  base_today: SIGNAL_TIERS.time, spontaneity: SIGNAL_TIERS.time,
  // 6 strong interests (who the person usually is)
  base_interest_match: SIGNAL_TIERS.interest, base_hobby_link: SIGNAL_TIERS.interest, base_past_plan: SIGNAL_TIERS.interest,
  base_followed: SIGNAL_TIERS.interest, session_intent: SIGNAL_TIERS.interest, learned_affinity: SIGNAL_TIERS.interest,
  // 7 business opportunity (may be able to help, not confirmed)
  base_occasion_offering: SIGNAL_TIERS.business,
  // 8 weather
  weather: SIGNAL_TIERS.weather,
  // 10 general discovery
  learned_proximity: SIGNAL_TIERS.discovery, base_close_distance: SIGNAL_TIERS.discovery, base_area: SIGNAL_TIERS.discovery, base: SIGNAL_TIERS.discovery,
  // removals only (never a score)
  dedupe: SIGNAL_TIERS.discovery,
};

export function typedAskRankVector(signals = []) {
  return tierVector((Array.isArray(signals) ? signals : []).map((s) => ({ tier: TYPED_ASK_SIGNAL_TIER[s?.code] ?? WORST_TIER, delta: s?.delta })));
}
