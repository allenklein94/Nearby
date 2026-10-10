import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES } from './motionBudget';
import { PROGRESS_STEPS } from '../utils/offerProgress';

// Owner item 13 (2026-10-10): Offer sent -> Accepted -> Redeemed on the business's opportunity card. What is lit comes
// only from `current` (the offer row's stored status, utils/offerProgress.js); the animation never decides a state.
// `play` (decided once, at mount; the screen mounts a fresh copy per status via `key`) fades the newly reached step in
// with a slight rise. Arrival-driven, so no haptic (item 130). Reduce Motion = the settled line at once.
const T = SEQUENCES.offerProgress;
const ease = Easing.bezier(0.2, 0, 0, 1);

export default function OfferProgressSteps({ current, labels, a11yLabel, play = false }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const animate = useRef(play && !reduceMotion).current;
  const step = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) return undefined;
    const anim = Animated.timing(step, { toValue: 1, duration: T.stepMs, easing: ease, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={a11yLabel}
      accessibilityLiveRegion={play ? 'polite' : undefined}
    >
      {PROGRESS_STEPS.map((key, i) => {
        const reached = i <= current;
        const isCurrent = i === current;
        const text = (
          <Text style={[styles.step, { color: reached ? colors.textPrimary : colors.textTertiary }, isCurrent && styles.current]}>
            {reached ? <Text style={{ color: colors.success }}>✓ </Text> : null}
            {labels[key]}
          </Text>
        );
        return (
          <View key={key} style={styles.item}>
            {i > 0 ? <Text style={[styles.arrow, { color: colors.textTertiary }]}>→</Text> : null}
            {isCurrent && animate ? (
              <Animated.View style={{ opacity: step, transform: [{ translateY: step.interpolate({ inputRange: [0, 1], outputRange: [T.risePx, 0] }) }] }}>
                {text}
              </Animated.View>
            ) : text}
          </View>
        );
      })}
    </View>
  );
}

// The card's outline glows once as the step lands (touch-free). Mount it inside the card with the same `key`.
export function OfferProgressGlow({ play = false, color, radius = 12 }) {
  const reduceMotion = useReduceMotion();
  const animate = useRef(play && !reduceMotion).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) return undefined;
    const anim = Animated.sequence([
      Animated.timing(glow, { toValue: 1, duration: T.glowInMs, easing: ease, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0, duration: T.glowOutMs, easing: ease, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!animate) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, {
        top: -1, left: -1, right: -1, bottom: -1,
        borderRadius: radius + 1, borderWidth: 2, borderColor: color,
        shadowColor: color, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
        opacity: glow,
      }]}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: spacing.xs },
  item: { flexDirection: 'row', alignItems: 'center' },
  arrow: { ...typography.caption, marginHorizontal: spacing.xs },
  step: { ...typography.caption },
  current: { fontWeight: '700' },
});
