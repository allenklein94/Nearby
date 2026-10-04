// Owner item 189: loads "Places to go" for a submitted typed ask whose words name an allowlisted public-place activity
// (utils/placesToGo.js). `text` is the SUBMITTED ask (null when there is none), so the metered Places search never runs while
// typing, on Home's feed or for an unlisted activity. Results live in memory only (a short per-session cache so a re-shown ask
// does not search again); nothing is stored, logged or learned.
import { useEffect, useState } from 'react';
import { getUserLocation } from '../services/userLocation';
import { searchNearbyPlaces } from '../services/places';
import { placesToGoActivity, pickPlacesToGo } from '../utils/placesToGo';

const CACHE_MS = 10 * 60 * 1000;
const cache = new Map(); // `${activity}|${lat2}|${lng2}` -> { at, places }

export default function usePlacesToGo(text, language) {
  const activity = placesToGoActivity(text);
  const [state, setState] = useState({ activity: null, places: [], loading: false });

  useEffect(() => {
    let live = true;
    if (!activity) { setState({ activity: null, places: [], loading: false }); return undefined; }
    setState({ activity, places: [], loading: true });
    (async () => {
      try {
        const pos = await getUserLocation();
        const c = pos?.coords;
        if (!c) { if (live) setState({ activity, places: [], loading: false }); return; }
        const k = `${activity}|${c.latitude.toFixed(2)}|${c.longitude.toFixed(2)}`;
        const hit = cache.get(k);
        const raw = hit && Date.now() - hit.at < CACHE_MS ? hit.places : await searchNearbyPlaces(c.latitude, c.longitude, null, activity);
        if (!hit || hit.places !== raw) cache.set(k, { at: Date.now(), places: raw });
        if (live) setState({ activity, places: pickPlacesToGo(raw, language), loading: false });
      } catch (e) {
        console.error('Places to go failed', e);
        if (live) setState({ activity, places: [], loading: false });
      }
    })();
    return () => { live = false; };
  }, [activity, language]);

  return state;
}
