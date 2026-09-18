import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { playHaptic, HAPTIC_MOMENTS } from './haptics';
import { SEQUENCES } from './motionBudget';
import { useTheme } from '../context/ThemeContext';
import { spacing, typography } from '../theme';
import useReduceMotion from '../hooks/useReduceMotion';

// SurpriseRevealAnimation -- 🔒 = privacy/surprise, resolving into 🎉 =
// celebration, per the Nearby Motion Language: the lock opens (🔒 → ✨ → 🎉).
// The occasion-domain sibling of OccasionAnimation, kept as its own file since
// it's triggered by a different real event (a reveal action succeeding, not
// picking an occasion type) with its own distinct stage shape. Plays once,
// right after the real reveal RPC has already succeeded -- never speculatively
// before the real server-side reveal is confirmed, so it can never show a
// "revealed!" moment that didn't actually happen.
const STAGE_MS = SEQUENCES.surpriseReveal.stageMs; // Item 131 budget tokens
const HOLD_MS = 500;
export const SURPRISE_REVEAL_TOTAL_MS = STAGE_MS * 2 + HOLD_MS;
// Reduce Motion: skip straight to the real end state (🎉 + the real reveal text) with no
// cross-fade through the lock/sparkle stages, held just long enough to register.
const REDUCED_HOLD_MS = 450;

// `haptic` (Item 130): opt-in; true only when the user's own tap triggered the reveal.
export default function SurpriseRevealAnimation({ text, onDone, haptic = false }) {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const styles = getStyles(colors);
  const [stage, setStage] = useState('lock'); // 'lock' -> 'sparkle' -> 'party'
  const glyphOpacity = useRef(new Animated.Value(1)).current;
  const glyphScale = useRef(new Animated.Value(1)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (haptic) playHaptic(HAPTIC_MOMENTS.success);
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
        Animated.timing(glyphOpacity, { toValue: 1, duration: SEQUENCES.surpriseReveal.glyphFadeMs, useNativeDriver: true }),
        Animated.spring(glyphScale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]).start();
    };
    timers.push(setTimeout(() => playStage('sparkle'), STAGE_MS));
    timers.push(setTimeout(() => {
      playStage('party');
      Animated.timing(textOpacity, { toValue: 1, duration: SEQUENCES.surpriseReveal.textFadeMs, useNativeDriver: true }).start();
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
