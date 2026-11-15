// Business location (owner, 2026-11-15): ONE rule for where a business is and what the app may show about it.
//   storefront   = customers come to the business: its address + its own pin (required at sign-up).
//   service_area = the business goes to its customers: only ROUGHLY where it is based, rounded to 2 decimals (~1 km); no
//                  address, no Google place ID, no map pin, no directions, no "Go now". Routing/distance still use the point.
// Migration 20270419 enforces the same in the database (_service_area_location_guard), so this file is the app's copy of
// that rule, never a second definition of what is stored.

export const SERVICE_AREA_SOURCE = 'service_area';
export const LOCATION_MODES = Object.freeze({ storefront: 'storefront', serviceArea: 'service_area' });

const hasPoint = (latitude, longitude) =>
  typeof latitude === 'number' && typeof longitude === 'number' && Number.isFinite(latitude) && Number.isFinite(longitude);

export function isServiceArea(partner) {
  return partner?.location_source === SERVICE_AREA_SOURCE;
}

// The mode a saved business (or application) is in; null = never said (legacy rows, website applications).
export function locationModeOf(partner) {
  if (!partner) return null;
  if (isServiceArea(partner)) return LOCATION_MODES.serviceArea;
  if (hasPoint(partner.latitude, partner.longitude) || (typeof partner.address === 'string' && partner.address.trim())) return LOCATION_MODES.storefront;
  return null;
}

// Same rounding as the database guard (round(x::numeric, 2)).
export function roundServiceAreaPoint({ latitude, longitude }) {
  const r = (x) => Math.round(x * 100) / 100;
  return { latitude: r(latitude), longitude: r(longitude) };
}

// A place a customer can go to: a storefront with a point or an address. A service-area business never has one.
export function hasPublicPlace(partner) {
  if (!partner || isServiceArea(partner)) return false;
  return (partner.latitude != null && partner.longitude != null) || Boolean(partner.address);
}

// Discover's map pins: storefronts with a point only (the list still shows service-area businesses).
export function hasMapPin(partner) {
  return !isServiceArea(partner) && partner?.latitude != null && partner?.longitude != null;
}

// What blocks finishing the sign-up form's location step. null = complete.
//   'choose_mode' | 'address_required' | 'pin_required' (storefront) | 'area_required' (service area)
export function signupLocationProblem({ mode, address, latitude, longitude }) {
  if (mode === LOCATION_MODES.storefront) {
    if (!(typeof address === 'string' && address.trim())) return 'address_required';
    if (!hasPoint(latitude, longitude)) return 'pin_required';
    return null;
  }
  if (mode === LOCATION_MODES.serviceArea) return hasPoint(latitude, longitude) ? null : 'area_required';
  return 'choose_mode';
}

// The location fields the sign-up inserts. A service-area application never sends an address or place ID, and its point is
// rounded before it leaves the phone (the database rounds again).
export function signupLocationFields({ mode, address, latitude, longitude, locationSource, googlePlaceId }) {
  if (mode === LOCATION_MODES.serviceArea) {
    if (!hasPoint(latitude, longitude)) return { address: null, latitude: null, longitude: null, location_source: null, google_place_id: null };
    return { address: null, ...roundServiceAreaPoint({ latitude, longitude }), location_source: SERVICE_AREA_SOURCE, google_place_id: null };
  }
  const pinned = hasPoint(latitude, longitude);
  const source = pinned ? (locationSource === 'device' ? 'device' : 'host_pin') : null;
  return {
    address: typeof address === 'string' && address.trim() ? address.trim() : null,
    latitude: pinned ? latitude : null,
    longitude: pinned ? longitude : null,
    location_source: source,
    google_place_id: source === 'host_pin' ? googlePlaceId ?? null : null,
  };
}

// The point setBusinessLocation sends for a returned pin, in the mode the owner chose.
export function businessLocationWrite(mode, pin) {
  if (mode === LOCATION_MODES.serviceArea) {
    return { ...roundServiceAreaPoint(pin), locationSource: SERVICE_AREA_SOURCE, googlePlaceId: null };
  }
  const locationSource = pin?.locationSource === 'device' ? 'device' : 'host_pin';
  return { latitude: pin.latitude, longitude: pin.longitude, locationSource, googlePlaceId: locationSource === 'host_pin' ? pin?.googlePlaceId ?? null : null };
}
