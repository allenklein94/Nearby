import React from 'react';
import { Animated, TouchableOpacity } from 'react-native';
import useTapActivate from './useTapActivate';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

// Drop-in replacement for a plain `<TouchableOpacity style={[styles.chip, active &&
// styles.chipActive]} .../>` chip/tab/toggle button -- same props, plus a required `active`
// boolean. Keeps the existing instant color/border style flip (that stays immediate, it's real
// selection state) and adds a brief scale pop on top of it the moment `active` turns true, so the
// control itself visibly confirms "this is what you tapped" before/alongside the results
// transition underneath it (see useTapActivate.js). See ModeTransition/FilterTransition for the
// results-side half of the same cause-and-effect pattern (Items 114-116).
export default function TapActiveChip({ active, style, children, ...rest }) {
  const scale = useTapActivate(active);
  return (
    <AnimatedTouchable {...rest} style={[style, { transform: [{ scale }] }]}>
      {children}
    </AnimatedTouchable>
  );
}
