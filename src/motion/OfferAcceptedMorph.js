import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';
import { playHaptic, HAPTIC_MOMENTS } from './haptics';
import { SEQUENCES } from './motionBudget';

// The offer card morphs in place once the booking is real (owner item 12, 2026-10-10). Replaces the separate
// "You're booked" card that used to appear above the offers and shrink away: the SAME card turns into its accepted
// state and stays. It mounts only when the offer's stored status is already 'accepted' (the screen reloads after
// accept_business_offer returns), so nothing here ever runs ahead of the backend.
// Sequence (`play`, only for the offer the person just took in this visit): the ✓ ring settles beside the heading,
// then the business and the real facts below it settle in (fade + 6 px rise). Item 122: a transaction, so success
// colour, no particles, no confetti, no bounce, no loop. Success vibration only because the person tapped (`haptic`).
// `booked` false (accepted but no confirmed reservation) = no ✓ and a neutral heading: never imply a booking.
// Reduce Motion, or any later visit: the settled card at once.
const T = SEQUENCES.offerAccepted;
const RING = 26;

export default function OfferAcceptedMorph({ title, booked = true, warn = false, play = false, haptic = false, children }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  // Decided once, at mount: a re-render, a reload or a refreshed booking never replays it.
  const animate = useRef(play && !reduceMotion).current;
  const check = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const body = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (play && haptic && booked) playHaptic(HAPTIC_MOMENTS.success);
    if (!animate) return undefined;
    const ease = Easing.bezier(0.2, 0, 0, 1);
    const anim = Animated.sequence([
      Animated.timing(check, { toValue: 1, duration: T.checkMs, easing: ease, useNativeDriver: true }),
      Animated.timing(body, { toValue: 1, duration: T.morphMs, easing: ease, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accent = booked ? colors.success : (warn ? colors.warning : colors.textSecondary);
  return (
    <View>
      <Animated.View
        accessibilityRole={play ? 'alert' : undefined}
        accessibilityLiveRegion={play ? 'polite' : undefined}
        style={[styles.header, { opacity: check, transform: [{ scale: check.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }] }]}
      >
        {booked ? (
          <View style={[styles.ring, { borderColor: colors.success }]}>
            <Text style={[styles.check, { color: colors.success }]}>✓</Text>
          </View>
        ) : null}
        <Text style={[styles.title, { color: booked ? colors.textPrimary : accent }]}>{title}</Text>
      </Animated.View>
      <Animated.View style={{ opacity: body, transform: [{ translateY: body.interpolate({ inputRange: [0, 1], outputRange: [T.risePx, 0] }) }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  ring: { width: RING, height: RING, borderRadius: RING / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center', marginRight: spacing.sm },
  check: { fontSize: 14, fontWeight: '800' },
  title: { ...typography.bodyBold, flex: 1 },
});
