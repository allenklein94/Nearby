import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES } from './motionBudget';

// Marketplace moment 1, "request sent" (2026-10-10): one or two soft rings go out from the confirmation line and fade.
// The screen mounts it only when the request was really sent AND at least one business was reached (notifiedCount > 0,
// not a duplicate); it never delays the confirmation (the line is rendered at once, the rings sit behind it, untouchable)
// and says nothing about a reply. Decided once at mount; no haptic of its own; Reduce Motion = nothing (the line alone).
const T = SEQUENCES.requestPulse;
const SIZE = 120;

export default function RequestPulse({ play = false, color, children }) {
  const reduceMotion = useReduceMotion();
  const animate = useRef(play && !reduceMotion).current;
  const rings = useRef(Array.from({ length: T.rings }, () => new Animated.Value(0))).current;

  useEffect(() => {
    if (!animate) return undefined;
    const ease = Easing.bezier(0.2, 0, 0, 1);
    const anim = Animated.stagger(T.staggerMs, rings.map((v) => Animated.timing(v, { toValue: 1, duration: T.ringMs, easing: ease, useNativeDriver: true })));
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View>
      {animate ? (
        <View pointerEvents="none" style={styles.layer}>
          {rings.map((v, i) => (
            <Animated.View
              key={i}
              style={[styles.ring, {
                borderColor: color,
                opacity: v.interpolate({ inputRange: [0, 1], outputRange: [T.startOpacity, 0] }),
                transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [T.fromScale, T.toScale] }) }],
              }]}
            />
          ))}
        </View>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2 },
});
