import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text, View, StyleSheet, TouchableOpacity } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing, radius } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { playHaptic, HAPTIC_MOMENTS } from './haptics';
import { MOTION_BUDGET } from './motionBudget';
import { toastHoldMs } from './toastTiming';

export { toastHoldMs, UNDO_HOLD_MS } from './toastTiming';

// Item 137 (animation-consistency audit): ~20 places confirmed a plain save/send/post with a
// blocking `Alert.alert('Saved', ...)` -- a system dialog that interrupts the user and shares
// nothing with the app's success language. `showSuccessToast` is the shared replacement for a
// PURE confirmation (no choices, nothing to act on): a non-blocking pill that fades in (small
// tier), holds long enough to read, and fades out; success haptic (these are all results of the
// user's own tap, per Item 130); Reduce Motion: no fade, just present then gone. Moments of real
// celebration (plan created, reservation confirmed, match) keep their own SuccessAnimation /
// MatchAnimation; anything the user must decide or acknowledge keeps a real Alert.
//
// Owner item 124 (2026-09-28): a LOW-RISK, reversible action may offer Undo right on the toast
// (`showSuccessToast(title, message, { undo })`), so reversing it never means navigating away.
// Only for actions that tell nobody else and lose nothing (Interested, adding your own interest);
// never for anything that sent a push, reached a business, cost money or deleted data. The toast
// stays up longer while it carries Undo, Undo runs at most once, and tapping it closes the toast
// (the control on screen flipping back is the feedback).
let emit = null;
export function showSuccessToast(title, message, options) {
  const undo = typeof options?.undo === 'function' ? options.undo : null;
  if (emit) emit({ title, message: message ?? null, undo });
}

export function SuccessToastHost() {
  const { colors, shadow } = useTheme();
  const reduceMotion = useReduceMotion();
  const [toast, setToast] = useState(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef(null);

  const hide = () => {
    clearTimeout(timer.current);
    if (reduceMotion) { opacity.setValue(0); setToast(null); return; }
    Animated.timing(opacity, { toValue: 0, duration: MOTION_BUDGET.small.ms, useNativeDriver: true }).start(() => setToast(null));
  };

  const runUndo = () => {
    const undo = toast?.undo;
    if (!undo) return;
    setToast((t) => (t ? { ...t, undo: null } : t)); // at most once
    hide();
    Promise.resolve().then(undo).catch(() => {}); // the caller reports its own failure
  };

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
      }, toastHoldMs(next.title, next.message, !!next.undo));
    };
    return () => { emit = null; clearTimeout(timer.current); };
  }, [reduceMotion]);

  if (!toast) return null;
  return (
    <View pointerEvents={toast.undo ? 'box-none' : 'none'} style={styles.wrap}>
      <Animated.View
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.pill, toast.undo && styles.pillWithAction, { opacity, backgroundColor: colors.surface, borderColor: colors.border }, shadow?.card]}
      >
        <View style={toast.undo ? styles.textWithAction : null}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>
            <Text style={{ color: colors.primary }}>✓ </Text>{toast.title}
          </Text>
          {toast.message ? <Text style={[styles.message, { color: colors.textSecondary }]}>{toast.message}</Text> : null}
        </View>
        {toast.undo ? (
          <TouchableOpacity
            onPress={runUndo}
            accessibilityRole="button"
            accessibilityLabel={`Undo: ${toast.title}`}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.undo}
          >
            <Text style={[styles.undoText, { color: colors.primary }]}>Undo</Text>
          </TouchableOpacity>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 96, alignItems: 'center', paddingHorizontal: spacing.lg },
  pill: { maxWidth: 420, borderRadius: radius.lg, borderWidth: 1, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  pillWithAction: { flexDirection: 'row', alignItems: 'center' },
  textWithAction: { flexShrink: 1 },
  undo: { marginLeft: spacing.md, paddingVertical: 4 },
  undoText: { ...typography.bodyBold },
  title: { ...typography.bodyBold },
  message: { ...typography.caption, marginTop: 2 },
});
