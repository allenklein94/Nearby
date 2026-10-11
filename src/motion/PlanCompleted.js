import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES } from './motionBudget';

// Owner item 34 (2026-10-11): "Plan complete". Mounted by Home's Your Plans on the completed plan card the first time it is
// shown (utils/gatheringCompletion.js takeCompletionMoment: once per gathering, ever). "Confirmed" dims and is struck through,
// "✓ Completed" slides in beside it; then the row stays settled for this visit. Subtle on purpose: no glow, no haptic, medium
// tier. Information is readable at every frame (the struck label rests at 0.88; Completed never fades). Reduce Motion = the
// settled row at once. Not touchable (pointerEvents none), never delays the card's own tap or the feedback below it.
const M = SEQUENCES.planCompleted;
const ease = Easing.bezier(0.2, 0, 0, 1);

export default function PlanCompleted({ fromLabel, toLabel, play = true }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  // Decided once, at mount: a reload or re-render never replays it.
  const animate = useRef(play && !reduceMotion).current;
  const dim = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const arrive = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) return undefined;
    const a = Animated.parallel([
      Animated.timing(dim, { toValue: 1, duration: M.dimMs, easing: ease, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(M.arriveDelayMs),
        Animated.timing(arrive, { toValue: 1, duration: M.arriveMs, easing: ease, useNativeDriver: true }),
      ]),
    ]);
    a.start();
    return () => a.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View
      pointerEvents="none"
      style={styles.row}
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion={animate ? 'polite' : undefined}
      accessibilityLabel={`${fromLabel} → ${toLabel}`}
    >
      <Animated.Text
        style={[styles.from, { color: colors.textSecondary, opacity: dim.interpolate({ inputRange: [0, 1], outputRange: [1, M.oldRestOpacity] }) }]}
      >
        {fromLabel}
      </Animated.Text>
      <Text style={[styles.arrow, { color: colors.textSecondary }]}>→</Text>
      <Animated.View style={[styles.to, { transform: [
        { translateX: arrive.interpolate({ inputRange: [0, 1], outputRange: [-M.flowPx, 0] }) },
        { scale: arrive.interpolate({ inputRange: [0, 1], outputRange: [M.fromScale, 1] }) },
      ] }]}>
        <Text style={[styles.check, { color: colors.success }]}>✓</Text>
        <Text style={[styles.toText, { color: colors.textPrimary }]}>{toLabel}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  from: { fontSize: 13, fontWeight: '600', textDecorationLine: 'line-through' },
  arrow: { fontSize: 13, marginHorizontal: spacing.xs },
  to: { flexDirection: 'row', alignItems: 'center' },
  check: { fontSize: 14, fontWeight: '700', marginRight: 4 },
  toText: { fontSize: 13, fontWeight: '700' },
});
