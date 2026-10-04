// Owner item 189 (2026-10-04, LOCKED): "Places to go" = fallback ENRICHMENT of a typed ask, never a discovery surface.
// When a typed ask's own words name an activity on the fixed allowlist below, the ask also shows up to 3 nearby public places
// (Google Places) in a separate section BELOW Nearby's own results. The allowlist is the only gate; no AI decides it.
//   - Never mixed into or ranked against Nearby results; never "our pick", never a reason, availability or booking claim.
//   - A place is never a business, a business opportunity, a request target, a night-plan stop or a Surprise Me row.
//   - Nothing is stored, logged or learned from the places or their taps (the tap only opens directions).
//   - The external search runs only after the person submitted a qualifying typed ask.
// Pure: no network, no storage.
import { tagsInText } from '../constants/categorySynonyms';
import { TRAVEL_WORDS } from './planAsk';
import { contextItem, recommendationContext } from './recommendationContext';

export const PLACES_TO_GO_ACTIVITIES = Object.freeze([
  'Walking', 'Hiking', 'Running', 'Trails', 'Parks', 'Beaches', 'Picnics', 'Scenic Views', 'Gardens', 'Playgrounds',
]);
export const MAX_PLACES_TO_GO = 3;

// Everyday ways of saying "a walk" that the taxonomy does not map to Walking (it only knows the word "walking"). Used ONLY by
// this gate, never as a category synonym, so the typed ask's own results are unchanged. Whole phrases, so "walk-in" and
// "walking distance" (how far, item 69) never qualify.
const WALK_PHRASES = /\b(?:(?:go|going|went)\s+(?:for\s+)?a\s+walk|take\s+a\s+walk|for\s+a\s+walk|a\s+stroll|go\s+for\s+a\s+stroll|stroll(?:ing)?\s+(?:by|along|around|through))\b/i;

// The allowlisted activity the person's own words name, or null. Deterministic: canonical tags and their existing synonyms
// (tagsInText), travel/distance phrasing removed first ("within walking distance" is how far, not a walk).
export function placesToGoActivity(text) {
  const t = String(text ?? '');
  if (!t.trim()) return null;
  const cleaned = t.replace(TRAVEL_WORDS, ' ');
  const hit = tagsInText(cleaned).find(({ tag }) => PLACES_TO_GO_ACTIVITIES.includes(tag));
  if (hit) return hit.tag;
  return WALK_PHRASES.test(cleaned) ? 'Walking' : null;
}

// Owner item 190 (2026-10-04, LOCKED): a typed ask whose words name a public-place activity (the SAME allowlist, never a second
// definition) is fulfilled without a business, so its results offer no "Ask nearby businesses". Presentation only: business
// matching, routing, ranking and eligibility are untouched.
export function askBusinessesFits(text) {
  return placesToGoActivity(text) == null;
}

// At most 3 places, nearest measured first (unmeasured after), shown through the shared place context: name, distance and a
// directions destination only. Places with no name or no way to get directions are dropped.
export function pickPlacesToGo(places, language) {
  const seen = new Set();
  return (Array.isArray(places) ? places : [])
    .filter((p) => p && p.name && (p.placeId == null || !seen.has(p.placeId)) && (seen.add(p.placeId), true))
    .map((p) => ({ place: p, ctx: recommendationContext(contextItem('place', p), { language }) }))
    .filter(({ ctx }) => !!ctx.destination)
    .sort((a, b) => (a.place.distanceMiles ?? Infinity) - (b.place.distanceMiles ?? Infinity))
    .slice(0, MAX_PLACES_TO_GO)
    .map(({ place, ctx }) => ({ id: place.placeId ?? place.name, name: place.name, context: ctx.context ?? null, destination: ctx.destination }));
}
