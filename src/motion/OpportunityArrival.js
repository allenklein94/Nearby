import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES, infoOpacity } from './motionBudget';
import { usePulseRings, PulseRings } from './NearbyPulse';

// Owner item 48 (2026-10-11): "signal received" -- marketplace moment 1 seen from the business side. An opportunity card that
// is new on this device (utils/opportunityArrival.js decides which, the screen passes `play` + `slot`) rises into place
// while requestPulse's own soft rings go out from its ✨ headline (<ArrivalSignal>): the same pulse the customer saw when the
// request left, now arriving. Decided once at mount (`consume` marks it played for this session so a remount never replays).
// Never delays anything: the card's text starts at the info floor and its buttons are live from the first frame; rings are
// untouchable decoration. Calm business tone: no haptic, no sound, no bounce, no loop. Reduce Motion = the card, settled.
const T = SEQUENCES.opportunityArrival;
const P = SEQUENCES.requestPulse;
const ArrivalContext = createContext({ animate: false, delayMs: 0 });

export default function OpportunityArrival({ id, play = false, slot = 0, consume, style, children }) {
  const reduceMotion = useReduceMotion();
  const animate = useRef(play && !reduceMotion && (consume ? consume(id) : true)).current;
  const delayMs = Math.min(slot, T.maxSlots - 1) * T.slotStaggerMs;
  const rise = useRef(new Animated.Value(animate ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) return undefined;
    const anim = Animated.timing(rise, { toValue: 1, duration: T.riseMs, delay: delayMs, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: true });
    anim.start();
    return () => { anim.stop(); rise.setValue(1); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ArrivalContext.Provider value={{ animate, delayMs }}>
      <Animated.View
        style={[style, animate && {
          opacity: infoOpacity(rise),
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [T.risePx, 0] }) }],
        }]}
      >
        {children}
      </Animated.View>
    </ArrivalContext.Provider>
  );
}

// The rings, centred on the start of the headline (its ✨), behind it. Renders the headline itself unchanged.
// Item 55: the Nearby Pulse's ring form (motion/NearbyPulse.js) with requestPulse's own tokens: the same pulse, arriving.
export function ArrivalSignal({ color, children }) {
  const { animate, delayMs } = useContext(ArrivalContext);
  const pulse = usePulseRings(P);

  useEffect(() => {
    if (!animate) return undefined;
    const anim = pulse.start({ delayMs });
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View>
      {animate ? <PulseRings pulse={pulse} tokens={P} size={T.ringSize} borderWidth={2} color={color} style={styles.anchor} /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // Centred on the headline's first glyph (about 8 px in, half a caption line down).
  anchor: { position: 'absolute', left: 8 - T.ringSize / 2, top: 10 - T.ringSize / 2, width: T.ringSize, height: T.ringSize, alignItems: 'center', justifyContent: 'center' },
});
