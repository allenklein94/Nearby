import { useEffect, useState } from 'react';
import { gatheringCuisineSupported } from '../services/gatherings';

// true only once the server confirmed it stores a gathering's cuisine (20270435); false while asking and when it can't.
// Create and Edit offer the cuisine choice only then, so a pick is never shown as saved when it wouldn't be.
export default function useGatheringCuisineSupported() {
  const [supported, setSupported] = useState(false);
  useEffect(() => {
    let live = true;
    gatheringCuisineSupported().then((ok) => { if (live) setSupported(ok === true); });
    return () => { live = false; };
  }, []);
  return supported;
}
