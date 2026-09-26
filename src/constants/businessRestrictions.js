// What a business does NOT accommodate (owner item 86, 2026-09-26; migration 20270222). Matching removes a KNOWN conflict before
// it is shown: the business declared the restriction AND the person's own ask conflicts with it. Unknown on either side = kept.
// One new owner-declared list (`brand_partners.not_accommodated`); the rest of the owner's list is an EXISTING declaration, reused:
//   No children / No pets / 21+ only   -> not_accommodated (this file)
//   No large groups                    -> max_group_size (item 80)
//   Reservations required / No walk-ins -> booking_mode reservation_required / request_required (item 72)
//   Indoor only / Outdoor only         -> weather_setting indoor / outdoor (item 63)
// 21+ is the business's own house rule; Nearby never checks anyone's age and it gates nothing. It only keeps asks that involve
// children away. Service animals are not pets (service_animal_friendly never conflicts with No pets).
// One rule on the server (_business_declines) serves typed asks, routing and auto-offers; a request the customer addressed to ONE
// business is never filtered. Deterministic, never AI.
import { parseAskFacets, attributesFromAsk } from './askFacets';
import { askedChildAges } from '../utils/suitedAges';

export const NOT_ACCOMMODATED_OPTIONS = [
  { key: 'no_children', label: 'No children', icon: '🚸', line: 'No children' },
  { key: 'no_pets', label: 'No pets', icon: '🐾', line: 'No pets' },
  { key: 'adults_21_plus', label: '21+ only', icon: '🔞', line: '21+ only' },
];
export const NOT_ACCOMMODATED_KEYS = NOT_ACCOMMODATED_OPTIONS.map((o) => o.key);
export const CHILD_ATTRIBUTES = ['kid_friendly', 'kid_menu', 'family_seating', 'stroller_friendly'];
export const PET_ATTRIBUTES = ['dog_friendly', 'pet_friendly'];

export function notAccommodatedOf(partner) {
  const list = Array.isArray(partner?.not_accommodated) ? partner.not_accommodated : [];
  return NOT_ACCOMMODATED_KEYS.filter((k) => list.includes(k));
}

// Save-time contradictions (No children vs Family-friendly, Indoor only vs Outdoor dining...) are decided ONLY by the server
// trigger _check_business_not_accommodated (migrations 20270222 + 20270224); the owner sees its message as written.

// Public profile line: "No children · No pets" / "21+ only"; null when nothing declared (hidden, never "Unknown").
export function notAccommodatedLine(partner) {
  const keys = notAccommodatedOf(partner);
  if (keys.length === 0) return null;
  return NOT_ACCOMMODATED_OPTIONS.filter((o) => keys.includes(o.key)).map((o) => o.line).join(' · ');
}

// ---- The ask side: ONLY the person's own words ----
// Owner decision (2026-09-26): a restriction applies only when the ask explicitly raises it. "Dinner with my kids" -> children;
// "dinner tonight" -> nothing. "Pet-friendly restaurant" -> pets; "restaurant tonight" -> nothing. "Nightlife" never implies 21+.
// Never from AI-extracted attributes, a default (a date's assumed 2 people), a category or an occasion.
// The CONFLICT decision is not made here: the server's one rule (_business_declines, migration 20270223) decides it for typed asks
// (get_declined_businesses), routing and auto-offers alike. This file only turns words into facts and applies the answer.
const NEG_CHILDREN = /\b(?:no|without(?:\s+the)?|minus\s+the)\s+(?:kids?|children|child|little\s+ones?)\b|\b(?:kid|child)[- ]free\b|\badults?[- ]only\b|\bjust\s+(?:the\s+)?adults\b/gi;
const CHILDREN = /\b(?:kids?|kiddos?|children|child|toddlers?|bab(?:y|ies)|little\s+ones?|my\s+(?:sons?|daughters?)|our\s+(?:sons?|daughters?)|stroller|kid[- ]friendly|family[- ]friendly|kids?\s+menu)\b/i;
const WALK_IN = /\bwalk[- ]?ins?\b|\bjust\s+(?:show|walk|drop|turn)\s+(?:up|in|by)\b|\bno\s+(?:reservations?|booking)\b|\bwithout\s+(?:a\s+)?(?:reservation|booking)s?\b|\b(?:don'?t|do\s+not)\s+want\s+to\s+(?:book|reserve)\b/i;

export function childrenInAsk(text) {
  if (typeof text !== 'string' || !text) return false;
  if (askedChildAges(text).length > 0) return true;
  return CHILDREN.test(text.replace(NEG_CHILDREN, ' '));
}
export const petsInAsk = (text) => attributesFromAsk(text).some((a) => PET_ATTRIBUTES.includes(a));
export const walkInAsk = (text) => typeof text === 'string' && WALK_IN.test(text);

// The facts the person's words state. `statedPartySize` = a number they said, never a default.
export function restrictionAsk(text, statedPartySize = null) {
  const words = typeof text === 'string' ? text : '';
  const facets = parseAskFacets(words);
  return {
    partySize: Number.isInteger(statedPartySize) && statedPartySize > 0 ? statedPartySize : null,
    children: childrenInAsk(words),
    pets: petsInAsk(words),
    // "outside" / "patio" / "nothing indoors" conflicts with indoor only; "indoors" / "nothing outdoors" with outdoor only
    wantsOutdoor: facets.environment === 'outdoor' || attributesFromAsk(words).includes('outdoor_seating') || facets.exclude.includes('indoor'),
    wantsIndoor: facets.environment === 'indoor' || facets.exclude.includes('outdoor'),
    walkIn: walkInAsk(words),
  };
}
export const askRaisesRestriction = (a) => !!a && (a.partySize != null || a.children || a.pets || a.wantsOutdoor || a.wantsIndoor || a.walkIn);

export const DECLINE_LABELS = {
  children: "places that don't take children",
  pets: "places that don't allow pets",
  group: 'places too small for your group',
  indoor_only: 'indoor-only places',
  outdoor_only: 'outdoor-only places',
  booking: 'places that need a booking first',
};

// Applies the server's answer (`declined`: Map partnerId -> reason). A booking conflict removes only BUSINESS results: a perk has
// no booking. Anything not in the map (compatible, unknown, or the lookup failed) is kept. The caption names only what was removed.
export function applyRestrictionsToCandidates(candidates, declined, { partnerIdOf = (c) => c.partnerId, isBusiness = () => true } = {}) {
  if (!(declined instanceof Map) || declined.size === 0) return { items: candidates, caption: null };
  const removed = [];
  const items = candidates.filter((c) => {
    const id = partnerIdOf(c);
    const why = id ? declined.get(id) : null;
    if (!why || (why === 'booking' && !isBusiness(c))) return true;
    if (!removed.includes(why)) removed.push(why);
    return false;
  });
  if (removed.length === 0) return { items, caption: null };
  const parts = removed.map((k) => DECLINE_LABELS[k] ?? 'places that can\'t take this request');
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return { items, caption: `Leaving out ${list}` };
}
