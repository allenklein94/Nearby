import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';

// Item 112 follow-up (CLAUDE.md, "the final options settle into place"):
// once the real fetch resolves, each result card fades/slides in with a
// small per-index delay instead of all appearing at once -- the "settling
// into place" sensation applied to REAL fetched data, never a fabricated
// reveal ahead of real content. `index` resets per section on purpose (a
// new section of real results, e.g. "🎁 Occasion Packages" after
// "🍽️ Nearby options," reads as its own small cascade rather than
// continuing a long global stagger).
const BASE_DELAY_MS = 70;
const MAX_DELAY_MS = 350;

export default function StaggeredReveal({ index = 0, children, style }) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reduceMotion ? 0 : 10)).current;

  useEffect(() => {
    // Reduce Motion: real results appear immediately, all at once, with no per-card
    // stagger delay -- the cascade is purely decorative, the results themselves aren't.
    if (reduceMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return undefined;
    }
    const delay = Math.min(index * BASE_DELAY_MS, MAX_DELAY_MS);
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start();
    }, delay);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
