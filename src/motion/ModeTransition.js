import React from 'react';
import { Animated } from 'react-native';
import useKeyChangeFade from './useKeyChangeFade';

// ModeTransition -- a brief dip-and-recover whenever `activeKey` changes. Item 15 (2026-10-10):
// used ONLY for a real object state change (an offer card's own status on BusinessRequestDetail),
// never for a tab, mode or filter switch (those change instantly). Reduce Motion: no dip.
export default function ModeTransition({ activeKey, children, style, duration }) {
  const opacity = useKeyChangeFade(activeKey, { duration });
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}
