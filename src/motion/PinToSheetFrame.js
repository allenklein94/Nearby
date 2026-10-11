import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { radius } from '../theme';
import { SEQUENCES } from './motionBudget';
import { pinFrameStart } from './pinToSheet';
import useReduceMotion from '../hooks/useReduceMotion';

// Owner item 44 (2026-10-11): the outline that grows from a tapped map pin into the business sheet's outline, then fades as it
// lands. Pure decoration (outline only, no text, no fill): it takes no touches and never covers the sheet's content. Rendered
// only when the pin's spot and the sheet's place are both known. Reduce Motion: the sheet never renders it, and it renders nothing.
const T = SEQUENCES.pinToSheet;
export const BUSINESS_PIN_COLOR = '#5B9AA0';

export default function PinToSheetFrame({ pin, rect }) {
  const reduceMotion = useReduceMotion();
  const start = reduceMotion ? null : pinFrameStart(pin, rect, T.pinSize);
  const p = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!start) return undefined;
    const anim = Animated.timing(p, { toValue: 1, duration: T.frameMs, easing: Easing.bezier(0.2, 0, 0, 1), useNativeDriver: true });
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
        styles.frame,
        { left: rect.x, top: rect.y, width: rect.width, height: rect.height },
        {
          opacity: p.interpolate({ inputRange: [0, 0.7, 1], outputRange: [T.framePeakOpacity, T.framePeakOpacity, 0] }),
          transform: [{ translateX: from(start.translateX, 0) }, { translateY: from(start.translateY, 0) }, { scaleX: from(start.scaleX, 1) }, { scaleY: from(start.scaleY, 1) }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', borderWidth: 2, borderColor: BUSINESS_PIN_COLOR, borderRadius: radius.lg },
});
