import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { getReduceMotion } from './motionPolicy';
import { journeyStart } from './pulseGeometry';

// Owner item 55 (2026-10-12, LOCKED): the Nearby Pulse, the one motion language for a CONNECTION -- a signal that starts at
// one thing (a person, a place, a business, a gathering, a request) and reaches another. Every connection moment draws its
// signal here, in one of two forms; none draws its own rings or travel (guard: motion/nearbyPulse.test.js):
//
//   1. Ring     -- soft rings go out from where the connection begins (usePulseRings + <PulseRings>). Still form: <PulseMark>,
//                  a dot inside one faint ring, never moving on its own (the Right Now mark, item 27).
//   2. Journey  -- a short outline travels from where it begins into the thing it reaches (<PulseJourney>, journeyStart).
//
// The shape is shared; each moment keeps its OWN approved tokens (SEQUENCES.*), size, colour, trigger and Reduce Motion rule:
// consolidation never changes approved timing, content or interaction to force uniformity. Always decoration: native driver,
// untouchable (pointerEvents none), no haptic, no loop, never in front of information (callers render their content at once).
// The business-responds travel (motion/offerTravel.js + OfferTravelOverlay, SIGNATURE_MOMENT) stays the ONE larger, distinct
// moment and is deliberately NOT built from this: nothing here may approach it (no arc, no dim, no glow, medium tier at most).
// Registry of who uses which form: PULSE_MOMENTS in constants/motionLanguage.js.

const EASE = Easing.bezier(0.2, 0, 0, 1);

// ---------- form 1: ring ----------

// The rings' values (Reduce Motion: start() does nothing, see below). They rest at 1 (fully faded out), so nothing shows until start(). start({ delayMs }) restarts them from
// the origin and returns the running animation (stop it on unmount). One ring = one timing; several = staggered.
// tokens: { ringMs, rings = 1, staggerMs = 0 }.
export function usePulseRings(tokens) {
  const count = Math.max(1, tokens.rings ?? 1);
  const values = useRef(Array.from({ length: count }, () => new Animated.Value(1))).current;
  const start = ({ delayMs = 0 } = {}) => {
    // Backstop: callers already skip the pulse under Reduce Motion; if one ever forgets, the rings still never play.
    if (getReduceMotion()) return { stop() {} };
    values.forEach((v) => v.setValue(0));
    const each = values.map((v) => Animated.timing(v, { toValue: 1, duration: tokens.ringMs, easing: EASE, useNativeDriver: true }));
    const out = each.length === 1 ? each[0] : Animated.stagger(tokens.staggerMs ?? 0, each);
    const anim = delayMs > 0 ? Animated.sequence([Animated.delay(delayMs), out]) : out;
    anim.start();
    return anim;
  };
  return { values, start };
}

// Draws the rings, centred in `style` (the caller's anchor), behind whatever follows it. tokens: { fromScale, toScale,
// startOpacity }. size / borderWidth / color are the moment's own.
export function PulseRings({ pulse, tokens, size, borderWidth = 2, color, style }) {
  return (
    <View pointerEvents="none" style={style}>
      {pulse.values.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth, borderColor: color,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [tokens.startOpacity, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [tokens.fromScale, tokens.toScale] }) }],
          }}
        />
      ))}
    </View>
  );
}

// The still form: a dot inside one faint ring. Drawn, never animated. Decorative (the label it sits beside carries meaning).
export function PulseMark({ color, size = 14, dot = 6, ringOpacity = 0.45, style }) {
  return (
    <View style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]} accessible={false} importantForAccessibility="no-hide-descendants">
      <View style={{ position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderColor: color, opacity: ringOpacity }} />
      <View style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }} />
    </View>
  );
}

// ---------- form 2: journey ----------

export { journeyStart };

// An outline that travels from `origin` into `rect` (both in the same overlay's coordinates) and fades as it lands. Outline
// only: no fill, no text, never covers content. tokens: { frameMs, framePeakOpacity, originSize }. `play` false (e.g. Reduce
// Motion) or anything unknown = nothing.
export function PulseJourney({ origin, rect, tokens, color, borderRadius = 0, borderWidth = 2, play = true }) {
  const start = play && !getReduceMotion() ? journeyStart(origin, rect, tokens.originSize) : null;
  const p = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!start) return undefined;
    const anim = Animated.timing(p, { toValue: 1, duration: tokens.frameMs, easing: EASE, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!start) return null;
  const from = (a, b) => p.interpolate({ inputRange: [0, 1], outputRange: [a, b] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.journey,
        { left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderColor: color, borderRadius, borderWidth },
        {
          opacity: p.interpolate({ inputRange: [0, 0.7, 1], outputRange: [tokens.framePeakOpacity, tokens.framePeakOpacity, 0] }),
          transform: [{ translateX: from(start.translateX, 0) }, { translateY: from(start.translateY, 0) }, { scaleX: from(start.scaleX, 1) }, { scaleY: from(start.scaleY, 1) }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  journey: { position: 'absolute' },
});
