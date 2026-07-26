import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

// A lightweight fade + slide-up entrance for list cards, staggered by
// position so items animate in as a gentle cascade rather than all
// at once. Delay is capped so long lists don't leave later items
// waiting an unreasonably long time to appear.
const MAX_STAGGER_MS = 250;
const STAGGER_STEP_MS = 40;

export default function AnimatedListItem({ index = 0, children }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    const delay = Math.min(index * STAGGER_STEP_MS, MAX_STAGGER_MS);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 280, delay, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 280, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}