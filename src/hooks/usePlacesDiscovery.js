// Whether Google-backed discovery surfaces may show (utils/googleDiscovery.js). false until the server says true.
import { useEffect, useState } from 'react';
import { placesDiscoveryEnabled } from '../services/places';

export default function usePlacesDiscovery() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    placesDiscoveryEnabled().then((v) => { if (live) setOn(v === true); }).catch(() => {});
    return () => { live = false; };
  }, []);
  return on;
}
