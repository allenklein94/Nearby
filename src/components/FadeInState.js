import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';
import { NearbyMark } from './brand';
import { SEQUENCES, MOTION_BUDGET } from '../motion/motionBudget';

// Empty/error-state transition (per the Nearby Motion Language, locked 2026-09-18): a
// small, one-shot fade-in for a screen's own custom "nothing here yet" state, instead
// of it just snapping into place the instant a fetch resolves to zero real results.
// Drop-in replacement for the `<View style={styles.emptyState}>` wrapper these blocks
// already use -- same `style` prop, same children, no layout change, pure entrance
// motion. Reduce Motion: appears immediately, no fade. Mirrors LoadErrorState's own
// identical fade-in for the *error* case; this is the *empty-result* sibling.
//
// Item 134 ("Empty states can animate into opportunity"): pass `opportunity` on an empty state
// that carries a real next-step action (create/invite/explore -- the Item 56 "no dead ends"
// CTAs) and it plays a two-beat sequence instead of one fade: the N mark appears first, then
// the invitation copy + action settle in beneath it -- an empty database state reads as an
// invitation, not a dead screen. Budgeted as a medium-tier sequence (motionBudget.js
// `emptyInvitation`). Reduce Motion: mark and invitation are simply present, no motion.
export default function FadeInState({ style, children, opportunity = false, ...rest }) {
  const reduceMotion = useReduceMotion();
  const seq = SEQUENCES.emptyInvitation;
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const markOpacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const markScale = useRef(new Animated.Value(reduceMotion ? 1 : 0.85)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      markOpacity.setValue(1);
      markScale.setValue(1);
      return;
    }
    if (!opportunity) {
      Animated.timing(opacity, { toValue: 1, duration: MOTION_BUDGET.small.ms, useNativeDriver: true }).start();
      return;
    }
    Animated.parallel([
      Animated.timing(markOpacity, { toValue: 1, duration: seq.markMs, useNativeDriver: true }),
      Animated.timing(markScale, { toValue: 1, duration: seq.markMs, useNativeDriver: true }),
    ]).start();
    Animated.timing(opacity, { toValue: 1, duration: seq.invitationMs, delay: seq.delayMs, useNativeDriver: true }).start();
  }, [reduceMotion, opportunity]);

  if (!opportunity) {
    return (
      <Animated.View style={[style, { opacity }]} {...rest}>
        {children}
      </Animated.View>
    );
  }
  return (
    <Animated.View style={[style, { alignItems: 'center' }]} {...rest}>
      <Animated.View style={{ opacity: markOpacity, transform: [{ scale: markScale }], marginBottom: 12 }}>
        <NearbyMark size={36} />
      </Animated.View>
      <Animated.View style={{ opacity, alignItems: 'center' }}>{children}</Animated.View>
    </Animated.View>
  );
}
