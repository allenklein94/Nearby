import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius } from '../theme';
import { SEQUENCES } from './motionBudget';
import { subscribeOfferTravel, endOfferTravel, markOfferTravelLanded } from './offerTravel';
import { arcPoints } from './travelArc';

// Draws an offer travel (offerTravel.js). Not touchable at all (pointerEvents none): taps reach the screen underneath, and
// the whole thing ends on its own. If the offer card never reports where it is (slow load, the offer is gone) the frame
// simply fades away after the wait. No full-screen dim (owner, 2026-10-12): nothing here covers the screen.
const T = SEQUENCES.offerTravel;
const LIGHT = 12;

export default function OfferTravelOverlay() {
  const { colors } = useTheme();
  const [travel, setTravel] = useState(null);
  const frame = useRef(new Animated.Value(0)).current; // 0 = at the signal, 1 = on the offer card
  const frameOpacity = useRef(new Animated.Value(0)).current;
  const light = useRef(new Animated.Value(0)).current; // 0 = signal centre, 1 = card centre
  const lightOpacity = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current; // item 25: 0 = wide + clear, 1 = converged onto the card
  const waitTimer = useRef(null);

  useEffect(() => subscribeOfferTravel(setTravel), []);

  // Started: the frame appears where the signal is, waiting for the card.
  useEffect(() => {
    if (!travel || travel.target) return undefined;
    [frame, light].forEach((v) => v.setValue(0));
    frameOpacity.setValue(0.9);
    lightOpacity.setValue(1);
    clearTimeout(waitTimer.current);
    const id = travel.id;
    waitTimer.current = setTimeout(() => {
      Animated.parallel([
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
    ring.setValue(0);
    let landing = null;
    const flight = Animated.parallel([
      Animated.timing(frame, { toValue: 1, duration: T.travelMs, easing: ease, useNativeDriver: false }),
      Animated.timing(light, { toValue: 1, duration: T.travelMs, easing: ease, useNativeDriver: false }),
    ]);
    flight.start(() => {
      // Landed (item 25): the card starts building itself in now, while one ring converges onto it and the rest fades.
      markOfferTravelLanded(id);
      landing = Animated.parallel([
        Animated.timing(ring, { toValue: 1, duration: T.ringMs, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(frameOpacity, { toValue: 0, duration: T.settleMs, useNativeDriver: false }),
        Animated.timing(lightOpacity, { toValue: 0, duration: T.settleMs, useNativeDriver: false }),
      ]);
      landing.start(() => endOfferTravel(id));
    });
    return () => { flight.stop(); landing?.stop(); };
  }, [travel?.target]);

  if (!travel) return null;
  const { from } = travel;
  const to = travel.target ?? from;
  const lerp = (a, b) => frame.interpolate({ inputRange: [0, 1], outputRange: [a, b] });
  const centre = (r) => ({ x: r.x + r.width / 2 - LIGHT / 2, y: r.y + r.height / 2 - LIGHT / 2 });
  const a = centre(from);
  const b = centre(to);
  // Item 25: the light follows a gentle arc (a few interpolation points), not a straight line.
  const arc = arcPoints(a, b, { arcPx: T.arcPx, arcShare: T.arcShare });
  const lightX = light.interpolate({ inputRange: arc.t, outputRange: arc.x });
  const lightY = light.interpolate({ inputRange: arc.t, outputRange: arc.y });
  const halo = LIGHT * 3;
  const ringAt = { x: b.x + LIGHT / 2 - T.ringSize / 2, y: b.y + LIGHT / 2 - T.ringSize / 2 };

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={{
          position: 'absolute',
          left: lerp(from.x, to.x), top: lerp(from.y, to.y), width: lerp(from.width, to.width), height: lerp(from.height, to.height),
          // Item 25: an outline only (no fill), so the card's text under it is readable from the first frame.
          borderRadius: radius.lg, borderWidth: 1.5, borderColor: colors.primary, backgroundColor: 'transparent',
          opacity: frameOpacity,
        }}
      />
      {/* The light's soft halo (item 25): travels with it, a third as bright. */}
      <Animated.View
        style={{
          position: 'absolute', left: 0, top: 0, width: halo, height: halo, borderRadius: halo / 2,
          backgroundColor: colors.primary, opacity: lightOpacity.interpolate({ inputRange: [0, 1], outputRange: [0, T.haloOpacity] }),
          transform: [{ translateX: Animated.add(lightX, -LIGHT) }, { translateY: Animated.add(lightY, -LIGHT) }],
        }}
      />
      <Animated.View
        style={{
          position: 'absolute', left: 0, top: 0, width: LIGHT, height: LIGHT, borderRadius: LIGHT / 2,
          backgroundColor: colors.primary, opacity: lightOpacity,
          shadowColor: colors.primary, shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6,
          transform: [{ translateX: lightX }, { translateY: lightY }],
        }}
      />
      {/* Landing (item 25): one ring converges onto the card -- the request's rings went out, the answer's comes back in. */}
      {travel.target ? (
        <Animated.View
          style={{
            position: 'absolute', left: ringAt.x, top: ringAt.y, width: T.ringSize, height: T.ringSize, borderRadius: T.ringSize / 2,
            borderWidth: 2, borderColor: colors.primary,
            opacity: ring.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, T.ringPeakOpacity, 0] }),
            transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [T.ringFromScale, T.ringToScale] }) }],
          }}
        />
      ) : null}
    </View>
  );
}
