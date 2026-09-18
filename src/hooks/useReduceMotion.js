import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// The Nearby Motion Language's own governing rule (CLAUDE.md Standing Conventions, locked
// 2026-09-18): "animations should reinforce meaning, hierarchy, state changes, and feedback --
// never animate simply because we can... short, subtle, interruptible, respect Reduce Motion,
// and never slow down the user's task." Every decorative/celebratory animation component in
// src/components/ should call this and, when it returns true, skip straight to its final/settled
// visual state instead of playing the motion -- content and meaning are preserved, only the
// motion itself is removed. Fails safe to `false` (motion allowed) if the platform doesn't
// support the check (e.g. web) or the call rejects, so it can never accidentally suppress motion
// for someone who didn't ask for it.
export default function useReduceMotion() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (typeof AccessibilityInfo.isReduceMotionEnabled === 'function') {
      AccessibilityInfo.isReduceMotionEnabled()
        .then((enabled) => { if (mounted) setReduceMotion(!!enabled); })
        .catch(() => {});
    }
    const subscription = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (enabled) => {
      setReduceMotion(!!enabled);
    });
    return () => {
      mounted = false;
      subscription?.remove?.();
    };
  }, []);

  return reduceMotion;
}
