import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES } from './motionBudget';

// Owner item 31 (2026-10-11): Interested -> Attending is a bigger moment than marking Interested (item 30), so the difference
// between the two states is obvious. Mounted by GatheringDetail only when the person's OWN join from Interested came back
// approved in this visit (the stored attendance after the reload says attending; the server's clear_interested_on_join has
// already removed the Interested mark). The row shows the move: "★ Interested" dims and is struck through, "✓ Attending" flows
// in beside it and glows once in the success colour, then the row stays settled for this visit. Contrast holds at every frame
// (owner, 2026-10-11): the struck label fades only to 0.88 (>= 4.5:1), Attending is never faded. Reduce Motion = the settled
// row at once (still reads Interested -> Attending). Not touchable, never delays anything (information at >= info opacity).
// The success vibration is the join's own (already played by the screen after the tap); none here.
const M = SEQUENCES.interestedToAttending;
const ease = Easing.bezier(0.2, 0, 0, 1);

export default function InterestedToAttending({ fromLabel, toLabel, a11yLabel, play = true }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  // Decided once, at mount: a reload or re-render never replays it.
  const animate = useRef(play && !reduceMotion).current;
  const dim = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const arrive = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) return undefined;
    const a = Animated.parallel([
      Animated.timing(dim, { toValue: 1, duration: M.dimMs, easing: ease, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(M.arriveDelayMs),
        Animated.timing(arrive, { toValue: 1, duration: M.arriveMs, easing: ease, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 1, duration: M.glowInMs, easing: ease, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: M.glowOutMs, easing: ease, useNativeDriver: true }),
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
      accessibilityLiveRegion={play ? 'polite' : undefined}
      accessibilityLabel={a11yLabel}
    >
      <Animated.Text
        style={[styles.from, { color: colors.textSecondary, opacity: dim.interpolate({ inputRange: [0, 1], outputRange: [1, M.oldRestOpacity] }) }]}
      >
        {fromLabel}
      </Animated.Text>
      <Text style={[styles.arrow, { color: colors.textSecondary }]}>→</Text>
      {/* Full opacity at every frame (contrast): Attending arrives by sliding and growing, never by fading. */}
      <Animated.View style={{ transform: [
        { translateX: arrive.interpolate({ inputRange: [0, 1], outputRange: [-M.flowPx, 0] }) },
        { scale: arrive.interpolate({ inputRange: [0, 1], outputRange: [M.fromScale, 1] }) },
      ] }}>
        <View style={[styles.to, { borderColor: colors.success, backgroundColor: colors.success + '1A' }]}>
          <Text style={[styles.toText, { color: colors.success }]}>{toLabel}</Text>
          {animate ? (
            <Animated.View
              style={[StyleSheet.absoluteFillObject, styles.glow, { borderColor: colors.success, shadowColor: colors.success, opacity: glow }]}
            />
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  from: { fontSize: 14, fontWeight: '600', textDecorationLine: 'line-through' },
  arrow: { fontSize: 14, marginHorizontal: spacing.sm },
  to: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  // 20 px bold = WCAG large text at every frame (x fromScale 0.94 = 18.8 px >= 18.66): the success token reaches 3.78:1 on its
  // tint in light mode (4.28:1 even on plain white, under 4.5:1 for small text), so the label is large rather than tinted
  // darker (the token is shared app-wide).
  toText: { fontSize: 20, fontWeight: '700' },
  glow: { top: -2, left: -2, right: -2, bottom: -2, borderRadius: radius.sm + 2, borderWidth: 2, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
});
