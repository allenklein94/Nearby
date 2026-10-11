import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES } from './motionBudget';
import { takeNewHappening } from '../utils/happeningSeen';

// Owner item 26 (2026-10-11): "Something is happening near you". One soft ring goes out from the happening-now section's
// heading icon when the section shows a gathering no happening-now section has shown this session (utils/happeningSeen.js,
// shared by Home and Discover). Only while the screen is in front, so activity is never marked seen unseen; a tab switch or
// Back replays nothing. Decoration only: the heading and the rows render at once and never move (item 15: lists and cards
// do not animate), the ring sits behind the icon and takes no touches. No haptic (the person tapped nothing). Reduce
// Motion = no ring; the ids are still marked seen, so nothing replays later.
const T = SEQUENCES.happeningRipple;

// `leading`: the glyph sits at the start of a text heading (Discover's "⚡ Happening Now") rather than being the child itself.
export default function HappeningRipple({ ids = [], color, leading = false, style, children }) {
  const focused = useIsFocused();
  const reduceMotion = useReduceMotion();
  const ring = useRef(new Animated.Value(1)).current;
  const key = (ids ?? []).join('|');

  useEffect(() => {
    if (!focused) return undefined;
    const fresh = takeNewHappening(ids);
    if (fresh.length === 0 || reduceMotion) return undefined;
    ring.setValue(0);
    const anim = Animated.timing(ring, { toValue: 1, duration: T.ringMs, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, key]);

  return (
    <View style={[styles.anchor, leading && styles.anchorLeading, style]}>
      <Animated.View
        pointerEvents="none"
        style={[styles.ring, leading && styles.ringLeading, {
          borderColor: color,
          opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [T.startOpacity, 0] }),
          transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [T.fromScale, T.toScale] }) }],
        }]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: { alignItems: 'center', justifyContent: 'center' },
  anchorLeading: { alignItems: 'stretch' },
  ringLeading: { left: T.glyphCenterPx - T.size / 2 },
  ring: { position: 'absolute', width: T.size, height: T.size, borderRadius: T.size / 2, borderWidth: 1.5 },
});
