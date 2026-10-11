import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius as R, spacing } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES } from './motionBudget';
import { OfferProgressGlow } from './OfferProgressSteps';

// Owner item 32 (2026-10-11): the accepted offer merges into Your Plan. After "✓ You're booked" settles on the offer card
// (item 12), a "✓ Coastal Coffee" chip lifts off it and travels up into the plan card (MergeTravelChip) while the screen
// scrolls gently there (utils/offerToPlanMerge.js decides whether), and the plan card, now "Coffee at Coastal Coffee",
// settles and glows once in the success colour (PlanMergeLanding). One moment: calm (item 122), no bounce, particles or
// confetti, no haptic of its own (the morph's success vibration is the only one). Both parts are decorative and never
// touchable; the information is already on the cards at full opacity. Reduce Motion: neither plays (the finished card).
// Decisions are the screen's (offerToPlanMergeNow); the timing tokens are SEQUENCES.offerToPlan.
const M = SEQUENCES.offerToPlan;
const ease = Easing.bezier(0.2, 0, 0, 1);

// Lives inside the scroll view's content (absolute, content coordinates), so a scroll during the travel carries it along.
export function MergeTravelChip({ label, fromY, toY, onLanded }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const animate = useRef(!reduceMotion).current;
  const v = useRef(new Animated.Value(0)).current;
  const landed = useRef(onLanded);
  landed.current = onLanded;

  useEffect(() => {
    if (!animate) { landed.current?.(); return undefined; }
    const a = Animated.timing(v, { toValue: 1, duration: M.travelMs, easing: ease, useNativeDriver: true });
    a.start(({ finished }) => { if (finished) landed.current?.(); });
    return () => a.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!animate) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.chip, {
        top: fromY,
        backgroundColor: colors.surface,
        borderColor: colors.success,
        opacity: v.interpolate({ inputRange: [0, M.chipFadeFrom, 1], outputRange: [1, 1, 0] }),
        transform: [
          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, toY - fromY] }) },
          { scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, M.chipToScale] }) },
        ],
      }]}
    >
      <Text style={[styles.chipCheck, { color: colors.success }]}>✓</Text>
      <Text style={[styles.chipText, { color: colors.textPrimary }]} numberOfLines={1}>{label}</Text>
    </Animated.View>
  );
}

// Wraps the plan card's content: on `playKey` (> 0) it settles from landFromScale and its outline glows once.
export function PlanMergeLanding({ playKey = 0, color, radius = R.lg, children }) {
  const reduceMotion = useReduceMotion();
  const animate = playKey > 0 && !reduceMotion;
  const s = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!animate) return undefined;
    s.setValue(M.landFromScale);
    const a = Animated.timing(s, { toValue: 1, duration: M.landMs, easing: ease, useNativeDriver: true });
    a.start();
    return () => { a.stop(); s.setValue(1); };
  }, [playKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Animated.View style={{ transform: [{ scale: s }] }}>
      {children}
      {animate ? <OfferProgressGlow key={playKey} play color={color} radius={radius} timing={M} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: 'absolute', left: spacing.lg, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    borderWidth: 1, borderRadius: R.sm, paddingHorizontal: spacing.sm, paddingVertical: 4, maxWidth: '80%',
  },
  chipCheck: { fontSize: 14, fontWeight: '700', marginRight: 6 },
  chipText: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
});
