import React from 'react';
import { Animated } from 'react-native';
import useKeyChangeFade from './useKeyChangeFade';

// ModeTransition -- a state-change signal, per the Nearby Motion Language:
// a brief dip-and-recover whenever `activeKey` changes, e.g. Discover's
// Things-to-Do <-> People toggle, or a Matches <-> Friends switch. Content-
// agnostic -- pass whatever's currently showing as children; this wraps the
// already-switched content in a plain Animated.View, so it's safe to drop
// around an existing screen's own conditional render without restructuring
// it. Reduce Motion: no dip at all, content just changes as it already did.
export default function ModeTransition({ activeKey, children, style, duration }) {
  const opacity = useKeyChangeFade(activeKey, { duration });
  return <Animated.View style={[style, { opacity }]}>{children}</Animated.View>;
}
