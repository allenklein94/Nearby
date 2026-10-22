// Where a stored location came from. ONE rule for Create's gathering point, the business sign-up, the business profile's
// pin and the pin screens. Pure: no network, no storage.
// Owner decisions 2026-10-22 (final, Option B, LOCKED): Google's terms allow keeping a place ID indefinitely, Google
// coordinates only 30 days, nothing else. So Nearby NEVER stores a Google coordinate, and accepting or nudging a pin Google
// placed is not independent data. A Google result (a venue in Create's list, the sign-up's business search, an address search
// on the pin screen) only MOVES THE MAP and is remembered as a reference (its place ID); the map then shows NO pin until the
// person taps the spot themselves. Only that tap (and any drag after it) becomes the stored point.
//   - 'device'           the phone's own location ("Use my current location"), unmoved
//   - 'host_pin'         the person placed the pin themselves on the map (host, or the business for its own location);
//                        may carry the Google place ID they searched for, as a reference only
//   - 'business_profile' the business's own saved location (Create from a business, the web picker's business spot), unmoved
// Earlier labels 'google_confirmed' / 'google_adjusted' / 'address_geocoded' are no longer produced and are refused by the
// database (migration 20270336).

export const LOCATION_SOURCES = Object.freeze(['device', 'host_pin', 'business_profile']);

// ~1 m: anything closer than this is the same point (float noise from the map).
const SAME_POINT_DEG = 0.00001;

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isPoint(p) {
  return !!p && isNum(p.latitude) && isNum(p.longitude);
}

function samePoint(a, b) {
  return Math.abs(a.latitude - b.latitude) <= SAME_POINT_DEG && Math.abs(a.longitude - b.longitude) <= SAME_POINT_DEG;
}

// The pin a pin screen starts with. A Google result is never a pin: only the map's centre (`center`) and a reference.
//   params: { initialLat, initialLng, googlePlaceId?, googlePlaceName? } as the calling screen passed them.
// -> { center, pin, origin, reference }: `pin` null = nothing placed yet (Confirm stays off until the person taps the map).
export function initialPin(params = {}) {
  const point = isNum(params.initialLat) && isNum(params.initialLng) ? { latitude: params.initialLat, longitude: params.initialLng } : null;
  if (params.googlePlaceId) {
    return { center: point, pin: null, origin: null, reference: { placeId: params.googlePlaceId, name: params.googlePlaceName ?? null } };
  }
  // A point the calling screen already holds (the person's own earlier pin or location): shown as the pin.
  return { center: point, pin: point, origin: null, reference: null };
}

// The pin the person confirmed, compared with what last placed it (`origin`):
//   { kind: 'device', point }           "Use my current location"
//   { kind: 'business_profile', point } the business's own saved location (web picker)
//   null                                the person placed it (a tap / drag on the map, or a point the caller already held)
// `reference` = the Google venue/address the person searched for, if any: kept as a place ID beside 'host_pin' only.
export function pinProvenance({ origin = null, confirmed, reference = null }) {
  if (!isPoint(confirmed)) return null;
  if (origin && isPoint(origin.point) && samePoint(confirmed, origin.point) && (origin.kind === 'device' || origin.kind === 'business_profile')) {
    return { source: origin.kind, googlePlaceId: null };
  }
  return { source: 'host_pin', googlePlaceId: reference?.placeId || null };
}

// What a gathering stores beside its point. A custom location without a known source is a pin the host set; Google's place ID
// is kept only beside the host's own pin (a reference to the venue they searched, never its coordinates).
export function gatheringLocationProvenance({ customLocation = null, locationSource = null, googlePlaceId = null } = {}) {
  if (!customLocation) return { location_source: 'device', google_place_id: null };
  const source = LOCATION_SOURCES.includes(locationSource) ? locationSource : 'host_pin';
  return { location_source: source, google_place_id: source === 'host_pin' ? (googlePlaceId || null) : null };
}

// Business sign-up (owner 2026-10-22, "Google as reference only"): Google's result is shown for reference; the business types
// every stored field itself, so its details are always its own.
export const SIGNUP_DETAILS_SOURCE = 'business_entered';
