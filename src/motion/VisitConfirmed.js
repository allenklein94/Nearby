import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES } from './motionBudget';

// Marketplace moment 6, the customer side of redemption (2026-10-10): the booked card's final step, "✓ Visit confirmed",
// shown whenever the offer is stored as `completed` (the business confirmed the visit). `play` (decided once at mount)
// = the confirmation arrived while the screen was open: the line settles in (fade + slight rise); the card's glow is
// OfferProgressGlow with SEQUENCES.visitConfirmed. Arrival-driven: no haptic. Reduce Motion = the settled line.
const T = SEQUENCES.visitConfirmed;

export default function VisitConfirmed({ label, play = false }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const animate = useRef(play && !reduceMotion).current;
  const v = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) return undefined;
    const anim = Animated.timing(v, { toValue: 1, duration: T.stepMs, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Animated.View
      accessibilityLiveRegion={play ? 'polite' : undefined}
      style={[styles.row, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [T.risePx, 0] }) }] }]}
    >
      <Text style={[styles.text, { color: colors.success }]}>✓ {label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { marginTop: spacing.sm },
  text: { ...typography.bodyBold },
});
