import React, { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';
import { playHaptic, HAPTIC_MOMENTS } from './haptics';

// Item 119 ("Friend acceptance could have a similar microinteraction"): a tiny, one-shot "+ -> ✓"
// glyph swap for a small status badge whose underlying state just genuinely transitioned (e.g.
// someone else accepted your outgoing friend request, discovered on refocus). Distinct from
// useTapActivate (confirms a control the USER tapped) and from MatchAnimation's own big modal (the
// ACCEPTER's own moment, already built by the Motion & Microinteraction System pass) -- this is
// the REQUESTER's own small, restrained confirmation that a real state change happened while they
// weren't looking, not something caused by their own tap.
//
// Mounted ONLY when the caller has already detected a genuine transition (never renders
// speculatively) -- there is no "before" state to accidentally show when nothing actually
// happened; a caller showing the plain static final label the rest of the time is the correct,
// simpler choice, not a gap this component needs to cover. Reduce Motion skips straight to the
// final label with no animation, same as every other decorative beat in this codebase.
// `haptic` (Item 130): opt-in. Its one real caller (the requester discovering an acceptance on
// refocus) is NOT user-initiated, so it passes nothing and stays silent.
export default function ConnectionGlyphSwap({ style, textStyle, fromGlyph = '+', label, haptic = false }) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const [showFinal, setShowFinal] = useState(reduceMotion);

  useEffect(() => { if (haptic) playHaptic(HAPTIC_MOMENTS.friendAccepted); }, []);

  useEffect(() => {
    if (reduceMotion) {
      setShowFinal(true);
      return undefined;
    }
    opacity.setValue(1);
    scale.setValue(1);
    const timer = Animated.timing(opacity, { toValue: 0, duration: 110, useNativeDriver: true });
    timer.start(() => {
      setShowFinal(true);
      opacity.setValue(0);
      scale.setValue(0.7);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 140, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]).start();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  return (
    <View style={style}>
      <Animated.Text style={[textStyle, { opacity, transform: [{ scale }] }]}>
        {showFinal ? label : fromGlyph}
      </Animated.Text>
    </View>
  );
}
