// What a business does NOT accommodate (owner item 86, 2026-09-26; migration 20270222). Matching removes a KNOWN conflict before
// it is shown: the business declared the restriction AND the person's own ask conflicts with it. Unknown on either side = kept.
// One new owner-declared list (`brand_partners.not_accommodated`); the rest of the owner's list is an EXISTING declaration, reused:
//   No children / No pets / 21+ only   -> not_accommodated (this file)
//   No large groups                    -> max_group_size (item 80)
//   Reservations required / No walk-ins -> booking_mode reservation_required / request_required (item 72)
//   Indoor only / Outdoor only         -> weather_setting indoor / outdoor (item 63)
// 21+ is the business's own house rule; Nearby never checks anyone's age and it gates nothing. It only keeps asks that involve
// children away. Service animals are not pets (service_animal_friendly never conflicts with No pets).
// The server applies the same rule to routing and auto-offers (_business_declines_request); a request the customer addressed to
// ONE business is never filtered. Deterministic, never AI.
import { bookingModeOf, NEEDS_BOOKING_FIRST } from './bookingMode';
import { cleanMaxGroupSize } from './businessCapabilities';
import { parseAskFacets } from './askFacets';
import { askedChildAges } from '../utils/suitedAges';

export const NOT_ACCOMMODATED_OPTIONS = [
  { key: 'no_children', label: 'No children', icon: '🚸', line: 'No children' },
  { key: 'no_pets', label: 'No pets', icon: '🐾', line: 'No pets' },
  { key: 'adults_21_plus', label: '21+ only', icon: '🔞', line: '21+ only' },
];
export const NOT_ACCOMMODATED_KEYS = NOT_ACCOMMODATED_OPTIONS.map((o) => o.key);
export const CHILD_ATTRIBUTES = ['kid_friendly', 'kid_menu', 'family_seating', 'stroller_friendly'];
export const PET_ATTRIBUTES = ['dog_friendly', 'pet_friendly'];
const NO_CHILD_KEYS = ['no_children', 'adults_21_plus'];

export function notAccommodatedOf(partner) {
  const list = Array.isArray(partner?.not_accommodated) ? partner.not_accommodated : [];
  return NOT_ACCOMMODATED_KEYS.filter((k) => list.includes(k));
}

// The owner's form check, mirroring the server trigger's messages. `next` = the keys the owner would have after the tap.
export function notAccommodatedProblem(next, partner) {
  const attrs = Array.isArray(partner?.attributes) ? partner.attributes : [];
  if (next.some((k) => NO_CHILD_KEYS.includes(k))) {
    if (attrs.some((a) => CHILD_ATTRIBUTES.includes(a))) {
      return "You said you don't accommodate children, so Family-friendly, Kids menu, Family seating and Stroller friendly can't be on too. Remove one of them first.";
    }
    if (partner?.suited_age_min != null || partner?.suited_age_max != null) return "You said you don't accommodate children, so clear the suited ages first.";
  }
  if (next.includes('no_pets') && attrs.some((a) => PET_ATTRIBUTES.includes(a))) {
    return "You said you don't allow pets, so Dog friendly and Pet friendly can't be on too. Remove one of them first.";
  }
  return null;
}

// Public profile line: "No children · No pets" / "21+ only"; null when nothing declared (hidden, never "Unknown").
export function notAccommodatedLine(partner) {
  const keys = notAccommodatedOf(partner);
  if (keys.length === 0) return null;
  return NOT_ACCOMMODATED_OPTIONS.filter((o) => keys.includes(o.key)).map((o) => o.line).join(' · ');
}

// ---- The ask side: only the person's own words (plus attributes the ask already carries) ----
const NEG_CHILDREN = /\b(?:no|without(?:\s+the)?|minus\s+the)\s+(?:kids?|children|child|little\s+ones?)\b|\b(?:kid|child)[- ]free\b|\badults?[- ]only\b|\bjust\s+(?:the\s+)?adults\b/gi;
const CHILDREN = /\b(?:kids?|kiddos?|children|child|toddlers?|bab(?:y|ies)|little\s+ones?|my\s+(?:sons?|daughters?)|our\s+(?:sons?|daughters?)|stroller)\b/i;
const WALK_IN = /\bwalk[- ]?ins?\b|\bjust\s+(?:show|walk|drop|turn)\s+(?:up|in|by)\b|\bno\s+(?:reservations?|booking)\b|\bwithout\s+(?:a\s+)?(?:reservation|booking)s?\b|\b(?:don'?t|do\s+not)\s+want\s+to\s+(?:book|reserve)\b/i;

// Children are part of the ask: their words ("with my kids", "my 5 year old"), or a child-facing attribute the ask carries.
export function childrenInAsk(text, attributes = []) {
  if (Array.isArray(attributes) && attributes.some((a) => CHILD_ATTRIBUTES.includes(a))) return true;
  if (typeof text !== 'string' || !text) return false;
  if (askedChildAges(text).length > 0) return true;
  return CHILDREN.test(text.replace(NEG_CHILDREN, ' '));
}
export const petsInAsk = (attributes = []) => Array.isArray(attributes) && attributes.some((a) => PET_ATTRIBUTES.includes(a));
export const walkInAsk = (text) => typeof text === 'string' && WALK_IN.test(text);

// Everything the ask says that a restriction can conflict with. Built once per ask.
export function restrictionAsk({ text = '', attributes = [], partySize = null } = {}) {
  const facets = parseAskFacets(text);
  const outdoorWanted = facets.environment === 'outdoor' || (Array.isArray(attributes) && attributes.includes('outdoor_seating'));
  return {
    children: childrenInAsk(text, attributes),
    pets: petsInAsk(attributes),
    partySize: Number.isInteger(partySize) && partySize > 0 ? partySize : null,
    walkIn: walkInAsk(text),
    // an indoor-only place conflicts with "outside"/"patio" or "nothing indoors"; an outdoor-only one with "indoors" or "nothing outdoors"
    rejectsIndoorOnly: outdoorWanted || facets.exclude.includes('indoor'),
    rejectsOutdoorOnly: facets.environment === 'indoor' || facets.exclude.includes('outdoor'),
  };
}
const askIsEmpty = (a) => !a || (!a.children && !a.pets && a.partySize == null && !a.walkIn && !a.rejectsIndoorOnly && !a.rejectsOutdoorOnly);

// The first declared conflict between a business and the ask, or null. `bookable` = a business result (a perk has no booking).
export function declinedBy(partner, ask, { bookable = true } = {}) {
  if (!partner || askIsEmpty(ask)) return null;
  const keys = notAccommodatedOf(partner);
  if (ask.children && keys.some((k) => NO_CHILD_KEYS.includes(k))) return 'children';
  if (ask.pets && keys.includes('no_pets')) return 'pets';
  const max = cleanMaxGroupSize(partner.max_group_size);
  if (ask.partySize != null && max != null && max < ask.partySize) return 'group';
  if (ask.rejectsIndoorOnly && partner.weather_setting === 'indoor') return 'indoor_only';
  if (ask.rejectsOutdoorOnly && partner.weather_setting === 'outdoor') return 'outdoor_only';
  if (bookable && ask.walkIn && NEEDS_BOOKING_FIRST.includes(bookingModeOf(partner))) return 'booking';
  return null;
}

export const DECLINE_LABELS = {
  children: "places that don't take children",
  pets: "places that don't allow pets",
  group: 'places too small for your group',
  indoor_only: 'indoor-only places',
  outdoor_only: 'outdoor-only places',
  booking: 'places that need a booking first',
};

// Removes business results and perks whose business declared a conflict with the ask. `partnerFor(c)` returns the candidate's
// partner row or null (unknown = kept). The caption names only what was really removed, so nothing disappears silently.
export function applyRestrictionsToCandidates(candidates, ask, partnerFor, { isBusiness = () => true } = {}) {
  if (askIsEmpty(ask)) return { items: candidates, caption: null };
  const removed = [];
  const items = candidates.filter((c) => {
    const partner = partnerFor(c);
    if (!partner) return true;
    const why = declinedBy(partner, ask, { bookable: isBusiness(c) });
    if (why && !removed.includes(why)) removed.push(why);
    return !why;
  });
  if (removed.length === 0) return { items, caption: null };
  const parts = removed.map((k) => DECLINE_LABELS[k]);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return { items, caption: `Leaving out ${list}` };
}
