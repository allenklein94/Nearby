import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';

// Shared internal mechanic behind ModeTransition and FilterTransition: a
// brief opacity dip-and-recover whenever `activeKey` genuinely changes from
// what was last seen -- never on first mount (mounting isn't a "change"),
// never a full fade-out-then-fade-in (that would require holding both old
// and new content simultaneously, real complexity/risk for a purely
// perceptual cue). Never gates interaction: the new content is already
// mounted and tappable the instant it renders; this only ever touches
// opacity, layout is untouched.
export default function useKeyChangeFade(activeKey, { duration = 160, dip = 0.35 } = {}) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  const firstRef = useRef(true);
  const lastKeyRef = useRef(activeKey);

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      lastKeyRef.current = activeKey;
      return;
    }
    if (lastKeyRef.current === activeKey) return;
    lastKeyRef.current = activeKey;
    if (reduceMotion) return;
    opacity.setValue(dip);
    Animated.timing(opacity, { toValue: 1, duration, useNativeDriver: true }).start();
  }, [activeKey, reduceMotion, duration, dip]);

  return opacity;
}
