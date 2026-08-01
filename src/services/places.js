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
export async function searchNearbyPlaces(latitude, longitude, category) {
  const placeType = PLACE_TYPES[category] ?? 'point_of_interest';
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${latitude},${longitude}&radius=8000&type=${placeType}&key=${GOOGLE_MAPS_API_KEY}`;

  const response = await fetch(url);
  const data = await response.json();

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.error('searchNearbyPlaces error', data.status, data.error_message);
    return [];
  }

  const places = (data.results ?? []).slice(0, 20).map((p) => ({
    placeId: p.place_id,
    name: p.name,
    address: p.vicinity,
    rating: p.rating ?? null,
    latitude: p.geometry?.location?.lat,
    longitude: p.geometry?.location?.lng,
    photoRef: p.photos?.[0]?.photo_reference ?? null,
  }));

  // Cross-reference against gatherings the app already knows about
  // near each place, so a venue can honestly show "3 gatherings
  // hosted here" when that's genuinely true, without fabricating it
  // for places nobody's actually used yet.
  const withGatheringCounts = await Promise.all(
    places.map(async (place) => {
      if (!place.latitude || !place.longitude) return { ...place, gatheringCount: 0 };
      const { data: count } = await supabase.rpc('count_gatherings_near', {
        lat_param: place.latitude,
        lng_param: place.longitude,
      });
      return { ...place, gatheringCount: count ?? 0 };
    })
  );

  return withGatheringCounts;
}

export function getPlacePhotoUrl(photoRef, maxWidth = 400) {
  if (!photoRef) return null;
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoRef}&key=${GOOGLE_MAPS_API_KEY}`;
}