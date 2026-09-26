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

// partySize = the total people the person said; maxGroup = the business's declared total. Never adds the host or anyone else.
export function capacityFit(maxGroup, partySize) {
  const max = cleanMaxGroupSize(maxGroup);
  if (max === null || !Number.isInteger(partySize) || partySize < 1) return { delta: 0, reason: null };
  return max >= partySize ? { delta: CAPACITY_FIT_POINTS, reason: 'Can host your group' } : { delta: CAPACITY_TOO_SMALL_POINTS, reason: null };
}

// One pass over business candidates carrying their partner row (`businessPartner`: attributes + max_group_size).
export function applyCapabilitiesToCandidates(candidates, { partySize = null, text = '' } = {}) {
  const wantPrivate = privateEventAsk(text);
  const wantCatering = cateringAsk(text);
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
    const cap = capacityFit(partner.max_group_size, size);
    delta += cap.delta;
    if (cap.reason) reasons.push(cap.reason);
    if (!delta) return c;
    // An explicitly asked capability is the ask's own words, so its reason leads; a capacity fit alone keeps an existing line.
    const lead = reasons.find((r) => r !== 'Can host your group');
    return { ...c, score: (c.score ?? 0) + delta, subtitle: lead ?? c.subtitle ?? reasons[0] ?? null };
  });
}
