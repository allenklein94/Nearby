import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES } from './motionBudget';
import { usePulseRings, PulseRings } from './NearbyPulse';

// Marketplace moment 1, "request sent" (2026-10-10): one or two soft rings go out from the confirmation line and fade.
// The screen mounts it only when the request was really sent AND at least one business was reached (notifiedCount > 0,
// not a duplicate); it never delays the confirmation (the line is rendered at once, the rings sit behind it, untouchable)
// and says nothing about a reply. Decided once at mount; no haptic of its own; Reduce Motion = nothing (the line alone).
// Item 55: drawn with the Nearby Pulse's ring form (motion/NearbyPulse.js), with this moment's own tokens and size.
const T = SEQUENCES.requestPulse;
const SIZE = 120;

export default function RequestPulse({ play = false, color, children }) {
  const reduceMotion = useReduceMotion();
  const animate = useRef(play && !reduceMotion).current;
  const pulse = usePulseRings(T);

  useEffect(() => {
    if (!animate) return undefined;
    const anim = pulse.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View>
      {animate ? <PulseRings pulse={pulse} tokens={T} size={SIZE} borderWidth={2} color={color} style={styles.layer} /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
