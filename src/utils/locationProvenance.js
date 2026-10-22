// Owner decision 2026-10-22 (Google storage fix): where a stored location came from. ONE rule for Create's gathering point,
// the business sign-up and the pin screen. Pure: no network, no storage.
//   Google's terms: a place ID may be kept indefinitely; Google coordinates only 30 days; nothing else may be kept.
//   So a Google result only MOVES THE MAP: the person confirms the spot on a Google map (the pin screen), and what is
//   stored is that confirmed pin, labelled with how it was reached, plus Google's place ID as a reference.
//   - 'device'           the phone's own location (Create's "Near me")
//   - 'host_pin'         the person placed the pin themselves (no Google result behind it)
//   - 'google_adjusted'  a Google result centred the map and the person moved the pin
//   - 'google_confirmed' the person confirmed the pin exactly where Google put it (still Google-derived: owner + counsel
//                        decide whether that may be kept permanently; this label is what makes those rows findable)
//   - 'business_profile' the business's own saved location (Create from a business, the web picker's business spot)
// Confirmation is provenance, never a claim that Google-derived data became the person's own.

export const LOCATION_SOURCES = Object.freeze(['device', 'host_pin', 'google_adjusted', 'google_confirmed', 'business_profile']);
export const GOOGLE_LOCATION_SOURCES = Object.freeze(['google_adjusted', 'google_confirmed']);

// ~1 m: anything closer than this is the same point Google gave (float noise from the map).
const SAME_POINT_DEG = 0.00001;

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function samePoint(a, b) {
  return Math.abs(a.latitude - b.latitude) <= SAME_POINT_DEG && Math.abs(a.longitude - b.longitude) <= SAME_POINT_DEG;
}

// The pin the person confirmed, compared with what last placed it (`origin`):
//   { kind: 'google', placeId, point }  a Google venue or address search centred the map
//   { kind: 'device', point }           "Use my current location"
//   { kind: 'business_profile', point } the business's own saved location (web picker)
//   null                                nothing: the person placed it
// A pin moved away from its origin is the person's own ('host_pin'), except a moved Google pin, which stays traceable.
export function pinProvenance({ origin = null, confirmed }) {
  if (!confirmed || !isNum(confirmed.latitude) || !isNum(confirmed.longitude)) return null;
  const p = origin?.point;
  const hasPoint = !!p && isNum(p.latitude) && isNum(p.longitude);
  if (!origin || !hasPoint) return { source: 'host_pin', googlePlaceId: null };
  const moved = !samePoint(confirmed, p);
  if (origin.kind === 'google') {
    return { source: moved ? 'google_adjusted' : 'google_confirmed', googlePlaceId: origin.placeId || null };
  }
  if (!moved && (origin.kind === 'device' || origin.kind === 'business_profile')) return { source: origin.kind, googlePlaceId: null };
  return { source: 'host_pin', googlePlaceId: null };
}

// What a gathering stores beside its point. A custom location without a known source is a pin the host set.
export function gatheringLocationProvenance({ customLocation = null, locationSource = null, googlePlaceId = null } = {}) {
  if (!customLocation) return { location_source: 'device', google_place_id: null };
  const source = LOCATION_SOURCES.includes(locationSource) ? locationSource : 'host_pin';
  return {
    location_source: source,
    google_place_id: GOOGLE_LOCATION_SOURCES.includes(source) ? (googlePlaceId || null) : null,
  };
}

// Business sign-up: name and address are the business's own when it typed them, or when it confirmed values Google filled.
// `googleFilled` = { name, address } as Google gave them (null = no Google result was picked).
export function signupDetailsSource({ googleFilled = null, name, address, confirmed = false }) {
  if (!googleFilled) return 'business_entered';
  const same = (a, b) => String(a ?? '').trim() === String(b ?? '').trim() && String(a ?? '').trim() !== '';
  const usesGoogle = same(name, googleFilled.name) || same(address, googleFilled.address);
  if (!usesGoogle) return 'business_entered';
  return confirmed ? 'business_confirmed_google' : null; // null = may not be sent until the business confirms
}

// Whether a field still shows exactly what Google filled ("From Google Maps — please verify" stays under it).
export function stillGoogleValue(value, googleValue) {
  const v = String(value ?? '').trim();
  return v !== '' && v === String(googleValue ?? '').trim();
}
