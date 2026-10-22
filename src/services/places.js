import { formatDistanceAway } from '../utils/formatDistance';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { PLACE_TYPES } from '../constants/placeCategories';
import { supabase } from './supabase';

const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey;

// The production key is restricted to "iOS apps" in Google Cloud Console, which
// checks this header rather than a browser Referer -- a plain fetch() never sends
// it on its own (that's only automatic when using Google's native iOS SDKs), so
// every REST call here and in brandOffers.js/SelectGatheringLocationScreen.js was
// getting REQUEST_DENIED ("empty referer") until this header is attached explicitly.
// No equivalent exists yet for Android (the same key has no Android restriction
// configured) -- confirmed live against Google's API on 2026-09-05.
export function getGoogleMapsRequestHeaders() {
  const bundleId = Constants.expoConfig?.ios?.bundleIdentifier;
  return Platform.OS === 'ios' && bundleId ? { 'X-Ios-Bundle-Identifier': bundleId } : undefined;
}

// Real venues from Google Places, not invented or gathering-derived
// data — this is genuine place discovery, distinct from (and
// complementary to) browsing gatherings the app already knows about.
// Straight-line miles from the user to a place (both real coordinates); null when either is missing.
export function straightLineMiles(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => typeof v !== 'number')) return null;
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lng2 - lng1) * rad) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function placeDistanceLabel(miles) {
  if (miles == null) return null;
  return formatDistanceAway(miles);
}

// Owner decision 2026-10-22: Places API (New), only the fields Nearby shows, on Google's Pro tier (name, address, location,
// types, Maps link). Rating, review count, price level, open-now and photos are NOT requested: they sit on the Enterprise /
// photo SKUs (a smaller free allowance and more cost per call; photos also need per-photo author credits), and Nearby has
// no public star ratings. Open-now is requested ONLY on a search made with Discover's Open now filter on
// (searchNearbyPlacesResult's `openNow`), so that one call is billed at Google's higher hours tier and no other is; a
// place without Google's answer stays unknown (utils/operatingStatus.js), never "open".
const PLACES_BASE = 'https://places.googleapis.com/v1';
export const PLACE_SEARCH_FIELDS = Object.freeze([
  'places.id', 'places.displayName', 'places.shortFormattedAddress', 'places.formattedAddress', 'places.location',
  'places.types', 'places.googleMapsUri',
]);
const SEARCH_RADIUS_M = 8000;
const MAX_RESULTS = 20;

// Legacy-only / Table B types (not accepted as includedTypes by the New API) -> the New API's own types, or null = no type
// filter (the old broad `point_of_interest` search).
const NEW_API_TYPES = { point_of_interest: null, health: ['doctor', 'dentist', 'pharmacy', 'physiotherapist', 'hospital'] };
export function newApiTypesFor(placeType) {
  if (!placeType) return null;
  if (Object.prototype.hasOwnProperty.call(NEW_API_TYPES, placeType)) return NEW_API_TYPES[placeType];
  return [placeType];
}

// Every Google Places call first claims one slot of the ONE app-wide daily budget (migration 20270332; owner limit 100/day).
// Refused, signed out or the claim failing = no Google call and no places (never a guess).
export async function claimPlacesCall(kind) {
  try {
    const { data, error } = await supabase.rpc('claim_places_search', { kind_param: kind });
    if (error) { console.error('claim_places_search failed', error.message); return false; }
    return data === true;
  } catch (e) {
    console.error('claim_places_search failed', e?.message);
    return false;
  }
}

// The owner's switch for the "Also nearby (not a Nearby partner)" row (default off). Any failure = off.
export async function alsoNearbyEnabled() {
  try {
    const { data, error } = await supabase.rpc('places_also_nearby_enabled');
    return !error && data === true;
  } catch {
    return false;
  }
}

function googleHeaders(fieldMask) {
  return { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY ?? '', 'X-Goog-FieldMask': fieldMask, ...(getGoogleMapsRequestHeaders() ?? {}) };
}

async function placesPost(path, body, fieldMask) {
  const response = await fetch(`${PLACES_BASE}/${path}`, { method: 'POST', headers: googleHeaders(fieldMask), body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`Places ${path} error`, response.status, data?.error?.status, data?.error?.message);
    return null;
  }
  return data;
}

// One New-API place -> the shape every caller already reads. The fields Nearby no longer requests stay null (unknown).
export function placeFromNewApi(p, latitude = null, longitude = null) {
  const lat = p?.location?.latitude;
  const lng = p?.location?.longitude;
  return {
    placeId: p?.id ?? null,
    name: p?.displayName?.text ?? null,
    address: p?.shortFormattedAddress ?? p?.formattedAddress ?? null,
    rating: null,
    reviewCount: null,
    // Only present when the Open now search asked for it (PLACE_OPEN_NOW_FIELD); otherwise unknown, never "open".
    openNow: typeof p?.currentOpeningHours?.openNow === 'boolean' ? p.currentOpeningHours.openNow : null,
    fetchedAt: new Date().toISOString(),
    priceLevel: null,
    latitude: typeof lat === 'number' ? lat : undefined,
    longitude: typeof lng === 'number' ? lng : undefined,
    distanceMiles: straightLineMiles(latitude, longitude, lat, lng),
    photoRef: null,
    googleMapsUri: p?.googleMapsUri ?? null,
    // Google's own per-place types (see GOOGLE_TYPE_TO_BUSINESS_CATEGORY below).
    types: p?.types ?? [],
  };
}

// The request body for one search: a keyword = Text Search (biased to the person, at most one type); no keyword = Nearby
// Search restricted to the radius by type. Pure, exported for tests.
export function placesSearchRequest(latitude, longitude, category, keyword = null) {
  const types = newApiTypesFor(category ? (PLACE_TYPES[category] ?? 'point_of_interest') : (keyword ? null : 'point_of_interest'));
  const circle = { center: { latitude, longitude }, radius: SEARCH_RADIUS_M };
  if (keyword) {
    return {
      kind: 'text', path: 'places:searchText',
      body: { textQuery: keyword, locationBias: { circle }, pageSize: MAX_RESULTS, ...(types && types.length === 1 ? { includedType: types[0] } : {}) },
    };
  }
  return {
    kind: 'nearby', path: 'places:searchNearby',
    body: { locationRestriction: { circle }, maxResultCount: MAX_RESULTS, ...(types ? { includedTypes: types } : {}) },
  };
}

// Owner 2026-10-22: a search that could not run (daily budget used up, signed out, Google refusing) is NOT "no places":
// callers get `unavailable: true` and say Google results are temporarily unavailable, never "nothing nearby".
// `openNow: true` (Discover's Open now filter only) also asks Google for current open-now, on that one call only.
export const PLACE_OPEN_NOW_FIELD = 'places.currentOpeningHours.openNow';
export async function searchNearbyPlacesResult(latitude, longitude, category, keyword = null, { openNow = false } = {}) {
  const req = placesSearchRequest(latitude, longitude, category, keyword);
  if (!(await claimPlacesCall(req.kind))) return { places: [], unavailable: true };
  const mask = (openNow ? [...PLACE_SEARCH_FIELDS, PLACE_OPEN_NOW_FIELD] : PLACE_SEARCH_FIELDS).join(',');
  const data = await placesPost(req.path, req.body, mask);
  if (!data) return { places: [], unavailable: true };
  // No "N gatherings here" count (owner, 2026-10-17, Option A): a venue-level count of future gatherings located them to
  // ~110 m from caller-chosen points, so its database function is gone (migration 20270325). Places are Google's facts only.
  return { places: (data.places ?? []).slice(0, MAX_RESULTS).map((p) => placeFromNewApi(p, latitude, longitude)), unavailable: false };
}

export async function searchNearbyPlaces(latitude, longitude, category, keyword = null, options) {
  return (await searchNearbyPlacesResult(latitude, longitude, category, keyword, options)).places;
}

// One address search (Google Geocoding) for the pin screens and the business address editor, inside the same daily
// budget (kind 'geocode', migration 20270333). status: 'ok' (point + Google's place ID), 'none' (Google found nothing),
// 'unavailable' (budget used up, signed out, or Google refused: the person can still place the pin by hand).
export async function geocodeAddress(text) {
  const q = String(text ?? '').trim();
  if (!q) return { status: 'none' };
  if (!(await claimPlacesCall('geocode'))) return { status: 'unavailable' };
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${GOOGLE_MAPS_API_KEY}`,
      { headers: getGoogleMapsRequestHeaders() }
    );
    const result = await response.json().catch(() => ({}));
    if (result.status === 'ZERO_RESULTS') return { status: 'none' };
    const first = result.results?.[0];
    const lat = first?.geometry?.location?.lat;
    const lng = first?.geometry?.location?.lng;
    if (result.status !== 'OK' || typeof lat !== 'number' || typeof lng !== 'number') {
      console.error('Geocoding error', result.status, result.error_message);
      return { status: 'unavailable', reason: result.status ?? null };
    }
    return { status: 'ok', point: { latitude: lat, longitude: lng }, placeId: first.place_id ?? null, label: first.formatted_address ?? null };
  } catch (e) {
    console.error('Geocoding failed', e?.message);
    return { status: 'unavailable' };
  }
}

// Google's own 0-4 integer scale (0 = Free, 4 = Very Expensive), rendered as the
// familiar $ signs — never invented when Google hasn't reported one for a place.
export function priceLevelLabel(priceLevel) {
  if (priceLevel === null || priceLevel === undefined) return null;
  if (priceLevel === 0) return 'Free';
  return '$'.repeat(priceLevel);
}

// Business Partner acquisition experience, Milestone 2 (see CLAUDE.md): "Find your
// business" needs a name-based lookup, not the category/radius Nearby Search above
// already covers — Google's Text Search endpoint is the right tool for "search by
// what someone typed," not a repurposed nearbysearch keyword param. `latitude`/
// `longitude` are an optional bias only (Google's own semantics — narrows relevance,
// never filters results out), so this still works for a business owner who hasn't
// granted location permission.
export async function searchPlacesByText(query, latitude = null, longitude = null) {
  return (await searchPlacesByTextResult(query, latitude, longitude)).places;
}

export async function searchPlacesByTextResult(query, latitude = null, longitude = null) {
  if (!query || !query.trim()) return { places: [], unavailable: false };
  if (!(await claimPlacesCall('text'))) return { places: [], unavailable: true };
  const body = { textQuery: query.trim(), pageSize: 10 };
  if (latitude && longitude) body.locationBias = { circle: { center: { latitude, longitude }, radius: 50000 } };
  const data = await placesPost('places:searchText', body, 'places.id,places.displayName,places.formattedAddress,places.location,places.types');
  if (!data) return { places: [], unavailable: true };
  return { unavailable: false, places: (data.places ?? []).slice(0, 10).map((p) => ({
    placeId: p.id,
    name: p.displayName?.text ?? null,
    address: p.formattedAddress ?? null,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    types: p.types ?? [],
    // Google's own category guess for the sign-up form (no Place Details call: phone and website are typed by the business).
    category: guessCategoryFromTypes(p.types ?? []),
  })) };
}

// A small, honest heuristic — never a forced guess. Google's own `types` array maps
// cleanly onto a handful of this app's real BUSINESS_CATEGORIES; anything not
// confidently covered returns null, and the applicant picks manually rather than
// getting handed a wrong category. Matches this codebase's own established
// "don't fabricate a signal the data doesn't clearly support" convention.
// Updated 2026-09-06 alongside the 15-category taxonomy expansion
// (gatheringCategories.js / placeCategories.js), then again the same day
// for the 4 new majors (Stay & Getaway/Health & Personal Care/Education &
// Classes/Attractions & Things to See) -- these keys must match
// BUSINESS_CATEGORIES (BusinessPartnerApplyScreen.js) and the CHECK
// constraint in supabase/migrations/20260923_business_category_taxonomy_v2_new_majors.sql.
// `school` moved from family_kids to education_classes, and `zoo`/
// `tourist_attraction` moved from family_kids/travel_experiences to
// attractions_things_to_see -- each Google type maps to exactly one
// category here, so these move to their more precise new home rather than
// staying duplicated.
const GOOGLE_TYPE_TO_BUSINESS_CATEGORY = {
  restaurant: 'food_drink', cafe: 'food_drink', bar: 'food_drink', bakery: 'food_drink', food: 'food_drink', meal_takeaway: 'food_drink',
  gym: 'sports_fitness', stadium: 'sports_fitness', bowling_alley: 'activities_recreation', // item 168 split
  night_club: 'entertainment_nightlife', movie_theater: 'entertainment_nightlife', casino: 'entertainment_nightlife',
  art_gallery: 'arts_culture_learning', museum: 'arts_culture_learning', library: 'arts_culture_learning',
  clothing_store: 'shopping', store: 'shopping', shopping_mall: 'shopping', shoe_store: 'shopping', jewelry_store: 'shopping', book_store: 'shopping',
  spa: 'wellness_beauty', yoga_studio: 'wellness_beauty', hair_care: 'wellness_beauty', beauty_salon: 'wellness_beauty',
  amusement_park: 'family_kids',
  park: 'outdoors_nature', campground: 'outdoors_nature',
  pet_store: 'pets', veterinary_care: 'pets',
  plumber: 'home_local_services', electrician: 'home_local_services', locksmith: 'home_local_services', moving_company: 'home_local_services', home_goods_store: 'home_local_services',
  car_repair: 'auto_transportation', car_dealer: 'auto_transportation', gas_station: 'auto_transportation', car_wash: 'auto_transportation',
  lawyer: 'business_networking', accounting: 'business_networking', real_estate_agency: 'business_networking', insurance_agency: 'business_networking',
  church: 'community_volunteering', hindu_temple: 'community_volunteering', mosque: 'community_volunteering', synagogue: 'community_volunteering',
  travel_agency: 'travel_experiences',
  lodging: 'travel_experiences', rv_park: 'travel_experiences', // item 168: Stay & Getaway merged into Travel & Getaways
  dentist: 'health_personal_care', doctor: 'health_personal_care', pharmacy: 'health_personal_care', physiotherapist: 'health_personal_care', hospital: 'health_personal_care',
  school: 'education_classes',
  zoo: 'attractions_things_to_see', aquarium: 'attractions_things_to_see', tourist_attraction: 'attractions_things_to_see',
};

function guessCategoryFromTypes(types = []) {
  for (const t of types) {
    if (GOOGLE_TYPE_TO_BUSINESS_CATEGORY[t]) return GOOGLE_TYPE_TO_BUSINESS_CATEGORY[t];
  }
  return null;
}

// No Place Details call any more (owner 2026-10-22): the sign-up used it to pre-fill phone and website from Google; those
// are now typed by the business itself, so Nearby never stores Google's phone/website as the business's own.
