import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES } from './motionBudget';

const S = SEQUENCES.interestedSaved;

// Owner item 30 (2026-10-11): the Interested button's own moment. When the person's tap marks Interested (`flashKey` goes up,
// set by the caller at the tap, before the save returns), the label reads "✓ Saved" (`savedLabel`) with one small pulse,
// then returns to its normal label ("★ Interested"). Text only: the stored Interested state stays the truth and the existing
// toast still confirms. The label is the information, so it shows at full opacity from the first frame; the pulse is the only
// motion. Reduce Motion = no pulse, the same brief "Saved" swap. flashKey 0/null (a failed save, or Interested removed) ends
// it at once; a tap during it acts at once (nothing here holds or covers the button).
export default function InterestedSaved({ flashKey, label, savedLabel, style }) {
  const reduceMotion = useReduceMotion();
  const [showSaved, setShowSaved] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!flashKey) {
      setShowSaved(false);
      scale.setValue(1);
      return undefined;
    }
    setShowSaved(true);
    let a = null;
    if (!reduceMotion) {
      scale.setValue(S.pulseFrom);
      a = Animated.timing(scale, { toValue: 1, duration: S.pulseMs, easing: Easing.out(Easing.cubic), useNativeDriver: true });
      a.start();
    }
    const timer = setTimeout(() => setShowSaved(false), S.savedHoldMs);
    return () => {
      clearTimeout(timer);
      a?.stop();
      scale.setValue(1);
    };
  }, [flashKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Animated.Text style={[style, reduceMotion ? null : { transform: [{ scale }] }]}>
      {showSaved ? savedLabel : label}
    </Animated.Text>
  );
}
