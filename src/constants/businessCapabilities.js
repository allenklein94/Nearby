// Business capabilities (owner item 80, LOCKED 2026-09-26): what a business can DO for a request, as opposed to what it is
// (category) or what it is like (qualities). NOT a second taxonomy or store: a capability is a NAMED VIEW over the one shared
// attribute vocabulary (businessAttributes.js), declared by the owner, never inferred:
//   Private events = private_dining · Groups = group_friendly · Outdoor dining = outdoor_seating · Catering = catering
// plus one structured fact, `brand_partners.max_group_size` (largest group the business can host, TOTAL people, NULL = not
// said; migration 20270216). Reservations are NOT a capability: they stay the booking mode (constants/bookingMode.js).
// Delivery and Takeout are deliberately absent everywhere (outside the Nearby loop: no capability, category, filter, attribute
// or ranking signal).
//
// Typed asks, ranking only (never a filter; unknown = neutral):
//   - capacity: a party size the person stated vs the business's declared max: covers it +2 ("Can host your group"), known too
//     small -4 (strongly de-prioritized), unknown 0. The party size is used as said, never incremented.
//   - private events: ONLY from the person's own explicit words ("private room", "private dining", "private party", "private
//     event", "private space", "a private birthday"...), never from party size, an occasion or a large group; a business that
//     declared Private events gets +2 and the reason "Hosts private events".
//   - catering: only from the words ("catering", "cater our party"); a business that declared Catering gets +2, "Offers catering".
// The number and the capabilities are never put in a business-facing payload; routing reads the number server-side only. The
// public business profile shows the number as "Largest group · Up to 40 people" (maxGroupLine), only when the owner set it.
import { attributesFromAsk, parseAskFacets } from './askFacets';

export const CAPABILITIES = [
  { key: 'private_events', attribute: 'private_dining', label: 'Private events', icon: '🥂' },
  { key: 'groups', attribute: 'group_friendly', label: 'Groups', icon: '👥' },
  { key: 'outdoor_dining', attribute: 'outdoor_seating', label: 'Outdoor dining', icon: '🌤️' },
  { key: 'catering', attribute: 'catering', label: 'Catering', icon: '🍱' },
];
export const CAPABILITY_ATTRIBUTE_KEYS = CAPABILITIES.map((c) => c.attribute);
// Out of the product loop on purpose; a test keeps them out of every vocabulary.
export const EXCLUDED_CAPABILITIES = ['delivery', 'takeout'];

// The capabilities a business declared, from its own attributes (never from its category).
export function capabilitiesOf(row) {
  const attrs = Array.isArray(row?.attributes) ? row.attributes : [];
  return CAPABILITIES.filter((c) => attrs.includes(c.attribute));
}

// Largest group: an integer 1-5000 the owner typed, else null (blank = not said, never a default).
export const MAX_GROUP_SIZE_LIMIT = 5000;
export function cleanMaxGroupSize(value) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isInteger(n) && n >= 1 && n <= MAX_GROUP_SIZE_LIMIT ? n : null;
}
// The public profile line (owner, 2026-09-26): "Up to 40 people" -- total people, everyone counted; null when not set (the row is
// hidden, never "Unknown").
export function maxGroupLine(value) {
  const n = cleanMaxGroupSize(value);
  if (n === null) return null;
  return `Up to ${n} ${n === 1 ? 'person' : 'people'}`;
}
export function maxGroupSizeProblem(text) {
  if (text === null || text === undefined || String(text).trim() === '') return null;
  return cleanMaxGroupSize(text) === null ? `Enter a whole number from 1 to ${MAX_GROUP_SIZE_LIMIT}, or leave it blank.` : null;
}

const PRIVATE_EVENT_RE = /(?<!\b(?:no|not|don'?t\s+need\s+a|nothing)\s)\bprivate\s+(?:room|rooms|dining|party|parties|event|events|space|area|function|celebration|(?:birthday|anniversary|engagement|graduation|retirement|holiday)(?:\s+(?:party|dinner|lunch|celebration))?|dinner|lunch|gathering|booking|hire)\b|\b(?:host|hosting|throw|throwing|book|booking)\s+a\s+private\b|\bbuy[- ]?out\b|\bexclusive\s+use\b/i;
const CATERING_RE = /(?<!\bno\s)\bcater(?:ing|ed|er|ers)?\b/i;

export const privateEventAsk = (text) => typeof text === 'string' && PRIVATE_EVENT_RE.test(text);
export const cateringAsk = (text) => typeof text === 'string' && CATERING_RE.test(text);

// The two capabilities that are only ever asked for in words: an AI-extracted private_dining / catering the words do not back is
// dropped (a 20-person birthday is not a private-event ask). Everything else passes through unchanged.
export function wordsBackedAttributes(attributes, text) {
  const list = Array.isArray(attributes) ? attributes : [];
  return list.filter((a) => (a === 'private_dining' ? privateEventAsk(text) : a === 'catering' ? cateringAsk(text) : true));
}

export const CAPACITY_FIT_POINTS = 2;
export const CAPACITY_TOO_SMALL_POINTS = -4;
export const PRIVATE_EVENTS_POINTS = 2;
export const CATERING_POINTS = 2;

// Item 81: capacity per SPACE (migration 20270217), each TOTAL people, owner-declared, NULL = not said. A space counts only while
// its capability is declared (a private room without Private events is ignored), and can never exceed the overall maximum.
export const SPACES = [
  { key: 'private_room', attribute: 'private_dining', column: 'private_room_capacity', label: 'Private room' },
  { key: 'outdoor', attribute: 'outdoor_seating', column: 'outdoor_capacity', label: 'Outdoor area' },
];
export function spaceCapacity(partner, spaceKey) {
  const s = SPACES.find((x) => x.key === spaceKey);
  if (!s || !(Array.isArray(partner?.attributes) && partner.attributes.includes(s.attribute))) return null;
  return cleanMaxGroupSize(partner?.[s.column]);
}
// Profile lines, only for declared spaces with a size: [{ key, label: 'Private room', line: 'Up to 20 people' }].
export function spaceCapacityLines(partner) {
  return SPACES.map((s) => ({ key: s.key, label: s.label, line: maxGroupLine(spaceCapacity(partner, s.key)) })).filter((x) => x.line);
}
// The owner's own form check, mirroring the server: a space no larger than the overall maximum.
export function spaceCapacityProblem(text, maxGroup) {
  const basic = maxGroupSizeProblem(text);
  if (basic) return basic;
  const n = cleanMaxGroupSize(text);
  const max = cleanMaxGroupSize(maxGroup);
  return n !== null && max !== null && n > max ? `This space can't hold more than your largest group (${max}). Raise that first.` : null;
}

// "patio for 12", "dinner outside for 12" (never "nothing outdoors"): the ask wants the outdoor area.
export const outdoorSpaceAsk = (text) => typeof text === 'string'
  && (attributesFromAsk(text).includes('outdoor_seating') || parseAskFacets(text).environment === 'outdoor');

// partySize = the total people the person said; never adds the host or anyone else. Every KNOWN limit that applies is checked:
// the overall maximum, plus the private room when a private event was asked for and the outdoor area when outside was asked for.
// Any known limit below the party = too small; otherwise a known limit that covers it = fits; nothing known = neutral.
export function groupCapacityFit(partner, partySize, { privateAsk = false, outdoorAsk = false } = {}) {
  if (!Number.isInteger(partySize) || partySize < 1) return { delta: 0, reason: null };
  const limits = [{ n: cleanMaxGroupSize(partner?.max_group_size), reason: 'Can host your group' }];
  if (privateAsk) limits.push({ n: spaceCapacity(partner, 'private_room'), reason: 'Private room fits your group' });
  if (outdoorAsk) limits.push({ n: spaceCapacity(partner, 'outdoor'), reason: 'Outdoor area fits your group' });
  const known = limits.filter((l) => l.n !== null);
  if (known.length === 0) return { delta: 0, reason: null };
  if (known.some((l) => l.n < partySize)) return { delta: CAPACITY_TOO_SMALL_POINTS, reason: null };
  // the most specific space that fits names the reason ("Private room fits your group" over "Can host your group")
  return { delta: CAPACITY_FIT_POINTS, reason: known[known.length - 1].reason };
}
// Kept for the overall maximum alone (item 80).
export const capacityFit = (maxGroup, partySize) => groupCapacityFit({ max_group_size: maxGroup }, partySize);

// One pass over business candidates carrying their partner row (`businessPartner`: attributes + capacities).
export function applyCapabilitiesToCandidates(candidates, { partySize = null, text = '' } = {}) {
  const wantPrivate = privateEventAsk(text);
  const wantCatering = cateringAsk(text);
  const wantOutdoor = outdoorSpaceAsk(text);
  const size = Number.isInteger(partySize) && partySize > 0 ? partySize : null;
  if (!wantPrivate && !wantCatering && size === null) return candidates;
  return candidates.map((c) => {
    const partner = c?.businessPartner;
    if (!partner) return c;
    const attrs = Array.isArray(partner.attributes) ? partner.attributes : [];
    let delta = 0;
    const reasons = [];
    if (wantPrivate && attrs.includes('private_dining')) { delta += PRIVATE_EVENTS_POINTS; reasons.push('Hosts private events'); }
    if (wantCatering && attrs.includes('catering')) { delta += CATERING_POINTS; reasons.push('Offers catering'); }
    const cap = groupCapacityFit(partner, size, { privateAsk: wantPrivate, outdoorAsk: wantOutdoor });
    delta += cap.delta;
    if (cap.reason) reasons.push(cap.reason);
    if (!delta) return c;
    // A space that fits the group, or an explicitly asked capability, leads; a plain overall fit keeps an existing line.
    const lead = reasons.find((r) => r !== 'Can host your group');
    return { ...c, score: (c.score ?? 0) + delta, subtitle: lead ?? c.subtitle ?? reasons[0] ?? null };
  });
}
