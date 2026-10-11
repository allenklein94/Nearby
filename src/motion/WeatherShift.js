import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import useReduceMotion from '../hooks/useReduceMotion';
import { SEQUENCES } from './motionBudget';
import { peekWeatherShiftSeen, rememberWeatherShift, weatherShiftShouldPlay } from '../utils/weatherShiftSeen';
import { localDayKey } from '../constants/weatherRelevance';

// Owner item 36 (2026-10-11): "Weather could create environmental transitions... subtle... a contextual layer". The Home
// weather card's wash (constants/weatherAtmosphere.js) fades in ONCE, slowly, when the weather changes for this person (a
// condition not yet seen today, utils/weatherShiftSeen.js); every other time it is simply there. Decoration only: it sits
// behind the card's content and takes no touches; the words, icon and rows render at once and never move (animation never
// delays information, item 19; cards do not animate, item 15). Only while Home is in front, so a shift is never spent
// unseen. No haptic (the person tapped nothing). Reduce Motion = the settled wash, still marked seen. Nothing else on the
// screen changes.
const T = SEQUENCES.weatherShift;

export default function WeatherShift({ kind, color, radius }) {
  const focused = useIsFocused();
  const reduceMotion = useReduceMotion();
  // Decided at first render, so a wash that will not play never starts hidden (no flash).
  const willPlay = useRef(weatherShiftShouldPlay({ stored: peekWeatherShiftSeen(), kind, todayKey: localDayKey() }));
  // The record was not read yet when this card appeared: stay settled for this condition (a missed shift, never a flash).
  const unknownAtMount = useRef(peekWeatherShiftSeen() === undefined ? kind : null);
  const wash = useRef(new Animated.Value(willPlay.current ? 0 : 1)).current;

  useEffect(() => {
    if (!focused || !kind) return undefined;
    const today = localDayKey();
    if (unknownAtMount.current === kind) { wash.setValue(1); return undefined; }
    if (!weatherShiftShouldPlay({ stored: peekWeatherShiftSeen(), kind, todayKey: today })) { wash.setValue(1); return undefined; }
    rememberWeatherShift(kind, today);
    if (reduceMotion) { wash.setValue(1); return undefined; }
    wash.setValue(0);
    const anim = Animated.timing(wash, { toValue: 1, duration: T.washMs, easing: Easing.bezier(0.4, 0, 0.2, 1), useNativeDriver: true });
    anim.start();
    return () => { anim.stop(); wash.setValue(1); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused, kind]);

  if (!color) return null;
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: color, borderRadius: radius, opacity: wash }]} />;
}
