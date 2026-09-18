import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';

import { MOTION_BUDGET, SEQUENCES, AMBIENT } from '../motion/motionBudget';
// A quick fade + scale entrance for chat bubbles, applied only to
// the most recently added message rather than the whole list, so
// scrolling back through history doesn't re-trigger animations on
// messages that already exist.
export default function AnimatedMessageBubble({ isNew, children }) {
  // Item 127: Reduce Motion -> fade only, no scale-pop.
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(isNew ? 0 : 1)).current;
  const scale = useRef(new Animated.Value(isNew && !reduceMotion ? 0.85 : 1)).current;

  useEffect(() => {
    if (isNew) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: MOTION_BUDGET.small.ms, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 7, tension: 100, useNativeDriver: true }),
      ]).start();
    }
  }, []);

  return (
    <Animated.View style={{ opacity, transform: [{ scale }] }}>
      {children}
    </Animated.View>
  );
}