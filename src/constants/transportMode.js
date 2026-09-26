// Transportation mode (2026-09-26, owner decision "both, staged": words now, real travel time designed but NOT built).
// How the person said they are getting there, read ONLY from their own typed words (deterministic, never AI, never inferred
// from the time of day, a profile or behavior). null = not said = ranking unchanged.
//   walking    "I'm walking", "on foot", "we'll walk over"            -> strongest relative closeness preference
//   bike       "on my bike", "I'm biking", "cycling there"            -> moderate relative closeness preference
//   driving    "I'm driving", "I have a car", "I'll drive"            -> the close-by bonus is removed (distance matters less)
//   rideshare  "I'll take an Uber", "grab a Lyft", "a cab"            -> same as driving
//   transit    "taking the train", "by bus", "on the subway"          -> NO ranking effect: we have no transit accessibility data
// Rules (owner, LOCKED): ranking only, typed asks only, nothing stored, never sent to a business, never used for people; a mode is
// never turned into a travel time, and nothing claims a result is easier to reach. Search bounds are never widened by a mode
// (driving is not "willing to travel"; only the person's own distance words widen, constants/distanceWillingness.js).
// A distance the person stated outranks the mode: "I'm driving but want something 5 minutes away" ranks as very nearby, and the
// mode then adds nothing (no double counting). Two different modes in one ask ("walk or Uber") = unclear = null.
// Real travel time plugs in through services/travelTime.js: when it supplies seconds for the results, closeness is measured on
// those instead of miles, with the same relative weights. Today no provider exists, so this always ranks on measured miles.

import { closeBonusOf } from './distanceWillingness';

export const TRANSPORT_MODES = [
  { key: 'walking', label: 'Walking', closenessWeight: 2, caption: 'Keeping it close since you’re walking' },
  { key: 'bike', label: 'Bike', closenessWeight: 1, caption: 'Leaning closer since you’re biking' },
  { key: 'driving', label: 'Driving', dropCloseBonus: true, caption: 'Not just the closest, since you’re driving' },
  { key: 'rideshare', label: 'Rideshare', dropCloseBonus: true, caption: 'Not just the closest, since you’re taking a ride' },
  // Transit ranks ONLY when real travel times exist (timedOnlyWeight); on miles alone it changes nothing.
  { key: 'transit', label: 'Transit', timedOnlyWeight: 1 },
];
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
  ],
  rideshare: [
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
  // driving + rideshare both say "distance matters less": not a conflict.
  const keys = [...found];
  if (keys.length === 2 && found.has('driving') && found.has('rideshare')) return 'rideshare';
  return keys.length === 1 ? keys[0] : null;
}

// The mode that actually changes ranking for this ask: none when the person also stated a distance (their distance wins).
export function effectiveTransportMode(mode, distanceWillingness) {
  if (!TRANSPORT_MODE_KEYS.includes(mode) || distanceWillingness) return null;
  return mode;
}

// Caption only when the mode really changed the ranking; transit has none (it changes nothing).
export const transportModeCaption = (mode) => modeOf(mode)?.caption ?? null;

const isNum = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

// Closeness lift relative to the other results. `measure(c)` is either real travel seconds (from services/travelTime.js) or miles.
function relativeLift(value, all, weight) {
  const min = Math.min(...all);
  const max = Math.max(...all);
  return max === min ? weight : weight * (max - value) / (max - min);
}

// Re-scores only; never adds or removes a result. `travelTimes` (Map candidateKey -> seconds, or null) comes from
// services/travelTime.js; when it covers at least two results, closeness uses those seconds for the results it covers and leaves
// the rest unchanged (never mixes miles and seconds in one comparison). Transit ranks ONLY on real travel times.
export function applyTransportMode(candidates, mode, travelTimes = null, keyOf = candidateKey) {
  const m = modeOf(mode);
  if (!Array.isArray(candidates) || !m) return candidates;
  const secs = travelTimes instanceof Map ? candidates.map((c) => travelTimes.get(keyOf(c))) : [];
  const timed = secs.filter(isNum);
  const useTime = timed.length >= 2;
  const weight = m.closenessWeight ?? (useTime ? m.timedOnlyWeight ?? 0 : 0);
  const miles = candidates.map((x) => x?.distanceMiles).filter(isNum);

  return candidates.map((c, i) => {
    let delta = 0;
    if (weight && useTime) {
      if (isNum(secs[i])) delta = relativeLift(secs[i], timed, weight);
    } else if (weight && isNum(c?.distanceMiles)) {
      delta = relativeLift(c.distanceMiles, miles, weight);
    }
    if (m.dropCloseBonus) delta -= closeBonusOf(c);
    return delta ? { ...c, score: (c.score ?? 0) + delta } : c;
  });
}

export const candidateKey = (c) => (c?.type && c?.id != null ? `${c.type}:${c.id}` : null);
