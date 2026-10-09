import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography, radius } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { playHaptic, HAPTIC_MOMENTS } from './haptics';
import { SEQUENCES } from './motionBudget';
import { bookedDetailsLine } from '../utils/bookedDetails';

// "You're booked" (owner, 2026-10-09). The moment accepting a business's offer becomes a booking. Item 122 still holds:
// a booking is a transaction, so this is reassuring, not festive. A ring closes in the success colour, the ✓ settles
// inside it, ONE soft ripple goes out from it while the real facts fade in ("Coastal Coffee · Tonight · 7 PM"). No
// particles, no confetti, no bounce, no loop; under 0.8 s (SEQUENCES.booked). The success vibration plays only because
// the person tapped "I'll take this one" (`haptic`, item 130). Reduce Motion: the settled card, at once.
// `details` = the real booking facts the screen already has; any missing part is left out, never invented.
const T = SEQUENCES.booked;
const RING = 44;

export { bookedDetailsLine };

export default function BookedCelebration({ title, details = null, haptic = false }) {
  const { colors, shadow } = useTheme();
  const reduceMotion = useReduceMotion();
  const card = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;
  const text = useRef(new Animated.Value(0)).current;
  const line = bookedDetailsLine(details ?? {});

  useEffect(() => {
    if (haptic) playHaptic(HAPTIC_MOMENTS.success);
    if (reduceMotion) {
      [card, ring, check, text].forEach((v) => v.setValue(1));
      ripple.setValue(1);
      return;
    }
    const ease = Easing.bezier(0.2, 0, 0, 1);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(card, { toValue: 1, duration: T.ringMs, easing: ease, useNativeDriver: true }),
        Animated.timing(ring, { toValue: 1, duration: T.ringMs, easing: ease, useNativeDriver: true }),
      ]),
      Animated.timing(check, { toValue: 1, duration: T.checkMs, easing: ease, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(ripple, { toValue: 1, duration: T.rippleMs, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(text, { toValue: 1, duration: T.textFadeMs, useNativeDriver: true }),
      ]),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const a11y = [title, line].filter(Boolean).join('. ');
  return (
    <Animated.View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      accessibilityLabel={a11y}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.success, opacity: card,
        transform: [{ translateY: card.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }, shadow?.card]}
    >
      <View style={styles.badge}>
        <Animated.View
          style={[styles.ripple, { borderColor: colors.success,
            opacity: ripple.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.5, 0] }),
            transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }] }]}
        />
        <Animated.View
          style={[styles.ring, { borderColor: colors.success, opacity: ring,
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]}
        >
          <Animated.Text style={[styles.check, { color: colors.success, opacity: check,
            transform: [{ scale: check.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }]}>✓</Animated.Text>
        </Animated.View>
      </View>
      <Animated.View style={[styles.textCol, { opacity: text }]}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        {line ? <Text style={[styles.details, { color: colors.textSecondary }]} numberOfLines={2}>{line}</Text> : null}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.lg, borderWidth: 1.5, padding: spacing.md, marginBottom: spacing.md },
  badge: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  ripple: { position: 'absolute', width: RING, height: RING, borderRadius: RING / 2, borderWidth: 2 },
  ring: { width: RING, height: RING, borderRadius: RING / 2, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  check: { fontSize: 22, fontWeight: '800' },
  textCol: { flex: 1 },
  title: { ...typography.bodyBold },
  details: { ...typography.caption, marginTop: 2 },
});
