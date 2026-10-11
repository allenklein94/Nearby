import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES } from '../motion/motionBudget';

// Owner item 47 (2026-10-11): the thin bar under an open offer's "⏳ Ends in 18 min" line, the share of its real last 30 minutes
// still left (`countdown` from presentOffer -> utils/offerPresentation.js offerCountdown). On mount it is simply at its length;
// each time the real minute changes (the screen re-renders then) it eases to the new length (small tier, native driver).
// Reduce Motion = jumps. Amber in-progress tone, never red; no loop, no pulse, no flash. Decorative: the text says it all.
const T = SEQUENCES.offerCountdown;

export default function OfferCountdown({ countdown }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const fraction = countdown?.fraction ?? 0;
  const length = useRef(new Animated.Value(fraction)).current;

  useEffect(() => {
    if (reduceMotion) { length.setValue(fraction); return undefined; }
    const anim = Animated.timing(length, { toValue: fraction, duration: T.easeMs, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [fraction, reduceMotion, length]);

  if (!countdown) return null;
  return (
    <View
      style={[styles.track, { backgroundColor: colors.border }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
    >
      <Animated.View style={[styles.fill, { backgroundColor: colors.inProgress, transformOrigin: 'left', transform: [{ scaleX: length }] }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: T.barPx, borderRadius: T.barPx, overflow: 'hidden', marginTop: -2, marginBottom: spacing.xs },
  fill: { ...StyleSheet.absoluteFillObject, borderRadius: T.barPx },
});
