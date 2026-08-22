import Constants from 'expo-constants';
import { supabase } from './supabase';

const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey;

const PLACE_TYPES = {
  restaurants: 'restaurant',
  parks: 'park',
  coffee: 'cafe',
  hubs: 'community_center',
};

// Real venues from Google Places, not invented or gathering-derived
// data — this is genuine place discovery, distinct from (and
// complementary to) browsing gatherings the app already knows about.
export async function searchNearbyPlaces(latitude, longitude, category, keyword = null) {
  const placeType = PLACE_TYPES[category] ?? 'point_of_interest';
  const keywordParam = keyword ? `&keyword=${encodeURIComponent(keyword)}` : '';
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=8000&type=${placeType}${keywordParam}&key=${GOOGLE_MAPS_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.error('searchNearbyPlaces error', data.status, data.error_message);
    return [];
  }

  // rating/reviewCount/openNow/priceLevel are all part of Google's free "Basic Data"
  // tier for Nearby/Text Search — no extra fields param or per-place Details call
  // needed, unlike weekly opening hours (only in Place Details, deliberately not
  // fetched here to avoid N extra network calls per list of 20 places).
  const places = (data.results ?? []).slice(0, 20).map((p) => ({
    placeId: p.place_id,
    name: p.name,
    address: p.vicinity,
    rating: p.rating ?? null,
    reviewCount: p.user_ratings_total ?? null,
    openNow: p.opening_hours?.open_now ?? null,
    priceLevel: typeof p.price_level === 'number' ? p.price_level : null,
    latitude: p.geometry?.location?.lat,
    longitude: p.geometry?.location?.lng,
    photoRef: p.photos?.[0]?.photo_reference ?? null,
  }));

  // Cross-reference against gatherings the app already knows about
  // near each place, so a venue can honestly show "3 gatherings
  // hosted here" when that's genuinely true, without fabricating it
  // for places nobody's actually used yet.
  // A single batched RPC call instead of one round-trip per place —
  // meaningfully faster than the naive per-place approach, especially
  // on slower networks with up to 20 places to check.
  const validPlaces = places.filter((p) => p.latitude && p.longitude);
  let countsByIdx = {};
  if (validPlaces.length > 0) {
    try {
      const { data: counts } = await supabase.rpc('count_gatherings_near_batch', {
        lats: validPlaces.map((p) => p.latitude),
        lngs: validPlaces.map((p) => p.longitude),
      });
      countsByIdx = Object.fromEntries((counts ?? []).map((c) => [c.idx, c.gathering_count]));
    } catch (e) {
      console.error('count_gatherings_near_batch error', e);
      // Fails open to zero counts rather than losing the whole
      // places list over a secondary, non-essential metric.
    }
  }

  let validIdx = 0;
  const withGatheringCounts = places.map((place) => {
    if (!place.latitude || !place.longitude) return { ...place, gatheringCount: 0 };
    validIdx += 1;
    return { ...place, gatheringCount: countsByIdx[validIdx] ?? 0 };
  });

  return withGatheringCounts;
}

export function getPlacePhotoUrl(photoRef, maxWidth = 400) {
  if (!photoRef) return null;
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoRef}&key=${GOOGLE_MAPS_API_KEY}`;
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
  if (!query || !query.trim()) return [];
  const locationBias = latitude && longitude ? `&location=${latitude},${longitude}&radius=50000` : '';
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query.trim())}${locationBias}&key=${GOOGLE_MAPS_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.error('searchPlacesByText error', data.status, data.error_message);
    return [];
  }

  return (data.results ?? []).slice(0, 10).map((p) => ({
    placeId: p.place_id,
    name: p.name,
    address: p.formatted_address ?? p.vicinity ?? null,
    latitude: p.geometry?.location?.lat ?? null,
    longitude: p.geometry?.location?.lng ?? null,
    types: p.types ?? [],
  }));
}

// A small, honest heuristic — never a forced guess. Google's own `types` array maps
// cleanly onto a handful of this app's real BUSINESS_CATEGORIES; anything not
// confidently covered returns null, and the applicant picks manually rather than
// getting handed a wrong category. Matches this codebase's own established
// "don't fabricate a signal the data doesn't clearly support" convention.
const GOOGLE_TYPE_TO_BUSINESS_CATEGORY = {
  restaurant: 'food_drink', cafe: 'food_drink', bar: 'food_drink', bakery: 'food_drink', food: 'food_drink',
  gym: 'fitness_wellness', spa: 'fitness_wellness', yoga_studio: 'fitness_wellness',
  clothing_store: 'retail_shopping', store: 'retail_shopping', shopping_mall: 'retail_shopping', shoe_store: 'retail_shopping',
  art_gallery: 'arts_entertainment', movie_theater: 'arts_entertainment', night_club: 'arts_entertainment', museum: 'arts_entertainment',
  lawyer: 'professional_services', accounting: 'professional_services', real_estate_agency: 'professional_services', insurance_agency: 'professional_services',
};

function guessCategoryFromTypes(types = []) {
  for (const t of types) {
    if (GOOGLE_TYPE_TO_BUSINESS_CATEGORY[t]) return GOOGLE_TYPE_TO_BUSINESS_CATEGORY[t];
  }
  return null;
}

// Text Search results don't include phone/website — a real, separate Place Details
// call is needed for those, same API key, same real Google data. Returns whatever
// fields Google actually has; never fabricates a missing one.
export async function getPlaceDetails(placeId) {
  const fields = 'formatted_phone_number,website,formatted_address,name,types';
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=${fields}&key=${GOOGLE_MAPS_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK') {
    console.error('getPlaceDetails error', data.status, data.error_message);
    return null;
  }

  const r = data.result ?? {};
  return {
    name: r.name ?? null,
    address: r.formatted_address ?? null,
    phone: r.formatted_phone_number ?? null,
    website: r.website ?? null,
    category: guessCategoryFromTypes(r.types),
  };
}