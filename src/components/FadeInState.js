import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';

// Empty/error-state transition (per the Nearby Motion Language, locked 2026-09-18): a
// small, one-shot fade-in for a screen's own custom "nothing here yet" state, instead
// of it just snapping into place the instant a fetch resolves to zero real results.
// Drop-in replacement for the `<View style={styles.emptyState}>` wrapper these blocks
// already use -- same `style` prop, same children, no layout change, pure entrance
// motion. Reduce Motion: appears immediately, no fade. Mirrors LoadErrorState's own
// identical fade-in for the *error* case; this is the *empty-result* sibling.
export default function FadeInState({ style, children, ...rest }) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [reduceMotion]);

  return (
    <Animated.View style={[style, { opacity }]} {...rest}>
      {children}
    </Animated.View>
  );
}
