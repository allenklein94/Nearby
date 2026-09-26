// Transportation mode (2026-09-26, owner decision "both, staged": words now, real travel time designed but NOT built).
// How the person said they are getting there, read ONLY from their own typed words (deterministic, never AI, never inferred
// from the time of day, a profile or behavior). null = not said = ranking unchanged.
//   walking    "I'm walking", "on foot", "we'll walk over"            -> strongest relative closeness preference
//   bike       "on my bike", "I'm biking", "cycling there"            -> moderate relative closeness preference
//   driving    "I'm driving", "I have a car", "I'll take an Uber",    -> the close-by bonus is removed (distance matters less)
//              "grab a Lyft", "a cab"                                  rideshare is NOT its own concept (owner): it is going by car
//   transit    "taking the train", "by bus", "on the subway"          -> NO ranking effect on miles: no transit data
// Rules (owner, LOCKED): ranking only, typed asks only, nothing stored, never sent to a business, never used for people; a mode is
// never turned into a travel time, and nothing claims a result is easier to reach. Search bounds are never widened by a mode
// (driving is not "willing to travel"; only the person's own distance words widen, constants/distanceWillingness.js, clamped).
// An explicit distance the person stated stays PRIMARY (owner review 2026-09-26): the mode then only REFINES, with a small weight
// (REFINE_WEIGHT, below every stated-distance lift) and never in the opposite direction (driving does not remove the close-by
// bonus when the person asked for something close). Two different modes in one ask ("walk or Uber") = unclear = null.
// Real travel time plugs in through services/travelTime.js. Seconds are NOT treated as miles: each routed result gets an absolute,
// normalized proximity (travelProximity: half-life per mode, no cutoff), which REPLACES the straight-line close-by bonus for that
// result; a result without a routed time keeps its place. Today no provider exists, so this always ranks on measured miles.

import { closeBonusOf } from './distanceWillingness';

// milesWeight: relative closeness lift on straight-line miles (no routing). timed: {weight, halfLifeMin} used only on real routed
// seconds. The half-lives are product defaults (the time at which proximity is half of its maximum), not measured norms.
export const TRANSPORT_MODES = [
  { key: 'walking', label: 'Walking', milesWeight: 2, timed: { weight: 2, halfLifeMin: 10 }, caption: 'Keeping it close since you\u2019re walking' },
  { key: 'bike', label: 'Bike', milesWeight: 1, timed: { weight: 1.5, halfLifeMin: 12 }, caption: 'Leaning closer since you\u2019re biking' },
  // Driving and rideshare/taxi are ONE mode (going by car); never split into separate product concepts.
  { key: 'driving', label: 'By car', dropCloseBonus: true, timed: { weight: 1, halfLifeMin: 15 }, caption: 'Not just the closest, since you\u2019re going by car' },
  // Transit ranks ONLY on real routed times; on miles alone it changes nothing and says nothing.
  { key: 'transit', label: 'Transit', timed: { weight: 1.5, halfLifeMin: 20 } },
];
// A mode's whole effect when the person ALSO stated a distance: below the smallest stated-distance lift (nearby = 1).
export const REFINE_WEIGHT = 0.5;
export const TRANSPORT_MODE_KEYS = TRANSPORT_MODES.map((m) => m.key);
const modeOf = (key) => TRANSPORT_MODES.find((m) => m.key === key) ?? null;

const WE = String.raw`(?:i'?m|i\s+am|we'?re|we\s+are|i'?ll\s+be|we'?ll\s+be)`;
const WILL = String.raw`(?:i'?ll|we'?ll|i\s+will|we\s+will|i\s+can|we\s+can|gonna|going\s+to|planning\s+to)`;
const PATTERNS = {
  // "walking" alone is an activity (Walking tag, "a walking tour"); only first-person travel framing counts.
  walking: [
    new RegExp(String.raw`\b${WE}\s+(?:just\s+)?(?:walking|on\s+foot)\b(?!\s+(?:tour|group|club|trail|path))`, 'i'),
    new RegExp(String.raw`\b${WILL}\s+(?:just\s+)?walk\b(?!\s+(?:around|in|through|along|by|the\s+dog|a\s|for\s))`, 'i'),
    /\b(?:on\s+foot|walking\s+there|walk(?:ing)?\s+over\s+there)\b/i,
  ],
  bike: [
    new RegExp(String.raw`\b${WE}\s+(?:biking|cycling|on\s+(?:my|our|a)\s+bikes?)\b`, 'i'),
    new RegExp(String.raw`\b${WILL}\s+(?:bike|cycle|ride\s+(?:my|our)\s+bikes?)\s+(?:there|over)\b`, 'i'),
    /\b(?:by\s+bike|on\s+(?:my|our)\s+bikes?|biking\s+there|cycling\s+there)\b/i,
  ],
  driving: [
    new RegExp(String.raw`\b${WE}\s+driving\b`, 'i'),
    new RegExp(String.raw`\b${WILL}\s+drive\b`, 'i'),
    /\b(?:i|we)\s+(?:have|got|'ve\s+got)\s+(?:a|the|my|our)\s+car\b/i,
    /\b(?:by\s+car|driving\s+there)\b/i,
    // rideshare / taxi = going by car
    /\b(?:take|taking|grab|grabbing|get|getting|call|calling|order|ordering)\s+(?:an?\s+)?(?:uber|lyft|cab|taxi|rideshare)\b/i,
    /\b(?:uber|lyft)(?:ing)?\s+(?:there|over)\b/i,
    /\b(?:by|in\s+an?)\s+(?:uber|lyft|cab|taxi|rideshare)\b/i,
  ],
  transit: [
    /\b(?:take|taking|catch|catching|ride|riding|on)\s+(?:the|a)\s+(?:train|bus|subway|metro|tube|tram|light\s+rail)\b/i,
    /\b(?:by|via)\s+(?:train|bus|subway|metro|tube|tram|transit|public\s+transport(?:ation)?)\b/i,
    /\bpublic\s+transit\b/i,
  ],
};
// "I'm not driving", "we won't take an Uber", "don't have a car" never name that mode.
const NEGATED = /(?:\bnot|n't|\bnever|\bno)\s+(?:\w+\s+){0,2}$/i;

export function transportModeFromText(text) {
  const t = typeof text === 'string' ? text : '';
  if (!t.trim()) return null;
  const found = new Set();
  for (const [key, res] of Object.entries(PATTERNS)) {
    for (const re of res) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
      let m;
      while ((m = g.exec(t))) {
        if (!NEGATED.test(t.slice(Math.max(0, m.index - 20), m.index))) { found.add(key); break; }
      }
      if (found.has(key)) break;
    }
  }
  const keys = [...found];
  return keys.length === 1 ? keys[0] : null;
}

// Caption only when the mode itself shaped the ranking: none when the person stated a distance (their caption speaks), none for
// transit (miles say nothing about transit).
export const transportModeCaption = (mode, { statedDistance = null } = {}) => (statedDistance ? null : modeOf(mode)?.caption ?? null);

const isNum = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

function relativeLift(value, all, weight) {
  const min = Math.min(...all);
  const max = Math.max(...all);
  return max === min ? weight : weight * (max - value) / (max - min);
}

// Absolute proximity in (0, 1] from real routed seconds: 1 at 0 min, 0.5 at the mode's half-life, smoothly toward 0 after.
// So 10 vs 20 minutes matters more than 50 vs 60, and a list that is all far away gets little lift. Never 0, never a cutoff.
export function travelProximity(seconds, mode) {
  const t = modeOf(mode)?.timed;
  if (!t || !isNum(seconds)) return null;
  return t.halfLifeMin / (t.halfLifeMin + seconds / 60);
}

// Re-scores only; never adds or removes a result.
//   travelTimes: Map(candidateKey -> seconds) from services/travelTime.js, or null. Used when it covers >= 2 results.
//   statedDistance: the person's own distance bucket (constants/distanceWillingness.js); when set, the mode only refines.
export function applyTransportMode(candidates, mode, travelTimes = null, { statedDistance = null, keyOf = candidateKey } = {}) {
  const m = modeOf(mode);
  if (!Array.isArray(candidates) || !m) return candidates;
  const refine = !!statedDistance;
  const secs = travelTimes instanceof Map ? candidates.map((c) => travelTimes.get(keyOf(c))) : [];
  const useTime = secs.filter(isNum).length >= 2;
  const miles = candidates.map((x) => x?.distanceMiles).filter(isNum);

  return candidates.map((c, i) => {
    let delta = 0;
    if (useTime) {
      // Routed: time proximity replaces the straight-line close-by bonus (unless a stated distance is primary). Unrouted: unchanged.
      if (!isNum(secs[i])) return c;
      delta = (refine ? REFINE_WEIGHT : m.timed.weight) * travelProximity(secs[i], mode);
      if (!refine) delta -= closeBonusOf(c);
    } else {
      if (m.milesWeight && isNum(c?.distanceMiles)) delta = relativeLift(c.distanceMiles, miles, refine ? REFINE_WEIGHT : m.milesWeight);
      if (m.dropCloseBonus && !refine) delta -= closeBonusOf(c);
    }
    return delta ? { ...c, score: (c.score ?? 0) + delta } : c;
  });
}

export const candidateKey = (c) => (c?.type && c?.id != null ? `${c.type}:${c.id}` : null);
