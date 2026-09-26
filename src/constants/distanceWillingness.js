// Distance willingness (item 69, 2026-09-26). "Nearby" is not one distance for everyone: "5 minutes away right now" and "30
// minutes away for a Saturday activity" are different asks. Read ONLY from the person's own words (deterministic, never AI, never
// guessed from the time of day), into one of four buckets; null = not said = today's ranking unchanged.
//   very_nearby        "walking distance", "around the corner", "5 minutes away", "super close"
//   nearby             "not too far", "a short drive", "15 minutes away"
//   anywhere_in_area   "anywhere in town", "distance doesn't matter"
//   willing_to_travel  "I don't mind driving", "worth the drive", "30 minutes away", "an hour away"
// Minutes are mapped to a BUCKET only (<= 10 very nearby, <= 20 nearby, more = willing to travel); no travel time is ever turned
// into miles or shown as one, and there are NO mile cutoffs (owner decision 2026-09-26). On real measured distances only (a result
// with no distance keeps its place, nothing is removed or hard-filtered):
//   very_nearby  the closer a result is RELATIVE to the others, the more it lifts (closest +2 down to farthest 0)
//   nearby       the same, gentler (closest +1 down to 0)
//   anywhere_in_area  the resolver's pre-existing "close by" bonus is cancelled, so distance stops deciding the order
//   willing_to_travel  every search widens one step on the shared radius list (constants/searchRadius.js: 15 -> 30 mi, never past
//                      its 50 mi maximum), then the wider results rank normally by their measured distance.
// Typed asks only; never stored, never sent to a business, never in Home/Discover feeds.

import { TRAVEL_SEARCH_MILES, boundedSearchMiles } from './searchRadius';

export const DISTANCE_WILLINGNESS = [
  { key: 'very_nearby', label: 'Very nearby', caption: 'Keeping it very close by' },
  { key: 'nearby', label: 'Nearby', caption: 'Keeping it nearby' },
  { key: 'anywhere_in_area', label: 'Anywhere in my area', caption: 'Looking anywhere in your area' },
  { key: 'willing_to_travel', label: 'Willing to travel', caption: 'Showing options worth traveling for' },
];
export const DISTANCE_WILLINGNESS_KEYS = DISTANCE_WILLINGNESS.map((d) => d.key);

const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, 'forty-five': 45, sixty: 60 };
const toNum = (s) => (/^\d+$/.test(s) ? Number(s) : NUM[s.toLowerCase()] ?? null);
const bucketForMinutes = (m) => (m == null ? null : m <= 10 ? 'very_nearby' : m <= 20 ? 'nearby' : 'willing_to_travel');

// "5 minutes away", "a 10 minute walk", "15-min drive", "an hour away", "half an hour's drive". The amount must be tied to
// away / walk / drive / ride / from (me|here|home), so "I only have an hour" or "in 5 minutes" is never a distance.
const TRAVEL = String.raw`(?:away|walk(?:ing)?|drive|driving|ride|bike|by\s+car|from\s+(?:me|here|home|my\s+place))`;
const MINUTES_RE = new RegExp(String.raw`\b(\d{1,3}|an?|one|two|three|four|five|ten|fifteen|twenty|thirty|forty|forty-five|sixty)[\s-]*(min(?:ute)?s?|hours?|hrs?)(?:'s)?\s+${TRAVEL}\b`, 'i');
const HALF_HOUR_RE = new RegExp(String.raw`\bhalf\s+an\s+hour(?:'s)?\s+${TRAVEL}\b`, 'i');

const PHRASES = [
  ['willing_to_travel', /\b(?:(?:don'?t|do\s+not)\s+mind\s+(?:a\s+(?:bit\s+of\s+a\s+)?)?(?:driving|drive|travell?ing|the\s+drive|going\s+far)|willing\s+to\s+(?:drive|travel|go\s+far)|happy\s+to\s+(?:drive|travel)|worth\s+(?:the|a)\s+(?:drive|trip)|road\s*trip|day\s*trip|far\s+is\s+(?:fine|ok|okay))\b/i],
  ['anywhere_in_area', /\b(?:anywhere\s+(?:in|around)\s+(?:town|the\s+city|the\s+area|my\s+area|here)|anywhere\s+nearby|(?:distance|location|where)\s+(?:doesn'?t|does\s+not)\s+matter|doesn'?t\s+matter\s+where)\b/i],
  ['very_nearby', /\b(?:(?:within\s+)?walking\s+distance|walkable|around\s+the\s+corner|down\s+the\s+(?:street|road|block)|(?:super|really|very)\s+close|right\s+nearby|in\s+my\s+(?:neighbou?rhood|building)|steps\s+away)\b/i],
  ['nearby', /\b(?:not\s+too\s+far(?:\s+away)?|a\s+short\s+(?:drive|ride|trip)|close\s+to\s+(?:me|home|here|my\s+place)|close\s+by|nearby-ish)\b/i],
];

export function distanceWillingnessFromText(text) {
  const t = typeof text === 'string' ? text : '';
  if (!t.trim()) return null;
  if (HALF_HOUR_RE.test(t)) return bucketForMinutes(30);
  const m = t.match(MINUTES_RE);
  if (m) {
    const n = toNum(m[1]);
    if (n != null) return bucketForMinutes(/^h/i.test(m[2]) ? n * 60 : n);
  }
  for (const [key, re] of PHRASES) if (re.test(t)) return key;
  return null;
}

export const distanceWillingnessCaption = (key) => DISTANCE_WILLINGNESS.find((d) => d.key === key)?.caption ?? null;

// The resolver's existing "close by" bonus (intentResolver / intentResolverScoring: distance < 2 mi). Mirrored here so "anywhere" and
// "willing to travel" can cancel exactly what was given; pinned to the scorers by a test.
export const CLOSE_DISTANCE_MILES = 2;
const CLOSE_BONUS = { gathering: 3, business_availability: 3, business_policy_match: 3, business_occasion_package: 3 };
export function closeBonusOf(c) {
  if (typeof c?.distanceMiles !== 'number' || c.distanceMiles >= CLOSE_DISTANCE_MILES) return 0;
  if (c.type === 'business_policy_match' && c.viaOccasionOffering) return 1;
  return CLOSE_BONUS[c.type] ?? 0;
}

// How strongly closeness counts, relative to the other results' real distances. No mile threshold anywhere.
const CLOSENESS_WEIGHT = { very_nearby: 2, nearby: 1 };

export function distanceWillingnessDelta(c, key, measured = []) {
  if (!key || typeof c?.distanceMiles !== 'number' || !Number.isFinite(c.distanceMiles) || c.distanceMiles < 0) return 0;
  const weight = CLOSENESS_WEIGHT[key];
  if (weight) {
    const ds = measured.length ? measured : [c.distanceMiles];
    const min = Math.min(...ds);
    const max = Math.max(...ds);
    return max === min ? weight : weight * (max - c.distanceMiles) / (max - min);
  }
  if (key === 'anywhere_in_area') { const bonus = closeBonusOf(c); return bonus ? -bonus : 0; }
  return 0;
}

// The one widened radius for a "willing to travel" ask (null otherwise = each search keeps its own default).
export function travelSearchMiles(key) {
  return key === 'willing_to_travel' ? boundedSearchMiles(TRAVEL_SEARCH_MILES) : null;
}

// Re-scores only; never adds or removes a result. No key = the same array.
export function applyDistanceWillingness(candidates, key) {
  if (!Array.isArray(candidates) || !DISTANCE_WILLINGNESS_KEYS.includes(key)) return candidates;
  const measured = candidates.map((c) => c?.distanceMiles).filter((d) => typeof d === 'number' && Number.isFinite(d) && d >= 0);
  return candidates.map((c) => {
    const delta = distanceWillingnessDelta(c, key, measured);
    return delta ? { ...c, score: (c.score ?? 0) + delta } : c;
  });
}
