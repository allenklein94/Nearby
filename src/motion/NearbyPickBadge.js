import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, radius, typography } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';

// NearbyPickBadge -- Item 125 ("Make 'Nearby found this for you' visually recognizable"): ✨ as a
// standalone, RECURRING product signal, not just the transition beat the Nearby Motion Language
// otherwise reserves it for (motionLanguage.js) -- a deliberate, disclosed second meaning for the
// same glyph, scoped narrowly: this badge only ever belongs on the single real top-scored result
// of a genuine, user-STATED intent search (resolveIntent()'s own candidate lists are already
// sorted by real score before a caller ever sees them, so "index === 0 within an already-sorted
// list" is an honest signal, never fabricated). Never on a plain browse/category list, never on
// every card -- the whole point is that it stays rare enough to keep meaning something.
//
// Plays one brief pop-in (scale + fade) on mount so it's genuinely "introduced," not static from
// frame one. Reduce Motion: appears immediately at rest, same as every other piece here.
export default function NearbyPickBadge({ style }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const scale = useRef(new Animated.Value(reduceMotion ? 1 : 0.7)).current;

  useEffect(() => {
    if (reduceMotion) return;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, speed: 16, bounciness: 8, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const styles = getStyles(colors);
  return (
    <Animated.View style={[styles.badge, style, { opacity, transform: [{ scale }] }]}>
      <Text style={styles.text}>✨ Nearby Pick</Text>
    </Animated.View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primaryMuted,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginBottom: 2,
  },
  text: { ...typography.caption, color: colors.primary, fontWeight: '700' },
});
