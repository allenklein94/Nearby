// Owner decision 2026-10-22: loads the "Also nearby (not a Nearby partner)" row for a SUBMITTED typed ask, only when
// utils/alsoNearby.js says it fits (too few partner results, a business-type category) and the owner's switch is on
// (places_also_nearby_enabled, default off). Searches Google for the category name only (never the typed words), within the
// daily budget (services/places.js). Results live in memory only (same 10-minute session cache as Places to go).
import { useEffect, useState } from 'react';
import { getUserLocation } from '../services/userLocation';
import { searchNearbyPlaces, alsoNearbyEnabled } from '../services/places';
import { getNearbyBusinesses } from '../services/brandOffers';
import { alsoNearbyCategory, partnerResultCount, pickAlsoNearby } from '../utils/alsoNearby';

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // `${category}|${lat2}|${lng2}` -> { at, places, partners }

export default function useAlsoNearby(intent, language) {
  const category = intent ? alsoNearbyCategory(intent) : null;
  const partners = partnerResultCount(intent?.items);
  const [state, setState] = useState({ places: [], loading: false });

  useEffect(() => {
    let live = true;
    if (!category) { setState({ places: [], loading: false }); return undefined; }
    setState({ places: [], loading: true });
    (async () => {
      try {
        if (!(await alsoNearbyEnabled())) { if (live) setState({ places: [], loading: false }); return; }
        const pos = await getUserLocation();
        const c = pos?.coords;
        if (!c) { if (live) setState({ places: [], loading: false }); return; }
        const k = `${category}|${c.latitude.toFixed(2)}|${c.longitude.toFixed(2)}`;
        let hit = cache.get(k);
        if (!hit || Date.now() - hit.at >= CACHE_MS) {
          const [raw, nearby] = await Promise.all([
            searchNearbyPlaces(c.latitude, c.longitude, null, category),
            getNearbyBusinesses(c.latitude, c.longitude, 10).catch(() => []),
          ]);
          hit = { at: Date.now(), places: raw, partners: nearby };
          cache.set(k, hit);
        }
        if (live) setState({ places: pickAlsoNearby(hit.places, hit.partners, language), loading: false });
      } catch (e) {
        console.error('Also nearby failed', e);
        if (live) setState({ places: [], loading: false });
      }
    })();
    return () => { live = false; };
  }, [category, partners, language, intent?.typedText]);

  return state;
}
