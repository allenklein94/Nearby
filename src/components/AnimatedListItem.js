import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';

import { MOTION_BUDGET, SEQUENCES, AMBIENT } from '../motion/motionBudget';
// A lightweight fade + slide-up entrance for list cards, staggered by
// position so items animate in as a gentle cascade rather than all
// at once. Delay is capped so long lists don't leave later items
// waiting an unreasonably long time to appear.
// Item 131: cascade budget -- max stagger 200 + 250 item = 450ms to fully settled (medium).
const MAX_STAGGER_MS = 200;
const STAGGER_STEP_MS = 40;

export default function AnimatedListItem({ index = 0, children }) {
  // Item 127: Reduce Motion -> plain fade, no slide offset and no stagger delay.
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(reduceMotion ? 0 : 12)).current;

  useEffect(() => {
    const delay = reduceMotion ? 0 : Math.min(index * STAGGER_STEP_MS, MAX_STAGGER_MS);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: reduceMotion ? MOTION_BUDGET.tiny.max : SEQUENCES.cascade.itemMs, delay, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: SEQUENCES.cascade.itemMs, delay, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}