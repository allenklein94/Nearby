import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES, infoOpacity } from './motionBudget';

// Owner item 16 (2026-10-10, LOCKED): "Coastal Coffee is responding…" on the customer's request while a reply that business
// SENT is being checked. It extends marketplace moment 2 (business response): when the reply is published the screen re-reads,
// this line disappears and the timeline + the card's own build-in (moment 3) take over. When the check ends any other way it
// simply disappears. One small dot pulse when it appears (never a loop: the wait is real, not theater); no haptic (it arrives
// on its own); Reduce Motion = the static line. Rendered only when `label` is set by the server's answer.
const T = SEQUENCES.responding;

export default function RespondingStatus({ label }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const animate = useRef(!reduceMotion).current;
  const fade = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const pulse = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) return undefined;
    const anim = Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: T.fadeMs, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: T.pulseMs, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!label) return null;
  return (
    <Animated.View style={[styles.row, { opacity: infoOpacity(fade) }]} accessibilityLiveRegion="polite" accessibilityLabel={label}>
      <View style={styles.dotWrap}>
        <Animated.View
          pointerEvents="none"
          style={[styles.ring, { borderColor: colors.info, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }] }]}
        />
        <View style={[styles.dot, { backgroundColor: colors.info }]} />
      </View>
      <Text style={[styles.text, { color: colors.textPrimary }]}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xs },
  dotWrap: { width: 14, height: 14, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  dot: { width: 8, height: 8, borderRadius: 4 },
  ring: { position: 'absolute', width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  text: { ...typography.bodyBold },
});
