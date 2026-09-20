import React, { useEffect, useRef } from 'react';
import { Animated, Text } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES } from '../motion/motionBudget';
import { useTheme } from '../context/ThemeContext';
import { typography, spacing } from '../theme';

// The moment a rich offer (one with a title or media) opens: "<business> sent you an offer" fades in, then the offer settles
// under it. It is presentation only -- the same offer data and the same Accept button. Business-transaction tone (Item 122):
// plain fades, no glyph beat, no haptic (it is arrival-driven, Item 130). Plays once per offer per app session, never for a
// plain offer, and collapses to the settled card under Reduce Motion.
const played = new Set();

export default function OfferReveal({ offerId, partnerName, enabled, children }) {
  const reduceMotion = useReduceMotion();
  const { colors } = useTheme();
  const animate = !!enabled && !reduceMotion && !played.has(offerId);
  const headerOpacity = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const bodyOpacity = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) return undefined;
    played.add(offerId);
    const t = SEQUENCES.offerReveal;
    Animated.parallel([
      Animated.timing(headerOpacity, { toValue: 1, duration: t.headerMs, useNativeDriver: true }),
      Animated.timing(bodyOpacity, { toValue: 1, duration: t.bodyMs, delay: t.bodyDelayMs, useNativeDriver: true }),
    ]).start();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!enabled) return <>{children}</>;
  return (
    <>
      {animate ? (
        <Animated.View style={{ opacity: headerOpacity }}>
          <Text style={{ ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs }}>{partnerName} sent you an offer</Text>
        </Animated.View>
      ) : null}
      <Animated.View style={{ opacity: bodyOpacity }}>{children}</Animated.View>
    </>
  );
}
