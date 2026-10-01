// Adaptive personal proximity, owner item 137 (2026-10-01). "Nearby" is not one radius: this learns, per category, how far
// THIS person usually goes, from real choices only (joining a gathering, accepting a business offer; the trip is stored on
// the private behavior log, migration 20270255). It is a learned PREFERENCE, never a rule:
//   - it only nudges the ORDER of results that are already eligible (one small part in the weakest ranking tier); it never
//     widens a search, never removes a result, and never applies when the person's words state a distance or a way of
//     travelling (constants/distanceWillingness.js, constants/transportMode.js stay in control);
//   - it is per category: coffee trips say nothing about dinner (no fallback to the group or to other categories);
//   - too little evidence, or choices that disagree, = nothing learned = the default ordering;
//   - an explicit maximum the person set (today: "things to do" notification distance) caps what is learned;
//   - the most recent choices count, so it adapts as behavior changes; the 90-day log window bounds it.
// It is monotonic in distance: on its own it can never put a farther result above a closer one of the same category.
// Nothing here reaches a business (the log is owner-only, see behaviorPrivacyGuard.test.js).

export const MIN_CHOICES = 3; // fewer real choices in a category = not enough evidence
export const RECENT_CHOICES = 12; // only the newest choices per category count
const MIXED_RATIO = 4; // upper quartile more than 4x the lower one...
const MIXED_MIN_GAP_MILES = 2; // ...and more than 2 mi apart = the choices disagree
const WITHIN_FACTOR = 1.25; // a little past the usual trip still reads as usual
const WITHIN_FLOOR_MILES = 0.3; // GPS noise: a 0.1 mi habit still counts a short walk as usual
const BEYOND_FACTOR = 3; // well past the usual trip...
const BEYOND_MIN_EXTRA_MILES = 3; // ...and at least 3 mi past it
export const LEARNED_PROXIMITY_POINTS = 1; // modest: below every ask-specific lift (2)

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// rows: [{ category, trip_miles, event_type, created_at }] (get_my_trip_choices) -> { [tag]: profile }.
// profile = { status: 'learned', typicalMiles, count, sources } | { status: 'insufficient' | 'mixed', count }.
export function learnProximity(rows, { maxMiles = null } = {}) {
  const byTag = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.trip_miles == null || r.trip_miles === '') continue; // no trip recorded (never read as 0 mi)
    const miles = Number(r.trip_miles);
    if (!r?.category || !Number.isFinite(miles) || miles < 0) continue;
    const list = byTag.get(r.category) ?? [];
    list.push({ miles, at: new Date(r.created_at ?? 0).getTime() || 0, source: r.event_type ?? null });
    byTag.set(r.category, list);
  }
  const cap = Number.isFinite(Number(maxMiles)) && Number(maxMiles) > 0 ? Number(maxMiles) : null;
  const out = {};
  for (const [tag, list] of byTag) {
    const recent = list.sort((a, b) => b.at - a.at).slice(0, RECENT_CHOICES);
    if (recent.length < MIN_CHOICES) { out[tag] = { status: 'insufficient', count: recent.length }; continue; }
    const sorted = recent.map((c) => c.miles).sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    if (q3 > Math.max(q1, 0.1) * MIXED_RATIO && q3 - q1 > MIXED_MIN_GAP_MILES) { out[tag] = { status: 'mixed', count: recent.length }; continue; }
    let typical = Math.round(quantile(sorted, 0.5) * 10) / 10;
    if (cap != null && typical > cap) typical = cap; // an explicit maximum is never exceeded by what was learned
    const sources = {};
    for (const c of recent) if (c.source) sources[c.source] = (sources[c.source] ?? 0) + 1;
    out[tag] = { status: 'learned', typicalMiles: typical, count: recent.length, sources };
  }
  return out;
}

// The learned part for one result: +1 within the person's usual trip for that category, -1 well beyond it, else 0.
// Unknown distance, no category or no learned profile = 0 (the default behavior).
export function learnedProximityDelta(distanceMiles, profile) {
  if (profile?.status !== 'learned' || typeof distanceMiles !== 'number' || !Number.isFinite(distanceMiles) || distanceMiles < 0) return 0;
  const usual = profile.typicalMiles;
  if (distanceMiles <= Math.max(usual * WITHIN_FACTOR, WITHIN_FLOOR_MILES)) return LEARNED_PROXIMITY_POINTS;
  if (distanceMiles > Math.max(usual * BEYOND_FACTOR, usual + BEYOND_MIN_EXTRA_MILES)) return -LEARNED_PROXIMITY_POINTS;
  return 0;
}

// The one lookup every surface uses: the result's own leaf category (exact tag, never its group).
export function learnedProximityFor(learned, tag, distanceMiles) {
  if (!learned || !tag) return 0;
  return learnedProximityDelta(distanceMiles, learned[tag]);
}

// The explicit words win: a stated distance or way of travelling turns learning off for that ask.
export function learnedProximityApplies({ distanceWillingness = null, transportMode = null } = {}) {
  return !distanceWillingness && !transportMode;
}

// The typed-ask pass: re-scores only, never adds or removes a result. No learned profile = the same array.
export function applyLearnedProximity(candidates, learned) {
  if (!Array.isArray(candidates) || !learned || Object.keys(learned).length === 0) return candidates;
  return candidates.map((c) => {
    const delta = learnedProximityFor(learned, c?.category ?? null, c?.distanceMiles);
    return delta ? { ...c, score: (c.score ?? 0) + delta } : c;
  });
}

// Settings' "How far you usually go" rows: only what was really learned, most-used first. Insufficient / mixed are not shown
// (nothing is being applied for them).
export function usualTripRows(learned) {
  return Object.entries(learned ?? {})
    .filter(([, p]) => p?.status === 'learned')
    .map(([category, p]) => ({ category, typicalMiles: p.typicalMiles, count: p.count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}
