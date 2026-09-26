// Distance willingness (item 69, 2026-09-26). "Nearby" is not one distance for everyone: "5 minutes away right now" and "30
// minutes away for a Saturday activity" are different asks. Read ONLY from the person's own words (deterministic, never AI, never
// guessed from the time of day), into one of four buckets; null = not said = today's ranking unchanged.
//   very_nearby        "walking distance", "around the corner", "5 minutes away", "super close"
//   nearby             "not too far", "a short drive", "15 minutes away"
//   anywhere_in_area   "anywhere in town", "distance doesn't matter"
//   willing_to_travel  "I don't mind driving", "worth the drive", "30 minutes away", "an hour away"
// Minutes are mapped to a BUCKET only (<= 10 very nearby, <= 20 nearby, more = willing to travel); no travel time is ever turned
// into miles or shown as one. Ranking only, on real measured distances (a result with no distance is untouched, nothing removed):
//   very_nearby  within 1 mi +2, beyond 5 mi -2
//   nearby       within 3 mi +1, beyond 10 mi -1
//   anywhere / willing_to_travel  the resolver's usual "close by" bonus is cancelled, so distance stops deciding the order.
// The search area itself is NOT widened: gatherings and businesses are still fetched within their existing bounded radius, so
// "willing to travel" reorders what is in your area rather than reaching further. Typed asks only; never stored, never sent to a
// business, never in Home/Discover feeds.

export const DISTANCE_WILLINGNESS = [
  { key: 'very_nearby', label: 'Very nearby', caption: 'Keeping it very close by' },
  { key: 'nearby', label: 'Nearby', caption: 'Keeping it nearby' },
  { key: 'anywhere_in_area', label: 'Anywhere in my area', caption: 'Looking anywhere in your area' },
  { key: 'willing_to_travel', label: 'Willing to travel', caption: 'Not limiting it to what is closest' },
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

const BANDS = {
  very_nearby: { within: 1, lift: 2, beyond: 5, sink: -2 },
  nearby: { within: 3, lift: 1, beyond: 10, sink: -1 },
};

export function distanceWillingnessDelta(c, key) {
  if (!key || typeof c?.distanceMiles !== 'number' || !Number.isFinite(c.distanceMiles) || c.distanceMiles < 0) return 0;
  const band = BANDS[key];
  if (band) return c.distanceMiles <= band.within ? band.lift : c.distanceMiles > band.beyond ? band.sink : 0;
  if (key === 'anywhere_in_area' || key === 'willing_to_travel') { const bonus = closeBonusOf(c); return bonus ? -bonus : 0; }
  return 0;
}

// Re-scores only; never adds or removes a result. No key = the same array.
export function applyDistanceWillingness(candidates, key) {
  if (!Array.isArray(candidates) || !DISTANCE_WILLINGNESS_KEYS.includes(key)) return candidates;
  return candidates.map((c) => {
    const delta = distanceWillingnessDelta(c, key);
    return delta ? { ...c, score: (c.score ?? 0) + delta } : c;
  });
}
