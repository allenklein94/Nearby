import { useEffect, useState } from 'react';
import { getReduceMotion, subscribeReduceMotion } from '../motion/motionPolicy';

// Thin hook over the shared Reduce Motion store (src/motion/motionPolicy.js, Item 127) -- one
// AccessibilityInfo subscription for the whole app, not one per component. Every decorative/
// celebratory animation component should call this and, when it returns true, skip straight to
// its final/settled visual state -- content and meaning preserved, only the motion removed.
// Fails safe to `false` (motion allowed) where the platform can't report the setting (e.g. web).
export default function useReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState(getReduceMotion);
  useEffect(() => {
    setReduceMotion(getReduceMotion());
    return subscribeReduceMotion(setReduceMotion);
  }, []);
  return reduceMotion;
}
