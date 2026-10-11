import React, { useEffect, useRef } from 'react';
import { Animated, Easing, View } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES, infoOpacity } from './motionBudget';

// Owner item 25 #3 (2026-10-11): someone joined the host's gathering while the host had it open (the live joins decided in
// utils/hostLiveJoins.js). Three calm pieces, each played once per join event (keyed by the caller), never a loop, never a
// haptic, never touchable; Reduce Motion = the settled state at once. Everything carrying information (the figure, the
// line) is readable from the first frame (infoOpacity); only the avatar's grow is decoration.
const J = SEQUENCES.friendJoin;
const ease = Easing.out(Easing.cubic);

function useOnce(play) {
  const reduceMotion = useReduceMotion();
  const v = useRef(new Animated.Value(play && !reduceMotion ? 0 : 1)).current;
  return { v, animate: play && !reduceMotion };
}

// The Going figure rolling to its new number: the new text rises into place while the previous text lifts away above it.
export function CountRoll({ play, previous, children }) {
  const { v, animate } = useOnce(play);
  useEffect(() => {
    if (!animate) return undefined;
    const a = Animated.timing(v, { toValue: 1, duration: J.rollMs, easing: ease, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!animate) return <>{children}</>;
  return (
    <View>
      {previous ? (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', left: 0, top: 0, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
            transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -J.risePx] }) }] }}
        >
          {previous}
        </Animated.View>
      ) : null}
      <Animated.View style={{ opacity: infoOpacity(v), transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [J.risePx, 0] }) }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

// The new person's avatar settling into the front of Who's going. `style` is the avatar's place in the row (overlap, z order).
export function AvatarArrive({ play, style, children }) {
  const { v, animate } = useOnce(play);
  useEffect(() => {
    if (!animate) return undefined;
    const a = Animated.timing(v, { toValue: 1, duration: J.avatarMs, easing: ease, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!animate) return <View style={style}>{children}</View>;
  return (
    <Animated.View style={[style, { opacity: infoOpacity(v), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [J.avatarFromScale, 1] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// "Your friend Maya joined": settles in just after the figure starts rolling, then simply stays for this visit.
export function JoinedLine({ play, children }) {
  const { v, animate } = useOnce(play);
  useEffect(() => {
    if (!animate) return undefined;
    const a = Animated.timing(v, { toValue: 1, duration: J.lineMs, delay: J.lineDelayMs, easing: ease, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.View accessibilityLiveRegion="polite" style={animate ? { opacity: infoOpacity(v), transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [J.risePx / 2, 0] }) }] } : undefined}>
      {children}
    </Animated.View>
  );
}
