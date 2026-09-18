import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';

// Item 117: "use animation to establish cause and effect." Items 114-116 already animate the
// RESULT content when a chip/tab/toggle changes what's shown (ModeTransition/FilterTransition) --
// but the control the user actually tapped just instantly flips its own active style, giving no
// visual confirmation that the tap itself was the cause. This hook is the control-side half: a
// brief scale "pop" on whichever control just became active, never on first mount (mounting isn't
// a user action), never on the control becoming INACTIVE (only the thing chosen pops, not the
// thing left behind -- that reads as "this is what changed" rather than two competing motions).
// Same shape as useKeyChangeFade: Reduce-Motion-aware, useNativeDriver: true, short and
// interruptible, never gates the tap itself (the onPress/state change already happened by the
// time this plays).
export default function useTapActivate(active, { fromScale = 0.92, duration = 140 } = {}) {
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const firstRef = useRef(true);
  const lastActiveRef = useRef(active);

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      lastActiveRef.current = active;
      return;
    }
    if (lastActiveRef.current === active) return;
    lastActiveRef.current = active;
    if (!active || reduceMotion) return;
    scale.setValue(fromScale);
    Animated.spring(scale, {
      toValue: 1,
      speed: 20,
      bounciness: 6,
      useNativeDriver: true,
    }).start();
  }, [active, reduceMotion, fromScale, duration]);

  return scale;
}
