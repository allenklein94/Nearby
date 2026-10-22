// Owner decision 2026-10-22 ("make Nearby useful first"): the "Also nearby (not a Nearby partner)" row under a typed ask.
// ONE rule for when it shows and what it may contain. Pure: no network, no storage.
//   - Only for an ask with a resolved category, never a public-place ask (item 189's "Places to go" covers those), never a
//     people ask, never a never-learned (sensitive) category: only the canonical category name is sent to Google, never the
//     person's typed words.
//   - Only when Nearby's own partner results are too few (< ALSO_NEARBY_MIN_PARTNERS distinct partners).
//   - Below Nearby's results, never ranked with them; name, distance and directions only (no Ask, offer, booking, reason).
//   - A Google place that IS a Nearby partner is dropped (`isPartnerPlace`), so the label "not a Nearby partner" stays true.
import { askBusinessesFits, pickPlacesToGo } from './placesToGo';
import { isNeverLearnedCategory } from '../constants/neverLearned';
import { straightLineMiles } from '../services/places';

export const ALSO_NEARBY_MIN_PARTNERS = 3;
export const MAX_ALSO_NEARBY = 3;
const PEOPLE_TAGS = Object.freeze(['Make New Friends', 'Dating']);
// Within ~160 m and the same name = the same business.
const SAME_PLACE_MILES = 0.1;

export function partnerResultCount(items) {
  const ids = new Set();
  for (const it of Array.isArray(items) ? items : []) if (it && it.partnerId) ids.add(it.partnerId);
  return ids.size;
}

// The category name to search Google for, or null = no row.
export function alsoNearbyCategory({ typedText, classifyResult, items } = {}) {
  const tag = classifyResult?.category;
  if (!tag || typeof tag !== 'string') return null;
  if (!askBusinessesFits(typedText)) return null;
  if (PEOPLE_TAGS.includes(tag) || isNeverLearnedCategory(tag)) return null;
  if (partnerResultCount(items) >= ALSO_NEARBY_MIN_PARTNERS) return null;
  return tag;
}

function normalName(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|and)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

// Whether a Google place is one of Nearby's partners (close by AND one name contains the other).
export function isPartnerPlace(place, partners) {
  const pn = normalName(place?.name);
  if (!pn) return false;
  return (Array.isArray(partners) ? partners : []).some((b) => {
    const bn = normalName(b?.name);
    if (!bn) return false;
    const miles = straightLineMiles(place.latitude, place.longitude, b.latitude, b.longitude);
    return miles != null && miles <= SAME_PLACE_MILES && (pn.includes(bn) || bn.includes(pn));
  });
}

export function withoutPartnerPlaces(places, partners) {
  return (Array.isArray(places) ? places : []).filter((p) => !isPartnerPlace(p, partners));
}

// The rows to show: partners removed, then item 189's one place shaping (nearest first, directions only), at most 3.
export function pickAlsoNearby(places, partners, language) {
  return pickPlacesToGo(withoutPartnerPlaces(places, partners), language).slice(0, MAX_ALSO_NEARBY);
}
