import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';
import { NearbyMark } from './brand';
import { MOTION_BUDGET } from '../motion/motionBudget';

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
// CTAs): the N mark sits above the invitation copy + action, so an empty state reads as an
// invitation, not a dead screen. Owner item 58 (2026-10-12): its entrance animation is RETIRED
// (it explained no change); the mark, invitation and action render settled at once.
export default function FadeInState({ style, children, opportunity = false, ...rest }) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(reduceMotion || opportunity ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion || opportunity) {
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, { toValue: 1, duration: MOTION_BUDGET.small.ms, useNativeDriver: true }).start();
  }, [reduceMotion, opportunity]);

  if (!opportunity) {
    return (
      <Animated.View style={[style, { opacity }]} {...rest}>
        {children}
      </Animated.View>
    );
  }
  return (
    <View style={[style, { alignItems: 'center' }]} {...rest}>
      <View style={{ marginBottom: 12 }}>
        <NearbyMark size={36} />
      </View>
      <View style={{ alignItems: 'center' }}>{children}</View>
    </View>
  );
}
