import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text, View, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { playHaptic, HAPTIC_MOMENTS } from './haptics';
import { MOTION_BUDGET } from './motionBudget';

// Item 137 (animation-consistency audit): ~20 places confirmed a plain save/send/post with a
// blocking `Alert.alert('Saved', ...)` -- a system dialog that interrupts the user and shares
// nothing with the app's success language. `showSuccessToast` is the shared replacement for a
// PURE confirmation (no choices, nothing to act on): a non-blocking pill that fades in (small
// tier), holds long enough to read, and fades out; success haptic (these are all results of the
// user's own tap, per Item 130); Reduce Motion: no fade, just present then gone. Moments of real
// celebration (plan created, reservation confirmed, match) keep their own SuccessAnimation /
// MatchAnimation; anything the user must decide or acknowledge keeps a real Alert.
let emit = null;
export function showSuccessToast(title, message) {
  if (emit) emit({ title, message: message ?? null });
}

const MIN_HOLD_MS = 1800;
const MAX_HOLD_MS = 5000;
const PER_CHAR_MS = 45;

export function toastHoldMs(title, message) {
  const chars = (title?.length ?? 0) + (message?.length ?? 0);
  return Math.min(MAX_HOLD_MS, Math.max(MIN_HOLD_MS, chars * PER_CHAR_MS));
}

export function SuccessToastHost() {
  const { colors, shadow } = useTheme();
  const reduceMotion = useReduceMotion();
  const [toast, setToast] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);

  useEffect(() => {
    emit = (next) => {
      clearTimeout(timer.current);
      setToast(next);
      playHaptic(HAPTIC_MOMENTS.success);
      opacity.setValue(reduceMotion ? 1 : 0);
      if (!reduceMotion) Animated.timing(opacity, { toValue: 1, duration: MOTION_BUDGET.small.ms, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        if (reduceMotion) { opacity.setValue(0); setToast(null); return; }
        Animated.timing(opacity, { toValue: 0, duration: MOTION_BUDGET.small.ms, useNativeDriver: true }).start(() => setToast(null));
      }, toastHoldMs(next.title, next.message));
    };
    return () => { emit = null; clearTimeout(timer.current); };
  }, [reduceMotion]);

  if (!toast) return null;
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.pill, { opacity, backgroundColor: colors.surface, borderColor: colors.border }, shadow?.card]}
      >
        <Text style={[styles.title, { color: colors.textPrimary }]}>
          <Text style={{ color: colors.primary }}>✓ </Text>{toast.title}
        </Text>
        {toast.message ? <Text style={[styles.message, { color: colors.textSecondary }]}>{toast.message}</Text> : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 96, alignItems: 'center', paddingHorizontal: spacing.lg },
  pill: { maxWidth: 420, borderRadius: radius.lg, borderWidth: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  title: { ...typography.bodyBold },
  message: { ...typography.caption, marginTop: 2 },
});
