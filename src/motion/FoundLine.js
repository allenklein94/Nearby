import React, { useEffect, useRef } from 'react';
import { Text, Animated } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';

// Item 135: the small "Here's what we found." beat the moment real results arrive -- the payoff of
// the understanding -> finding phases. A tiny-tier fade (never delays the results themselves; they
// render at the same instant), Reduce-Motion: just present.
export default function FoundLine({ text = "Here's what we found." }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) { opacity.setValue(1); return; }
    Animated.timing(opacity, { toValue: 1, duration: 120, useNativeDriver: true }).start();
  }, [reduceMotion]);
  return (
    <Animated.Text style={{ ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs, opacity }}>
      {text}
    </Animated.Text>
  );
}
