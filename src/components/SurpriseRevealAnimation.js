import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';

// Item 112 follow-up (CLAUDE.md, "Surprise Mode could have its own visual
// language... the lock opens: 🔒 → ✨ → 🎉, and the plan becomes visible to
// the recipient"): plays once, right after the real reveal RPC
// (reveal_occasion_group_plan/reveal_occasion, Item 96) has already
// succeeded -- never plays speculatively before the real server-side
// reveal is confirmed, so it can never show a "revealed!" moment that
// didn't actually happen. Same plain RN Animated cross-fade shape
// OccasionSelectAnimation.js's own 'morph'/'lock' kinds already use.
const STAGE_MS = 320;
const HOLD_MS = 500;
export const SURPRISE_REVEAL_TOTAL_MS = STAGE_MS * 2 + HOLD_MS;
// Reduce Motion: skip straight to the real end state (🎉 + the real reveal text) with no
// cross-fade through the lock/sparkle stages, held just long enough to register.
const REDUCED_HOLD_MS = 450;

export default function SurpriseRevealAnimation({ text, onDone }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const styles = getStyles(colors);
  const [stage, setStage] = useState('lock'); // 'lock' -> 'sparkle' -> 'party'
  const glyphOpacity = useRef(new Animated.Value(1)).current;
  const glyphScale = useRef(new Animated.Value(1)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const timers = [];

    if (reduceMotion) {
      setStage('party');
      glyphOpacity.setValue(1);
      glyphScale.setValue(1);
      textOpacity.setValue(1);
      timers.push(setTimeout(() => onDone?.(), REDUCED_HOLD_MS));
      return () => timers.forEach(clearTimeout);
    }

    const playStage = (next) => {
      setStage(next);
      glyphOpacity.setValue(0);
      glyphScale.setValue(0.6);
      Animated.parallel([
        Animated.timing(glyphOpacity, { toValue: 1, duration: 170, useNativeDriver: true }),
        Animated.spring(glyphScale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]).start();
    };
    timers.push(setTimeout(() => playStage('sparkle'), STAGE_MS));
    timers.push(setTimeout(() => {
      playStage('party');
      Animated.timing(textOpacity, { toValue: 1, duration: 240, useNativeDriver: true }).start();
    }, STAGE_MS * 2));
    timers.push(setTimeout(() => onDone?.(), STAGE_MS * 2 + HOLD_MS));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  const glyph = stage === 'lock' ? '🔒' : stage === 'sparkle' ? '✨' : '🎉';

  return (
    <View style={styles.container}>
      <Animated.Text style={[styles.glyph, { opacity: glyphOpacity, transform: [{ scale: glyphScale }] }]}>
        {glyph}
      </Animated.Text>
      {!!text && <Animated.Text style={[styles.text, { opacity: textOpacity }]}>{text}</Animated.Text>}
    </View>
  );
}

const getStyles = (colors) => StyleSheet.create({
  container: { alignItems: 'center' },
  glyph: { fontSize: 34 },
  text: { ...typography.body, color: colors.textPrimary, fontWeight: '700', marginTop: spacing.xs, textAlign: 'center' },
});
