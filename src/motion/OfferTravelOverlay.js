import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius } from '../theme';
import { SEQUENCES } from './motionBudget';
import { subscribeOfferTravel, endOfferTravel } from './offerTravel';

// Draws an offer travel (offerTravel.js). Not touchable at all (pointerEvents none): taps reach the screen underneath, and
// the whole thing ends on its own. If the offer card never reports where it is (slow load, the offer is gone) the dim and
// frame simply fade away after the wait.
const T = SEQUENCES.offerTravel;
const LIGHT = 12;

export default function OfferTravelOverlay() {
  const { colors } = useTheme();
  const [travel, setTravel] = useState(null);
  const dim = useRef(new Animated.Value(0)).current;
  const frame = useRef(new Animated.Value(0)).current; // 0 = at the signal, 1 = on the offer card
  const frameOpacity = useRef(new Animated.Value(0)).current;
  const light = useRef(new Animated.Value(0)).current; // 0 = signal centre, 1 = card centre
  const lightOpacity = useRef(new Animated.Value(0)).current;
  const waitTimer = useRef(null);

  useEffect(() => subscribeOfferTravel(setTravel), []);

  // Started: dim in, the frame appears where the signal is, waiting for the card.
  useEffect(() => {
    if (!travel || travel.target) return undefined;
    [frame, light].forEach((v) => v.setValue(0));
    frameOpacity.setValue(0.9);
    lightOpacity.setValue(1);
    Animated.timing(dim, { toValue: 1, duration: T.dimMs, useNativeDriver: false }).start();
    clearTimeout(waitTimer.current);
    const id = travel.id;
    waitTimer.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(dim, { toValue: 0, duration: T.settleMs, useNativeDriver: false }),
        Animated.timing(frameOpacity, { toValue: 0, duration: T.settleMs, useNativeDriver: false }),
        Animated.timing(lightOpacity, { toValue: 0, duration: T.settleMs, useNativeDriver: false }),
      ]).start(() => endOfferTravel(id));
    }, T.targetWaitMs);
    return () => clearTimeout(waitTimer.current);
  }, [travel?.id]);

  // The card is on screen: travel, then settle into it.
  useEffect(() => {
    if (!travel?.target) return;
    clearTimeout(waitTimer.current);
    const id = travel.id;
    const ease = Easing.bezier(0.2, 0, 0, 1);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(frame, { toValue: 1, duration: T.travelMs, easing: ease, useNativeDriver: false }),
        Animated.timing(light, { toValue: 1, duration: T.travelMs, easing: ease, useNativeDriver: false }),
      ]),
      Animated.parallel([
        Animated.timing(dim, { toValue: 0, duration: T.settleMs, useNativeDriver: false }),
        Animated.timing(frameOpacity, { toValue: 0, duration: T.settleMs, useNativeDriver: false }),
        Animated.timing(lightOpacity, { toValue: 0, duration: T.settleMs, useNativeDriver: false }),
      ]),
    ]).start(() => endOfferTravel(id));
  }, [travel?.target]);

  if (!travel) return null;
  const { from } = travel;
  const to = travel.target ?? from;
  const lerp = (a, b) => frame.interpolate({ inputRange: [0, 1], outputRange: [a, b] });
  const lightAt = (a, b) => light.interpolate({ inputRange: [0, 1], outputRange: [a, b] });
  const centre = (r) => ({ x: r.x + r.width / 2 - LIGHT / 2, y: r.y + r.height / 2 - LIGHT / 2 });
  const a = centre(from);
  const b = centre(to);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, opacity: dim }]} />
      <Animated.View
        style={{
          position: 'absolute',
          left: lerp(from.x, to.x), top: lerp(from.y, to.y), width: lerp(from.width, to.width), height: lerp(from.height, to.height),
          borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primaryMuted,
          opacity: frameOpacity,
        }}
      />
      <Animated.View
        style={{
          position: 'absolute', left: 0, top: 0, width: LIGHT, height: LIGHT, borderRadius: LIGHT / 2,
          backgroundColor: colors.primary, opacity: lightOpacity,
          shadowColor: colors.primary, shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6,
          transform: [{ translateX: lightAt(a.x, b.x) }, { translateY: lightAt(a.y, b.y) }],
        }}
      />
    </View>
  );
}
